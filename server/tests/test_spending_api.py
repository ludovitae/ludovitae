"""T-005 /spending + /spending/observed endpoint tests."""

from __future__ import annotations

import datetime as dt


def test_fresh_db_has_migration_starter_category(authed):
    body = authed.get("/api/v1/spending").json()
    assert body["monthly_savings_target"] == 0.0
    assert [(c["name"], c["monthly_amount"], c["kind"])
            for c in body["categories"]] == [("Everything else", 0.0, "discretionary")]


def test_put_spending_full_replace_preserves_matched_ids(authed):
    first = authed.put(
        "/api/v1/spending",
        json={"categories": [
            {"name": "Housing", "monthly_amount": 2500.0, "kind": "essential"},
            {"name": "Dining out", "monthly_amount": 600.0, "kind": "discretionary",
             "annual_growth_pct": 1.5},
        ], "monthly_savings_target": 1500.0},
    ).json()
    assert first["monthly_savings_target"] == 1500.0
    names = {c["name"]: c for c in first["categories"]}
    assert set(names) == {"Housing", "Dining out"}
    assert names["Dining out"]["annual_growth_pct"] == 1.5
    housing_id = names["Housing"]["id"]

    # update Housing in place (same id), drop Dining out, add Groceries
    second = authed.put(
        "/api/v1/spending",
        json={"categories": [
            {"id": housing_id, "name": "Housing", "monthly_amount": 2600.0,
             "kind": "essential"},
            {"name": "Groceries", "monthly_amount": 900.0, "kind": "essential"},
        ], "monthly_savings_target": 1200.0},
    ).json()
    by_name = {c["name"]: c for c in second["categories"]}
    assert set(by_name) == {"Housing", "Groceries"}
    assert by_name["Housing"]["id"] == housing_id
    assert by_name["Housing"]["monthly_amount"] == 2600.0
    assert authed.get("/api/v1/spending").json() == second


def test_put_spending_validation(authed):
    bad_kind = authed.put(
        "/api/v1/spending",
        json={"categories": [{"name": "X", "monthly_amount": 1.0, "kind": "vital"}],
              "monthly_savings_target": 0},
    )
    assert bad_kind.status_code == 422
    assert bad_kind.json()["error"]["code"] == "validation_error"
    negative = authed.put(
        "/api/v1/spending",
        json={"categories": [{"name": "X", "monthly_amount": -5, "kind": "essential"}],
              "monthly_savings_target": 0},
    )
    assert negative.status_code == 422
    neg_target = authed.put(
        "/api/v1/spending", json={"categories": [], "monthly_savings_target": -1},
    )
    assert neg_target.status_code == 422
    empty_ok = authed.put(
        "/api/v1/spending", json={"categories": [], "monthly_savings_target": 0},
    )
    assert empty_ok.status_code == 200
    assert empty_ok.json()["categories"] == []


def test_observed_empty_transactions_returns_zeros(authed):
    body = authed.get("/api/v1/spending/observed").json()
    assert body["months"] == 12
    assert body["total_monthly_avg"] == 0.0
    assert body["by_category"] == []
    # window is aligned to full months ending at the current month start
    assert body["to"] == dt.date.today().replace(day=1).isoformat()


def test_observed_months_bounds(authed):
    assert authed.get("/api/v1/spending/observed?months=0").status_code == 422
    assert authed.get("/api/v1/spending/observed?months=61").status_code == 422
    assert authed.get("/api/v1/spending/observed?months=60").json()["months"] == 60
    assert authed.get("/api/v1/spending/observed?months=1").json()["months"] == 1


def _shift_month(date: dt.date, months: int) -> dt.date:
    total = date.year * 12 + (date.month - 1) + months
    return dt.date(total // 12, total % 12 + 1, 15)


def test_observed_groups_excludes_transfers_and_inflows(authed):
    acc_id = authed.post(
        "/api/v1/accounts", json={"name": "Chk", "type": "checking"}
    ).json()["id"]
    m1 = _shift_month(dt.date.today(), -1)   # inside a 3-month window
    m2 = _shift_month(dt.date.today(), -2)
    m9 = _shift_month(dt.date.today(), -9)   # outside it
    csv_data = (
        "Date,Amount,Description,Category\n"
        f"{m1},-300.00,Green Basket,groceries\n"
        f"{m2},-200.00,Green Basket,groceries\n"
        f"{m1},-60.00,StreamCo,\n"
        f"{m1},-1000.00,To brokerage,transfer\n"
        f"{m1},50.00,Refund,groceries\n"
        f"{m9},-999.00,Old grocery run,groceries\n"
    )
    resp = authed.post(
        "/api/v1/import/commit",
        files={"file": ("t.csv", csv_data, "text/csv")},
        data={"kind": "csv", "account_id": str(acc_id),
              "mapping": '{"date": "Date", "amount": "Amount",'
                         ' "payee": "Description", "category": "Category"}'},
    )
    assert resp.json()["imported"] == 6

    body = authed.get("/api/v1/spending/observed?months=3").json()
    # transfers and inflows excluded; the 9-month-old row is out of window
    assert body["by_category"] == [
        {"category": "groceries", "monthly_avg": round(500.0 / 3, 2), "txn_count": 2},
        {"category": "uncategorized", "monthly_avg": 20.0, "txn_count": 1},
    ]
    assert body["total_monthly_avg"] == round(560.0 / 3, 2)
