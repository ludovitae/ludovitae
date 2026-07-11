"""T-007 categorization layering: rules CRUD/precedence, apply-on-import,
retroactive apply, manual protection, heuristics, suggest stub."""

from __future__ import annotations

import datetime as dt

import pytest

MAPPING = '{"date": "Date", "amount": "Amount", "payee": "Description", "category": "Category"}'


def _date() -> dt.date:
    return dt.date.today() - dt.timedelta(days=30)


def _import_csv(authed, account_id: int, rows: list[str]):
    csv_data = "Date,Amount,Description,Category\n" + "\n".join(rows) + "\n"
    resp = authed.post(
        "/api/v1/import/commit",
        files={"file": ("t.csv", csv_data, "text/csv")},
        data={"kind": "csv", "account_id": str(account_id), "mapping": MAPPING},
    )
    assert resp.status_code == 200, resp.text
    return resp.json()


@pytest.fixture()
def account(authed):
    return authed.post("/api/v1/accounts", json={"name": "Chk", "type": "checking"}).json()


def _txn(authed, account_id, payee):
    rows = authed.get(f"/api/v1/transactions?account_id={account_id}").json()
    return next(t for t in rows if t["payee"] == payee)


def test_rules_crud_and_validation(authed):
    created = authed.post(
        "/api/v1/rules",
        json={"pattern": "green basket", "category": "groceries", "priority": 10},
    )
    assert created.status_code == 201
    rule = created.json()
    assert rule["match"] == "contains" and rule["field"] == "payee"

    patched = authed.patch(f"/api/v1/rules/{rule['id']}", json={"match": "exact"})
    assert patched.json()["match"] == "exact"

    assert authed.post(
        "/api/v1/rules",
        json={"pattern": "x", "category": "y", "match": "regex"},
    ).status_code == 422
    assert authed.post(
        "/api/v1/rules",
        json={"pattern": "x", "category": "y", "field": "amount"},
    ).status_code == 422
    assert authed.patch("/api/v1/rules/9999", json={"priority": 1}).status_code == 404

    assert authed.delete(f"/api/v1/rules/{rule['id']}").status_code == 204
    assert authed.get("/api/v1/rules").json() == []


def test_import_layering_manual_then_rule_then_heuristic(authed, account):
    authed.post("/api/v1/rules", json={"pattern": "basket", "category": "food"})
    d = _date()
    _import_csv(authed, account["id"], [
        f"{d},-10.00,Green Basket,groceries",  # file category -> manual
        f"{d},-11.00,Basket Case,",            # rule match -> rule
        f"{d},-12.00,NETFLIX.COM,",            # heuristic keyword
        f"{d},-13.00,Mystery Shop,",           # nothing -> none
    ])
    a = _txn(authed, account["id"], "Green Basket")
    assert (a["category"], a["category_source"]) == ("groceries", "manual")
    b = _txn(authed, account["id"], "Basket Case")
    assert (b["category"], b["category_source"]) == ("food", "rule")
    c = _txn(authed, account["id"], "NETFLIX.COM")
    assert (c["category"], c["category_source"]) == ("subscriptions", "heuristic")
    x = _txn(authed, account["id"], "Mystery Shop")
    assert (x["category"], x["category_source"]) == (None, "none")


def test_rule_priority_asc_first_match_wins(authed, account):
    authed.post("/api/v1/rules", json={"pattern": "coffee", "category": "late", "priority": 50})
    authed.post("/api/v1/rules", json={"pattern": "blue bottle", "category": "early",
                                       "priority": 1})
    _import_csv(authed, account["id"], [f"{_date()},-5.00,Blue Bottle Coffee,"])
    t = _txn(authed, account["id"], "Blue Bottle Coffee")
    assert (t["category"], t["category_source"]) == ("early", "rule")


def test_exact_match_rule(authed, account):
    authed.post("/api/v1/rules", json={"pattern": "STREAMCO", "category": "subscriptions",
                                       "match": "exact"})
    d = _date()
    _import_csv(authed, account["id"], [
        f"{d},-15.99,StreamCo,",         # exact (case-insensitive) -> rule
        f"{d},-25.99,StreamCo Store,",   # not exact -> uncategorized
    ])
    assert _txn(authed, account["id"], "StreamCo")["category"] == "subscriptions"
    assert _txn(authed, account["id"], "StreamCo Store")["category"] is None


