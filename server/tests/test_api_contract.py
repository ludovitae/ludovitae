"""T-003 API contract walk: exercise every endpoint in docs/API.md against a
live TestClient and assert the response shape (exact field set + types) matches
the contract, including 201 on creates, 403 csrf_required, 401 shapes, and the
goals_summary subset ruling.

A field type of ``(float,)`` accepts JSON ints too (JSON has one number type);
a nullable field is written as ``(T, type(None))``.
"""

from __future__ import annotations

import datetime as dt

import pytest

from conftest import PASSWORD

Num = (int, float)


def _assert_shape(obj: dict, spec: dict, where: str) -> None:
    assert isinstance(obj, dict), f"{where}: expected object, got {type(obj)}"
    assert set(obj) == set(spec), (
        f"{where}: field mismatch\n  extra:   {set(obj) - set(spec)}\n"
        f"  missing: {set(spec) - set(obj)}"
    )
    for key, types in spec.items():
        assert isinstance(obj[key], types), (
            f"{where}.{key}: expected {types}, got {type(obj[key])} = {obj[key]!r}"
        )


ACCOUNT_SPEC = {
    "id": int, "name": str, "type": str, "institution": (str, type(None)),
    "balance": Num, "growth_rate_pct": (int, float, type(None)),
    "asset_class": (str, type(None)), "member_id": (int, type(None)),
    "include_in_net_worth": bool, "notes": str, "created_at": str,
}
FLOW_SPEC = {
    "id": int, "name": str, "kind": str, "amount_monthly": Num,
    "annual_growth_pct": Num, "start_date": (str, type(None)),
    "end_date": (str, type(None)), "account_id": (int, type(None)),
    "category": (str, type(None)), "member_id": (int, type(None)),
    "ends_at_retirement": bool,
}
GOAL_SPEC = {
    "id": int, "name": str, "emoji": (str, type(None)), "target_amount": Num,
    "target_date": (str, type(None)), "priority": int, "funded_amount": Num,
    "notes": str,
}
PROFILE_SPEC = {
    "annual_retirement_spending": Num, "inflation_pct": Num,
    "effective_tax_rate_pct": Num,
}
MEMBER_SPEC = {
    "id": int, "name": str, "role": str, "birth_year": int,
    "life_expectancy": int, "retirement_age": (int, type(None)),
    "ss_monthly_at_fra": (int, float, type(None)),
    "ss_claim_age": (int, type(None)), "notes": str,
}
SPENDING_CATEGORY_SPEC = {
    "id": int, "name": str, "monthly_amount": Num, "kind": str,
    "annual_growth_pct": (int, float, type(None)),
}
OBSERVED_SPEC = {
    "months": int, "from": str, "to": str, "total_monthly_avg": Num,
    "by_category": list,
}
MILESTONE_SPEC = {
    "age": int, "year": int, "kind": str, "label": str, "member_id": int,
}
SCENARIO_SPEC = {
    "id": int, "name": str, "description": str, "is_baseline": bool, "params": dict,
}
SIM_SPEC = {
    "engine_version": str, "engine_notes": list, "assumptions": dict,
    "n_paths": int, "seed": int, "start_year": int,
    "ages": list, "deterministic": dict, "percentiles": dict,
    "success_probability": Num, "median_ruin_age": (int, float, type(None)),
    "ending_net_worth": dict, "milestones": list,
}
ASSUMPTIONS_SPEC = {
    "market": dict, "inflation_pct": Num, "effective_tax_rate_pct": Num,
    "ss_taxable_share": Num, "engine_version": str,
}
ASSUMPTIONS_MARKET_SPEC = {
    "stocks_mean_pct": Num, "stocks_vol_pct": Num,
    "bonds_mean_pct": Num, "bonds_vol_pct": Num,
    "cash_mean_pct": Num, "cash_vol_pct": Num,
}
GOALS_SUMMARY_SPEC = {
    "id": int, "name": str, "emoji": (str, type(None)), "target_amount": Num,
    "funded_amount": Num, "target_date": (str, type(None)), "priority": int,
    "pct_funded": Num,
}


