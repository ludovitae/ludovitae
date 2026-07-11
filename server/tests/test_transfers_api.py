"""T-007 transfer pairing over the API: auto-pair on import, idempotent
re-import, candidates queue, manual pair/unpair, analytics exclusion."""

from __future__ import annotations

import datetime as dt

import pytest

MAPPING = '{"date": "Date", "amount": "Amount", "payee": "Description", "category": "Category"}'


def _shift_month(months: int, day: int = 15) -> dt.date:
    today = dt.date.today()
    total = today.year * 12 + (today.month - 1) + months
    return dt.date(total // 12, total % 12 + 1, day)


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
def accounts(authed):
    checking = authed.post(
        "/api/v1/accounts", json={"name": "Chk", "type": "checking"}
    ).json()
    card = authed.post(
        "/api/v1/accounts", json={"name": "Card", "type": "credit_card"}
    ).json()
    return checking, card


def _txns(authed, account_id):
    return authed.get(f"/api/v1/transactions?account_id={account_id}").json()


def test_card_payment_auto_pairs_across_imports(authed, accounts):
    checking, card = accounts
    pay_date = _shift_month(-1)
    _import_csv(authed, checking["id"], [
        f"{pay_date},-1200.00,Payment to Card,",
        f"{pay_date},-84.20,Green Basket Market,groceries",
    ])
    # counterpart arrives in a separate (later) import — pairing spans imports
    _import_csv(authed, card["id"], [
        f"{pay_date + dt.timedelta(days=2)},1200.00,PAYMENT THANK YOU,",
        f"{pay_date},-45.00,Taqueria Luna,dining",
    ])
    chk_txns = {t["payee"]: t for t in _txns(authed, checking["id"])}
    card_txns = {t["payee"]: t for t in _txns(authed, card["id"])}
    leg_a = chk_txns["Payment to Card"]
    leg_b = card_txns["PAYMENT THANK YOU"]
    assert leg_a["transfer_pair_id"] == leg_b["transfer_pair_id"] is not None
    assert leg_a["transfer_pair_id"] == min(leg_a["id"], leg_b["id"])
    # spending stays unpaired
    assert chk_txns["Green Basket Market"]["transfer_pair_id"] is None
    assert card_txns["Taqueria Luna"]["transfer_pair_id"] is None
    assert authed.get("/api/v1/transfers/candidates").json() == []


def test_reimport_is_fully_idempotent(authed, accounts):
    """Acceptance: re-importing the same file twice — zero new rows, zero new
    pairs, stable ids."""
    checking, card = accounts
    pay_date = _shift_month(-1)
    chk_rows = [f"{pay_date},-500.00,Payment to Card,"]
    card_rows = [f"{pay_date + dt.timedelta(days=1)},500.00,PAYMENT RECEIVED,"]
    _import_csv(authed, checking["id"], chk_rows)
    _import_csv(authed, card["id"], card_rows)
    before = sorted(
        (t["id"], t["transfer_pair_id"])
        for t in _txns(authed, checking["id"]) + _txns(authed, card["id"])
    )
    assert all(pair is not None for _, pair in before)

    again_chk = _import_csv(authed, checking["id"], chk_rows)
    again_card = _import_csv(authed, card["id"], card_rows)
    assert again_chk == {"imported": 0, "skipped_duplicates": 1}
    assert again_card == {"imported": 0, "skipped_duplicates": 1}
    after = sorted(
        (t["id"], t["transfer_pair_id"])
        for t in _txns(authed, checking["id"]) + _txns(authed, card["id"])
    )
    assert after == before


def test_near_miss_becomes_scored_candidate_and_manual_pair_roundtrip(authed, accounts):
    checking, card = accounts
    date = _shift_month(-1)
    _import_csv(authed, checking["id"], [f"{date},-1000.00,Payment out,"])
    _import_csv(authed, card["id"], [f"{date},995.00,Payment in,"])  # 0.5% off

    cands = authed.get("/api/v1/transfers/candidates").json()
    assert len(cands) == 1
    assert cands[0]["score"] == 0.7  # 0.6*(1-0.5) + 0.4*1.0
    ids = sorted(t["id"] for t in cands[0]["txns"])

    paired = authed.post("/api/v1/transfers/pair", json={"transaction_ids": ids})
    assert paired.status_code == 200
    legs = paired.json()
    assert [t["id"] for t in legs] == ids
    assert all(t["transfer_pair_id"] == ids[0] for t in legs)
    assert authed.get("/api/v1/transfers/candidates").json() == []

    resp = authed.delete(f"/api/v1/transfers/pair/{ids[0]}")
    assert resp.status_code == 204
    assert len(authed.get("/api/v1/transfers/candidates").json()) == 1
    assert authed.delete(f"/api/v1/transfers/pair/{ids[0]}").status_code == 404


def test_pair_validation_errors(authed, accounts):
    checking, card = accounts
    date = _shift_month(-1)
    _import_csv(authed, checking["id"], [
        f"{date},-10.00,A,",
        f"{date},-20.00,B,",
    ])
    _import_csv(authed, card["id"], [
        f"{date},30.00,C,",
        f"{date},40.00,D,",
    ])
    by_payee = {
        t["payee"]: t["id"]
        for t in _txns(authed, checking["id"]) + _txns(authed, card["id"])
    }

    def pair(ids):
        return authed.post("/api/v1/transfers/pair", json={"transaction_ids": ids})

    same = pair([by_payee["A"], by_payee["A"]])
    assert same.status_code == 422
    missing = pair([by_payee["A"], 99999])
    assert missing.status_code == 404
    assert missing.json()["error"]["code"] == "transaction_not_found"
    same_account = pair([by_payee["A"], by_payee["B"]])
    assert same_account.status_code == 422
    same_sign = pair([by_payee["C"], by_payee["D"]])  # cross-account but both inflows
    assert same_sign.status_code == 422

    ok = pair([by_payee["A"], by_payee["C"]])  # user override: amounts differ
    assert ok.status_code == 200
    again = pair([by_payee["A"], by_payee["C"]])
    assert again.status_code == 409
    assert again.json()["error"]["code"] == "already_paired"


def test_paired_transfers_excluded_from_observed_spending(authed, accounts):
    checking, card = accounts
    date = _shift_month(-1)
    _import_csv(authed, checking["id"], [
        f"{date},-800.00,Payment to Card,",
        f"{date},-100.00,Green Basket Market,groceries",
    ])
    _import_csv(authed, card["id"], [f"{date},800.00,PAYMENT THANK YOU,"])
    body = authed.get("/api/v1/spending/observed?months=2").json()
    # the paired 800 vanishes; only the groceries outflow remains
    assert body["by_category"] == [
        {"category": "groceries", "monthly_avg": 50.0, "txn_count": 1},
    ]
    # and from the v1.2 analytics too
    summary = authed.get("/api/v1/spending/summary").json()
    assert summary["grand_total"] == 100.0
