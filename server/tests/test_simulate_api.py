"""API-level simulation tests: contract shape, caching, compare."""

from __future__ import annotations


def _setup_plan(authed):
    profile = authed.get("/api/v1/profile").json()
    profile.update(birth_year=1980, retirement_age=65)
    authed.put("/api/v1/profile", json=profile)
    authed.post(
        "/api/v1/accounts",
        json={"name": "Brokerage", "type": "brokerage", "balance": 400_000,
              "asset_class": "mixed"},
    )
    authed.post(
        "/api/v1/flows",
        json={"name": "Salary", "kind": "income", "amount_monthly": 9_000,
              "ends_at_retirement": True},
    )
    authed.post(
        "/api/v1/flows",
        json={"name": "Living", "kind": "expense", "amount_monthly": 5_000},
    )


def test_simulate_response_shape(authed):
    _setup_plan(authed)
    resp = authed.post("/api/v1/simulate", json={"scenario_id": 0, "seed": 42, "n_paths": 500})
    assert resp.status_code == 200
    body = resp.json()
    assert body["engine_version"] == "1"
    assert body["n_paths"] == 500
    assert body["seed"] == 42
    assert set(body["percentiles"]) == {"p10", "p25", "p50", "p75", "p90"}
    assert set(body["deterministic"]) == {"net_worth", "invested", "cash", "property", "debt"}
    assert set(body["ending_net_worth"]) == {"p10", "p50", "p90"}
    assert 0.0 <= body["success_probability"] <= 1.0
    assert len(body["ages"]) == len(body["percentiles"]["p50"])


def test_simulate_with_inline_params(authed):
    _setup_plan(authed)
    resp = authed.post(
        "/api/v1/simulate",
        json={"params": {"retirement_age": 55, "monthly_savings_delta": 500.0},
              "seed": 1, "n_paths": 300},
    )
    assert resp.status_code == 200


def test_simulate_rejects_both_scenario_and_params(authed):
    resp = authed.post("/api/v1/simulate", json={"scenario_id": 0, "params": {}})
    assert resp.status_code == 400


def test_simulate_unknown_scenario_404(authed):
    resp = authed.post("/api/v1/simulate", json={"scenario_id": 999})
    assert resp.status_code == 404
    assert resp.json()["error"]["code"] == "scenario_not_found"


def test_simulate_n_paths_cap(authed):
    resp = authed.post("/api/v1/simulate", json={"scenario_id": 0, "n_paths": 20_000})
    assert resp.status_code == 422


def test_simulate_seeded_cache_stable(authed):
    _setup_plan(authed)
    a = authed.post("/api/v1/simulate", json={"scenario_id": 0, "seed": 42, "n_paths": 300})
    b = authed.post("/api/v1/simulate", json={"scenario_id": 0, "seed": 42, "n_paths": 300})
    assert a.json() == b.json()

    # changing underlying data must invalidate the cached inputs
    authed.post(
        "/api/v1/accounts",
        json={"name": "Windfall", "type": "brokerage", "balance": 1_000_000},
    )
    c = authed.post("/api/v1/simulate", json={"scenario_id": 0, "seed": 42, "n_paths": 300})
    assert c.json() != a.json()


def test_compare_shape_and_order(authed):
    _setup_plan(authed)
    scn = authed.post(
        "/api/v1/scenarios", json={"name": "Retire at 55", "params": {"retirement_age": 55}}
    ).json()
    resp = authed.post(
        "/api/v1/scenarios/compare",
        json={"scenario_ids": [0, scn["id"]], "n_paths": 300, "seed": 42},
    )
    assert resp.status_code == 200
    results = resp.json()["results"]
    assert [r["scenario_id"] for r in results] == [0, scn["id"]]
    assert results[0]["name"] == "Current trajectory"
    assert results[1]["name"] == "Retire at 55"
    # earlier retirement should not beat the baseline on success probability
    assert results[1]["success_probability"] <= results[0]["success_probability"]