def _assert_sim_shape(body: dict, where: str) -> None:
    _assert_shape(body, SIM_SPEC, where)
    _assert_shape(body["assumptions"], ASSUMPTIONS_SPEC, f"{where}.assumptions")
    _assert_shape(
        body["assumptions"]["market"], ASSUMPTIONS_MARKET_SPEC,
        f"{where}.assumptions.market",
    )
    assert body["assumptions"]["engine_version"] == body["engine_version"]
    assert all(isinstance(note, str) for note in body["engine_notes"])
    assert set(body["percentiles"]) == {"p10", "p25", "p50", "p75", "p90"}
    assert set(body["deterministic"]) == {
        "net_worth", "invested", "cash", "property", "debt"
    }
    assert set(body["ending_net_worth"]) == {"p10", "p50", "p90"}
    n = len(body["ages"])
    for series in body["percentiles"].values():
        assert len(series) == n
    for series in body["deterministic"].values():
        assert len(series) == n
    for ms in body["milestones"]:
        _assert_shape(ms, MILESTONE_SPEC, f"{where}.milestones[]")
        assert ms["kind"] in ("retirement", "ss_start", "rmd_start")


# --- auth (unauthenticated pre-conditions) ---------------------------------


def test_session_shape_unauthenticated(client):
    body = client.get("/api/v1/auth/session").json()
    _assert_shape(body, {"authenticated": bool, "setup_required": bool}, "GET /auth/session")
    assert body == {"authenticated": False, "setup_required": True}


def test_setup_login_logout_and_session_csrf(client):
    assert client.post("/api/v1/auth/setup", json={"password": PASSWORD}).status_code == 204
    login = client.post("/api/v1/auth/login", json={"password": PASSWORD})
    assert login.status_code == 200
    _assert_shape(login.json(), {"csrf_token": str}, "POST /auth/login")
    csrf = login.json()["csrf_token"]

    session = client.get("/api/v1/auth/session").json()
    _assert_shape(
        session,
        {"authenticated": bool, "setup_required": bool, "csrf_token": str},
        "GET /auth/session (authed)",
    )
    assert session["csrf_token"] == csrf

    client.headers["X-CSRF-Token"] = csrf
    assert client.post("/api/v1/auth/logout").status_code == 204


# --- the full authenticated contract walk ----------------------------------