def test_rules_apply_retroactive_never_overwrites_manual(authed, account):
    d = _date()
    _import_csv(authed, account["id"], [
        f"{d},-10.00,Corner Store,snacks",  # manual (file category)
        f"{d},-11.00,Corner Kiosk,",        # uncategorized
        f"{d},-12.00,NETFLIX.COM,",         # heuristic -> subscriptions
    ])
    authed.post("/api/v1/rules", json={"pattern": "corner", "category": "convenience"})
    authed.post("/api/v1/rules", json={"pattern": "netflix", "category": "tv"})

    first = authed.post("/api/v1/rules/apply").json()
    assert first == {"recategorized": 2}  # kiosk (none) + netflix (heuristic)
    assert _txn(authed, account["id"], "Corner Store")["category"] == "snacks"
    kiosk = _txn(authed, account["id"], "Corner Kiosk")
    assert (kiosk["category"], kiosk["category_source"]) == ("convenience", "rule")
    netflix = _txn(authed, account["id"], "NETFLIX.COM")
    assert (netflix["category"], netflix["category_source"]) == ("tv", "rule")

    again = authed.post("/api/v1/rules/apply").json()
    assert again == {"recategorized": 0}  # idempotent


def test_bulk_manual_categorize_protected_from_rules(authed, account):
    d = _date()
    _import_csv(authed, account["id"], [f"{d},-9.00,Widget Hut,"])
    txn = _txn(authed, account["id"], "Widget Hut")

    resp = authed.post(
        "/api/v1/transactions/categorize",
        json={"ids": [txn["id"]], "category": "hobbies"},
    )
    assert resp.json() == {"updated": 1}
    after = _txn(authed, account["id"], "Widget Hut")
    assert (after["category"], after["category_source"]) == ("hobbies", "manual")

    authed.post("/api/v1/rules", json={"pattern": "widget", "category": "junk"})
    assert authed.post("/api/v1/rules/apply").json() == {"recategorized": 0}
    assert _txn(authed, account["id"], "Widget Hut")["category"] == "hobbies"

    missing = authed.post(
        "/api/v1/transactions/categorize", json={"ids": [txn["id"], 424242], "category": "x"},
    )
    assert missing.status_code == 404
    assert missing.json()["error"]["code"] == "transaction_not_found"


def test_uncategorized_filter(authed, account):
    d = _date()
    _import_csv(authed, account["id"], [
        f"{d},-10.00,Categorized,stuff",
        f"{d},-11.00,Not Yet,",
    ])
    rows = authed.get(f"/api/v1/transactions?account_id={account['id']}&uncategorized=1").json()
    assert [t["payee"] for t in rows] == ["Not Yet"]


def test_interest_fee_autodetected_on_card_imports_only(authed, account):
    card = authed.post("/api/v1/accounts", json={"name": "Card", "type": "credit_card"}).json()
    d = _date()
    _import_csv(authed, card["id"], [f"{d},-23.10,PURCHASE INTEREST CHARGE,"])
    _import_csv(authed, card["id"], [f"{d},-95.00,ANNUAL FEE,"])
    _import_csv(authed, account["id"], [f"{d},-5.00,INTEREST 0626,"])
    interest = _txn(authed, card["id"], "PURCHASE INTEREST CHARGE")
    assert (interest["category"], interest["category_source"]) == ("interest-fees", "heuristic")
    fee = _txn(authed, card["id"], "ANNUAL FEE")
    assert fee["category"] == "interest-fees"
    # plain "interest" on a checking account is not assumed to be a fee
    assert _txn(authed, account["id"], "INTEREST 0626")["category"] is None


def test_categorize_suggest_stub(authed):
    resp = authed.post(
        "/api/v1/categorize/suggest",
        json={"payees": ["NETFLIX.COM 1234", "Green Basket Market", "Zorp"]},
    )
    body = resp.json()
    assert body["source"] == "heuristic"
    by_payee = {s["payee"]: s for s in body["suggestions"]}
    assert by_payee["NETFLIX.COM 1234"]["category"] == "subscriptions"
    assert by_payee["NETFLIX.COM 1234"]["confidence"] == 0.9
    assert by_payee["Green Basket Market"]["category"] == "groceries"
    assert by_payee["Zorp"] == {"payee": "Zorp", "category": None, "confidence": 0.0}
    assert authed.post("/api/v1/categorize/suggest", json={"payees": []}).status_code == 422
