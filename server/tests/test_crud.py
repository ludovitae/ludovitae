from __future__ import annotations

import datetime as dt


def test_profile_roundtrip(authed):
    body = authed.get("/api/v1/profile").json()
    assert set(body) == {
        "birth_year", "retirement_age", "life_expectancy", "annual_retirement_spending",
        "social_security_monthly", "social_security_start_age", "inflation_pct",
        "effective_tax_rate_pct",
    }
    body.update(birth_year=1980, retirement_age=60, annual_retirement_spending=75_000.5)
    updated = authed.put("/api/v1/profile", json=body).json()
    assert updated["retirement_age"] == 60
    assert updated["annual_retirement_spending"] == 75_000.5
    assert authed.get("/api/v1/profile").json() == updated


def test_account_crud_and_balance_snapshots(authed):
    resp = authed.post(
        "/api/v1/accounts",
        json={"name": "Vanguard", "type": "brokerage", "balance": 250_000.0,
              "asset_class": "stocks", "institution": "Vanguard"},
    )
    assert resp.status_code == 201
    acc = resp.json()
    assert acc["balance"] == 250_000.0
    assert acc["created_at"] == dt.date.today().isoformat()

    # writing balance creates a snapshot dated today
    balances = authed.get(f"/api/v1/accounts/{acc['id']}/balances").json()
    assert balances == [{"date": dt.date.today().isoformat(), "amount": 250_000.0}]

    patched = authed.patch(f"/api/v1/accounts/{acc['id']}", json={"balance": 260_000.0}).json()
    assert patched["balance"] == 260_000.0
    assert len(authed.get(f"/api/v1/accounts/{acc['id']}/balances").json()) == 1  # same-day upsert

    authed.post(
        f"/api/v1/accounts/{acc['id']}/balances",
        json={"date": "2025-01-01", "amount": 200_000.0},
    )
    assert len(authed.get(f"/api/v1/accounts/{acc['id']}/balances").json()) == 2
    assert (
        authed.delete(f"/api/v1/accounts/{acc['id']}/balances/2025-01-01").status_code == 204
    )

    assert authed.delete(f"/api/v1/accounts/{acc['id']}").status_code == 204
    assert authed.get(f"/api/v1/accounts/{acc['id']}").status_code == 404


def test_account_type_validation(authed):
    resp = authed.post("/api/v1/accounts", json={"name": "X", "type": "yacht"})
    assert resp.status_code == 422
    assert resp.json()["error"]["code"] == "validation_error"


def test_flow_crud_and_contribution_requires_account(authed):
    resp = authed.post(
        "/api/v1/flows",
        json={"name": "401k", "kind": "contribution", "amount_monthly": 1500},
    )
    assert resp.status_code == 400
    assert resp.json()["error"]["code"] == "contribution_requires_account"

    acc = authed.post("/api/v1/accounts", json={"name": "401k", "type": "retirement"}).json()
    flow = authed.post(
        "/api/v1/flows",
        json={"name": "Salary", "kind": "income", "amount_monthly": 9500.0,
              "annual_growth_pct": 3.0, "ends_at_retirement": True},
    ).json()
    assert flow["ends_at_retirement"] is True

    patched = authed.patch(f"/api/v1/flows/{flow['id']}", json={"amount_monthly": 9800.0}).json()
    assert patched["amount_monthly"] == 9800.0

    contrib = authed.post(
        "/api/v1/flows",
        json={"name": "401k", "kind": "contribution", "amount_monthly": 1500,
              "account_id": acc["id"]},
    )
    assert contrib.status_code == 201
    assert authed.delete(f"/api/v1/flows/{flow['id']}").status_code == 204


def test_goal_crud(authed):
    goal = authed.post(
        "/api/v1/goals",
        json={"name": "Sailboat", "emoji": "⛵", "target_amount": 60_000.0,
              "target_date": "2032-06-01", "priority": 2, "funded_amount": 5000.0,
              "notes": "the dream"},
    ).json()
    assert goal["emoji"] == "⛵"
    assert goal["target_date"] == "2032-06-01"
    patched = authed.patch(f"/api/v1/goals/{goal['id']}", json={"funded_amount": 7500.0}).json()
    assert patched["funded_amount"] == 7500.0
    assert authed.delete(f"/api/v1/goals/{goal['id']}").status_code == 204


