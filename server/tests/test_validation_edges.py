"""T-003 API validation edges: absurd inputs and degenerate plan horizons must
return the documented error envelope ({"error": {"code", "message"}}), never a
500. See DEFECT D-001 (start_age > life_expectancy 500) in T-003 log.
"""

from __future__ import annotations


def _envelope(resp, status: int, code: str | None = None):
    assert resp.status_code == status, resp.text
    body = resp.json()
    assert set(body) == {"error"}
    assert set(body["error"]) == {"code", "message"}
    if code is not None:
        assert body["error"]["code"] == code
    return body


# --- degenerate plan horizons (D-001) --------------------------------------


def _self_id(authed) -> int:
    return next(
        m["id"] for m in authed.get("/api/v1/household").json() if m["role"] == "self"
    )


def test_life_expectancy_below_current_age_is_422_not_500(authed):
    """birth_year older than life_expectancy would crash the numpy engine."""
    resp = authed.patch(
        f"/api/v1/household/{_self_id(authed)}",
        json={"birth_year": 1900, "life_expectancy": 92},  # start_age ~126 > 92
    )
    assert resp.status_code == 200
    resp = authed.post("/api/v1/simulate", json={"scenario_id": 0, "n_paths": 50})
    _envelope(resp, 422, "invalid_plan_horizon")


def test_future_birth_year_is_422_not_negative_ages(authed):
    resp = authed.patch(
        f"/api/v1/household/{_self_id(authed)}", json={"birth_year": 2050}
    )
    assert resp.status_code == 200
    resp = authed.post("/api/v1/simulate", json={"scenario_id": 0, "n_paths": 50})
    _envelope(resp, 422, "invalid_plan_horizon")


def test_degenerate_horizon_also_guarded_in_compare(authed):
    authed.patch(
        f"/api/v1/household/{_self_id(authed)}",
        json={"birth_year": 1900, "life_expectancy": 92},
    )
    resp = authed.post(
        "/api/v1/scenarios/compare", json={"scenario_ids": [0], "n_paths": 50}
    )
    _envelope(resp, 422, "invalid_plan_horizon")


# --- n_paths bounds --------------------------------------------------------


def test_n_paths_zero_rejected(authed):
    _envelope(
        authed.post("/api/v1/simulate", json={"scenario_id": 0, "n_paths": 0}),
        422, "validation_error",
    )


def test_n_paths_one_accepted(authed):
    resp = authed.post("/api/v1/simulate", json={"scenario_id": 0, "n_paths": 1, "seed": 1})
    assert resp.status_code == 200
    assert resp.json()["n_paths"] == 1


def test_n_paths_at_cap_accepted(authed):
    resp = authed.post(
        "/api/v1/simulate", json={"scenario_id": 0, "n_paths": 10_000, "seed": 1}
    )
    assert resp.status_code == 200
    assert resp.json()["n_paths"] == 10_000


def test_n_paths_over_cap_rejected(authed):
    _envelope(
        authed.post("/api/v1/simulate", json={"scenario_id": 0, "n_paths": 10_001}),
        422, "validation_error",
    )


def test_negative_seed_rejected(authed):
    _envelope(
        authed.post("/api/v1/simulate", json={"scenario_id": 0, "seed": -1}),
        422, "validation_error",
    )


# --- absurd CRUD validation inputs -----------------------------------------


def test_goal_negative_target_amount_rejected(authed):
    _envelope(
        authed.post("/api/v1/goals", json={"name": "X", "target_amount": -100}),
        422, "validation_error",
    )


def test_goal_negative_funded_amount_rejected(authed):
    _envelope(
        authed.post(
            "/api/v1/goals",
            json={"name": "X", "target_amount": 100, "funded_amount": -5},
        ),
        422, "validation_error",
    )


def test_goal_priority_out_of_range_rejected(authed):
    _envelope(
        authed.post(
            "/api/v1/goals", json={"name": "X", "target_amount": 100, "priority": 9}
        ),
        422, "validation_error",
    )


def test_profile_negative_retirement_spending_rejected(authed):
    prof = authed.get("/api/v1/profile").json()
    prof["annual_retirement_spending"] = -1
    _envelope(authed.put("/api/v1/profile", json=prof), 422, "validation_error")


def test_profile_tax_rate_over_100_rejected(authed):
    prof = authed.get("/api/v1/profile").json()
    prof["effective_tax_rate_pct"] = 250
    _envelope(authed.put("/api/v1/profile", json=prof), 422, "validation_error")


def test_account_unknown_type_rejected(authed):
    _envelope(
        authed.post("/api/v1/accounts", json={"name": "X", "type": "yacht"}),
        422, "validation_error",
    )


def test_account_unknown_asset_class_rejected(authed):
    _envelope(
        authed.post(
            "/api/v1/accounts",
            json={"name": "X", "type": "brokerage", "asset_class": "crypto"},
        ),
        422, "validation_error",
    )


def test_flow_unknown_kind_rejected(authed):
    _envelope(
        authed.post(
            "/api/v1/flows", json={"name": "X", "kind": "gift", "amount_monthly": 10}
        ),
        422, "validation_error",
    )


def test_scenario_retirement_age_out_of_range_rejected(authed):
    _envelope(
        authed.post(
            "/api/v1/scenarios",
            json={"name": "X", "params": {"retirement_age": 5}},
        ),
        422, "validation_error",
    )


def test_scenario_unknown_param_key_rejected(authed):
    _envelope(
        authed.post("/api/v1/scenarios", json={"name": "X", "params": {"bogus": 1}}),
        422, "validation_error",
    )


def test_bad_date_format_uses_envelope(authed):
    _envelope(
        authed.post(
            "/api/v1/goals",
            json={"name": "X", "target_amount": 100, "target_date": "not-a-date"},
        ),
        422, "validation_error",
    )