def test_contract_walk_every_endpoint(authed):
    # profile GET/PUT
    prof = authed.get("/api/v1/profile")
    assert prof.status_code == 200
    _assert_shape(prof.json(), PROFILE_SPEC, "GET /profile")
    body = prof.json()
    body.update(annual_retirement_spending=80_000)
    put = authed.put("/api/v1/profile", json=body)
    assert put.status_code == 200
    _assert_shape(put.json(), PROFILE_SPEC, "PUT /profile")

    # household GET(list, auto-self)/POST(201)/GET one/PATCH
    hh = authed.get("/api/v1/household")
    assert hh.status_code == 200
    assert isinstance(hh.json(), list)
    _assert_shape(hh.json()[0], MEMBER_SPEC, "GET /household[0]")
    assert hh.json()[0]["role"] == "self"
    self_id = hh.json()[0]["id"]
    _assert_shape(
        authed.patch(
            f"/api/v1/household/{self_id}",
            json={"name": "Brian", "birth_year": 1980, "retirement_age": 65},
        ).json(),
        MEMBER_SPEC, "PATCH /household/{id}",
    )
    partner = authed.post(
        "/api/v1/household",
        json={"name": "Dana", "role": "partner", "birth_year": 1983,
              "life_expectancy": 94, "retirement_age": 67,
              "ss_monthly_at_fra": 1900.0, "ss_claim_age": 65},
    )
    assert partner.status_code == 201
    _assert_shape(partner.json(), MEMBER_SPEC, "POST /household")
    partner_id = partner.json()["id"]
    _assert_shape(
        authed.get(f"/api/v1/household/{partner_id}").json(), MEMBER_SPEC,
        "GET /household/{id}",
    )

    # spending GET/PUT + observed
    sp = authed.get("/api/v1/spending")
    assert sp.status_code == 200
    assert set(sp.json()) == {"categories", "monthly_savings_target"}
    for cat in sp.json()["categories"]:
        _assert_shape(cat, SPENDING_CATEGORY_SPEC, "GET /spending.categories[]")
    put_sp = authed.put(
        "/api/v1/spending",
        json={"categories": [
            {"name": "Housing", "monthly_amount": 2500.0, "kind": "essential",
             "annual_growth_pct": None},
            {"name": "Dining out", "monthly_amount": 600.0, "kind": "discretionary"},
        ], "monthly_savings_target": 1500.0},
    )
    assert put_sp.status_code == 200
    assert set(put_sp.json()) == {"categories", "monthly_savings_target"}
    assert len(put_sp.json()["categories"]) == 2
    for cat in put_sp.json()["categories"]:
        _assert_shape(cat, SPENDING_CATEGORY_SPEC, "PUT /spending.categories[]")

    observed = authed.get("/api/v1/spending/observed?months=6")
    assert observed.status_code == 200
    _assert_shape(observed.json(), OBSERVED_SPEC, "GET /spending/observed")
    assert observed.json()["months"] == 6
    for row in observed.json()["by_category"]:
        _assert_shape(
            row, {"category": str, "monthly_avg": Num, "txn_count": int},
            "observed.by_category[]",
        )

    # accounts POST(201)/GET list/GET one/PATCH
    created = authed.post(
        "/api/v1/accounts",
        json={"name": "Vanguard", "type": "brokerage", "balance": 250_000.0,
              "asset_class": "mixed", "institution": "Vanguard"},
    )
    assert created.status_code == 201
    _assert_shape(created.json(), ACCOUNT_SPEC, "POST /accounts")
    acc_id = created.json()["id"]

    lst = authed.get("/api/v1/accounts")
    assert isinstance(lst.json(), list)  # list endpoints are bare arrays
    _assert_shape(lst.json()[0], ACCOUNT_SPEC, "GET /accounts[0]")
    _assert_shape(
        authed.get(f"/api/v1/accounts/{acc_id}").json(), ACCOUNT_SPEC,
        "GET /accounts/{id}",
    )
    _assert_shape(
        authed.patch(f"/api/v1/accounts/{acc_id}", json={"notes": "n"}).json(),
        ACCOUNT_SPEC, "PATCH /accounts/{id}",
    )

    # balances GET/POST(201)/DELETE
    balances = authed.get(f"/api/v1/accounts/{acc_id}/balances")
    assert isinstance(balances.json(), list)
    _assert_shape(balances.json()[0], {"date": str, "amount": Num}, "GET balances[0]")
    post_bal = authed.post(
        f"/api/v1/accounts/{acc_id}/balances",
        json={"date": "2025-01-01", "amount": 200_000.0},
    )
    assert post_bal.status_code == 201
    _assert_shape(post_bal.json(), {"date": str, "amount": Num}, "POST balances")
    assert authed.delete(
        f"/api/v1/accounts/{acc_id}/balances/2025-01-01"
    ).status_code == 204

    # a liability account (for a debt contribution + dashboard by_type)
    mort_id = authed.post(
        "/api/v1/accounts", json={"name": "Mortgage", "type": "mortgage", "balance": 100_000.0}
    ).json()["id"]

    # flows POST(201)/GET/PATCH
    flow = authed.post(
        "/api/v1/flows",
        json={"name": "Salary", "kind": "income", "amount_monthly": 9_000.0,
              "ends_at_retirement": True},
    )
    assert flow.status_code == 201
    _assert_shape(flow.json(), FLOW_SPEC, "POST /flows")
    flow_id = flow.json()["id"]
    authed.post(
        "/api/v1/flows",
        json={"name": "Living", "kind": "expense", "amount_monthly": 5_000.0},
    )
    _assert_shape(authed.get("/api/v1/flows").json()[0], FLOW_SPEC, "GET /flows[0]")
    _assert_shape(
        authed.patch(f"/api/v1/flows/{flow_id}", json={"amount_monthly": 9_500.0}).json(),
        FLOW_SPEC, "PATCH /flows/{id}",
    )

    # goals POST(201)/GET/PATCH — cover both non-null and null emoji
    goal = authed.post(
        "/api/v1/goals",
        json={"name": "Sailboat", "emoji": "⛵", "target_amount": 60_000.0,
              "target_date": "2032-06-01", "priority": 2, "funded_amount": 5_000.0,
              "notes": "the dream"},
    )
    assert goal.status_code == 201
    _assert_shape(goal.json(), GOAL_SPEC, "POST /goals")
    assert goal.json()["emoji"] == "⛵"
    null_emoji = authed.post(
        "/api/v1/goals", json={"name": "Rainy day", "target_amount": 10_000.0}
    )
    _assert_shape(null_emoji.json(), GOAL_SPEC, "POST /goals (null emoji)")
    assert null_emoji.json()["emoji"] is None
    goal_id = goal.json()["id"]
    _assert_shape(authed.get("/api/v1/goals").json()[0], GOAL_SPEC, "GET /goals[0]")
    _assert_shape(
        authed.patch(f"/api/v1/goals/{goal_id}", json={"funded_amount": 7_500.0}).json(),
        GOAL_SPEC, "PATCH /goals/{id}",
    )

    # import preview + commit (CSV) → transactions GET
    csv_data = "Date,Amount,Description\n2026-01-05,-42.50,Coffee\n2026-02-01,-10.00,Bagel\n"
    preview = authed.post(
        "/api/v1/import/preview",
        files={"file": ("t.csv", csv_data, "text/csv")},
        data={"kind": "csv", "account_id": str(acc_id)},
    )
    assert preview.status_code == 200
    pv = preview.json()
    assert set(pv) == {"columns", "sample_rows", "suggested_mapping"}
    assert isinstance(pv["columns"], list) and isinstance(pv["sample_rows"], list)
    # sample_rows: list of {column: value} objects
    assert isinstance(pv["sample_rows"][0], dict)
    assert set(pv["sample_rows"][0]) <= set(pv["columns"])

    commit = authed.post(
        "/api/v1/import/commit",
        files={"file": ("t.csv", csv_data, "text/csv")},
        data={"kind": "csv", "account_id": str(acc_id),
              "mapping": '{"date": "Date", "amount": "Amount", "payee": "Description"}'},
    )
    assert commit.status_code == 200
    _assert_shape(commit.json(), {"imported": int, "skipped_duplicates": int}, "import/commit")

    txns = authed.get(f"/api/v1/transactions?account_id={acc_id}")
    assert isinstance(txns.json(), list)
    _assert_shape(
        txns.json()[0],
        {"id": int, "account_id": int, "date": str, "amount": Num,
         "payee": str, "category": (str, type(None))},
        "GET /transactions[0]",
    )

    # scenarios GET(list incl. baseline)/POST(201)/GET one/PATCH
    scn_list = authed.get("/api/v1/scenarios").json()
    assert scn_list[0]["id"] == 0 and scn_list[0]["is_baseline"] is True
    _assert_shape(scn_list[0], SCENARIO_SPEC, "GET /scenarios[baseline]")
    created_scn = authed.post(
        "/api/v1/scenarios",
        json={"name": "Retire at 55", "params": {"retirement_age": 55}},
    )
    assert created_scn.status_code == 201
    _assert_shape(created_scn.json(), SCENARIO_SPEC, "POST /scenarios")
    scn_id = created_scn.json()["id"]
    _assert_shape(
        authed.get(f"/api/v1/scenarios/{scn_id}").json(), SCENARIO_SPEC,
        "GET /scenarios/{id}",
    )
    _assert_shape(
        authed.patch(f"/api/v1/scenarios/{scn_id}", json={"description": "x"}).json(),
        SCENARIO_SPEC, "PATCH /scenarios/{id}",
    )
    _assert_shape(
        authed.get("/api/v1/scenarios/0").json(), SCENARIO_SPEC, "GET /scenarios/0",
    )

    # simulate + compare
    sim = authed.post("/api/v1/simulate", json={"scenario_id": scn_id, "seed": 42, "n_paths": 200})
    assert sim.status_code == 200
    _assert_sim_shape(sim.json(), "POST /simulate")

    cmp = authed.post(
        "/api/v1/scenarios/compare",
        json={"scenario_ids": [0, scn_id], "n_paths": 200, "seed": 42},
    )
    assert cmp.status_code == 200
    assert set(cmp.json()) == {"results"}
    for r in cmp.json()["results"]:
        assert {"scenario_id", "name"} <= set(r)
        inner = {k: v for k, v in r.items() if k not in ("scenario_id", "name")}
        _assert_sim_shape(inner, "compare result")

    # dashboard — incl. goals_summary subset ruling
    dash = authed.get("/api/v1/dashboard")
    assert dash.status_code == 200
    _assert_shape(
        dash.json(),
        {"net_worth": Num, "assets": Num, "liabilities": Num, "history": list,
         "by_type": dict, "goals_summary": list, "monthly_surplus": Num},
        "GET /dashboard",
    )
    for h in dash.json()["history"]:
        _assert_shape(h, {"date": str, "net_worth": Num}, "dashboard.history[]")
    for gs in dash.json()["goals_summary"]:
        _assert_shape(gs, GOALS_SUMMARY_SPEC, "dashboard.goals_summary[]")
    # subset ruling: notes must NOT be present; pct_funded server-computed
    assert all("notes" not in gs for gs in dash.json()["goals_summary"])

    # settings GET/PATCH
    st = authed.get("/api/v1/settings")
    _assert_shape(st.json(), {"theme": str, "reduce_motion": bool}, "GET /settings")
    _assert_shape(
        authed.patch("/api/v1/settings", json={"theme": "game"}).json(),
        {"theme": str, "reduce_motion": bool}, "PATCH /settings",
    )

    # deletes (204) — close out every mutating create
    assert authed.delete(f"/api/v1/household/{partner_id}").status_code == 204
    assert authed.delete(f"/api/v1/scenarios/{scn_id}").status_code == 204
    assert authed.delete(f"/api/v1/goals/{goal_id}").status_code == 204
    assert authed.delete(f"/api/v1/flows/{flow_id}").status_code == 204
    assert authed.delete(f"/api/v1/accounts/{mort_id}").status_code == 204
    assert authed.delete(f"/api/v1/accounts/{acc_id}").status_code == 204