def test_scenarios_baseline_and_crud(authed):
    scenarios = authed.get("/api/v1/scenarios").json()
    assert scenarios[0]["id"] == 0
    assert scenarios[0]["is_baseline"] is True
    assert scenarios[0]["name"] == "Current trajectory"

    assert authed.patch("/api/v1/scenarios/0", json={"name": "X"}).status_code == 403
    assert authed.delete("/api/v1/scenarios/0").status_code == 403

    scn = authed.post(
        "/api/v1/scenarios",
        json={"name": "Retire at 55", "params": {
            "retirement_age": 55,
            "events": [{"name": "Golf", "kind": "recurring_expense",
                        "amount_monthly": 350.0, "start_age": 55}],
        }},
    ).json()
    assert scn["is_baseline"] is False
    assert scn["params"]["retirement_age"] == 55

    bad = authed.post(
        "/api/v1/scenarios",
        json={"name": "Bad", "params": {"events": [{"kind": "one_time"}]}},
    )
    assert bad.status_code == 422

    unknown_key = authed.post("/api/v1/scenarios", json={"name": "Bad", "params": {"nope": 1}})
    assert unknown_key.status_code == 422

    patched = authed.patch(
        f"/api/v1/scenarios/{scn['id']}", json={"description": "early retirement"}
    ).json()
    assert patched["description"] == "early retirement"
    assert authed.delete(f"/api/v1/scenarios/{scn['id']}").status_code == 204


def test_settings(authed):
    assert authed.get("/api/v1/settings").json() == {"theme": "fintech", "reduce_motion": False}
    updated = authed.patch("/api/v1/settings", json={"theme": "game"}).json()
    assert updated == {"theme": "game", "reduce_motion": False}
    assert authed.patch("/api/v1/settings", json={"theme": "neon"}).status_code == 422


def test_dashboard_aggregate(authed):
    authed.post(
        "/api/v1/accounts",
        json={"name": "Brokerage", "type": "brokerage", "balance": 250_000.0},
    )
    authed.post(
        "/api/v1/accounts",
        json={"name": "Mortgage", "type": "mortgage", "balance": 100_000.0},
    )
    authed.post(
        "/api/v1/flows", json={"name": "Salary", "kind": "income", "amount_monthly": 9000.0}
    )
    authed.post(
        "/api/v1/flows", json={"name": "Living", "kind": "expense", "amount_monthly": 5000.0}
    )
    body = authed.get("/api/v1/dashboard").json()
    assert body["assets"] == 250_000.0
    assert body["liabilities"] == 100_000.0
    assert body["net_worth"] == 150_000.0
    assert body["by_type"] == {"brokerage": 250_000.0, "mortgage": 100_000.0}
    assert body["monthly_surplus"] == 4000.0
    assert body["history"][-1]["net_worth"] == 150_000.0


def test_transactions_filters(authed):
    acc = authed.post("/api/v1/accounts", json={"name": "Chk", "type": "checking"}).json()
    csv_data = "Date,Amount,Description\n2026-01-05,-42.50,Coffee\n2026-02-01,-10.00,Bagel\n"
    resp = authed.post(
        "/api/v1/import/commit",
        files={"file": ("t.csv", csv_data, "text/csv")},
        data={"kind": "csv", "account_id": str(acc["id"]),
              "mapping": '{"date": "Date", "amount": "Amount", "payee": "Description"}'},
    )
    assert resp.json()["imported"] == 2
    rows = authed.get(f"/api/v1/transactions?account_id={acc['id']}&from=2026-01-20").json()
    assert len(rows) == 1
    assert rows[0]["payee"] == "Bagel"
    assert rows[0]["amount"] == -10.0