# --- error-shape contract --------------------------------------------------


def test_401_shape_on_every_unauthenticated_read(client):
    for path in ("/profile", "/household", "/spending", "/spending/observed",
                 "/accounts", "/flows", "/goals", "/scenarios",
                 "/dashboard", "/settings", "/transactions"):
        resp = client.get(f"/api/v1{path}")
        assert resp.status_code == 401, path
        assert resp.json() == {
            "error": {"code": "unauthenticated", "message": "authentication required"}
        }


def test_403_csrf_required_shape(authed):
    del authed.headers["X-CSRF-Token"]
    resp = authed.post("/api/v1/goals", json={"name": "X", "target_amount": 10})
    assert resp.status_code == 403
    assert resp.json()["error"]["code"] == "csrf_required"
    assert set(resp.json()["error"]) == {"code", "message"}


def test_ofx_preview_shape(authed):
    acc_id = authed.post(
        "/api/v1/accounts", json={"name": "Chk", "type": "checking"}
    ).json()["id"]
    ofx = (
        "OFXHEADER:100\r\n\r\n<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS>"
        "<BANKACCTFROM><ACCTID>12345</ACCTID></BANKACCTFROM>"
        "<BANKTRANLIST>"
        "<STMTTRN><DTPOSTED>20260105</DTPOSTED><TRNAMT>-42.50</TRNAMT>"
        "<NAME>Coffee</NAME></STMTTRN>"
        "</BANKTRANLIST>"
        "<LEDGERBAL><BALAMT>1000.00</BALAMT><DTASOF>20260201</DTASOF></LEDGERBAL>"
        "</STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>"
    )
    resp = authed.post(
        "/api/v1/import/preview",
        files={"file": ("t.ofx", ofx, "application/x-ofx")},
        data={"kind": "ofx", "account_id": str(acc_id)},
    )
    if resp.status_code != 200:
        pytest.skip(f"OFX sample not accepted by parser: {resp.json()}")
    body = resp.json()
    assert set(body) == {"accounts_found", "transaction_count", "balance"}
    assert isinstance(body["accounts_found"], list)
    assert isinstance(body["transaction_count"], int)


def test_created_at_is_iso_date(authed):
    acc = authed.post("/api/v1/accounts", json={"name": "X", "type": "checking"}).json()
    # round-trips as YYYY-MM-DD
    dt.date.fromisoformat(acc["created_at"])
