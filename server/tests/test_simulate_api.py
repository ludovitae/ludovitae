"""API-level simulation tests: contract shape, caching, compare."""

from __future__ import annotations


def _setup_plan(authed) -> int:
    """Basic plan; returns the self member id."""
    self_id = next(
        m["id"] for m in authed.get("/api/v1/household").json() if m["role"] == "self"
    )
    authed.patch(
        f"/api/v1/household/{self_id}",
        json={"name": "Brian", "birth_year": 1980, "retirement_age": 65,
              "life_expectancy": 92, "ss_monthly_at_fra": 2_200.0,
              "ss_claim_age": 67},
    )
    authed.post(
        "/api/v1/accounts",
        json={"name": "Brokerage", "type": "brokerage", "balance": 400_000,
              "asset_class": "mixed"},
    )
    authed.post(
        "/api/v1/flows",
        json={"name": "Salary", "kind": "income", "amount_monthly": 9_000,
              "member_id": self_id, "ends_at_retirement": True},
    )
    authed.post(
        "/api/v1/flows",
        json={"name": "Living", "kind": "expense", "amount_monthly": 5_000},
    )
    return self_id


def test_simulate_response_shape(authed):
    _setup_plan(authed)
    resp = authed.post("/api/v1/simulate", json={"scenario_id": 0, "seed": 42, "n_paths": 500})
    assert resp.status_code == 200
    body = resp.json()
    assert body["engine_version"] == "4"
    assert len(body["engine_notes"]) == 3
    assert all(isinstance(n, str) for n in body["engine_notes"])
    assert "tax treatment" in body["engine_notes"][0]  # v4 (#25) leads the list
    assert "tax_model=brackets" in body["engine_notes"][1]
    assert "tax_model=flat" in body["engine_notes"][2]
    assert body["n_paths"] == 500
    assert body["seed"] == 42
    assert set(body["percentiles"]) == {"p10", "p25", "p50", "p75", "p90"}
    assert set(body["deterministic"]) == {"net_worth", "invested", "cash", "property", "debt"}
    assert set(body["ending_net_worth"]) == {"p10", "p50", "p90"}
    assert 0.0 <= body["success_probability"] <= 1.0
    assert len(body["ages"]) == len(body["percentiles"]["p50"])
    # v1.1: milestones on the self age axis, sorted by age
    kinds = [(m["kind"], m["age"]) for m in body["milestones"]]
    assert ("retirement", 65) in kinds
    assert ("ss_start", 67) in kinds
    labels = {m["kind"]: m["label"] for m in body["milestones"]}
    assert labels["retirement"] == "Brian retires"
    assert labels["ss_start"] == "Brian claims Social Security (100% of FRA)"
    ages = [m["age"] for m in body["milestones"]]
    assert ages == sorted(ages)


def test_simulate_assumptions_reflect_inputs_used(authed):
    """T-011: the assumptions block reports what the run actually used —
    profile knobs AND scenario param overrides — not re-read DB state.
    T-012: a set flat override selects tax_model 'flat' with the v2 fields."""
    _setup_plan(authed)
    authed.put(
        "/api/v1/profile",
        json={"annual_retirement_spending": 80_000, "inflation_pct": 2.5,
              "effective_tax_rate_pct": 22.0},
    )
    baseline = authed.post(
        "/api/v1/simulate", json={"scenario_id": 0, "seed": 7, "n_paths": 100}
    ).json()
    assert baseline["assumptions"] == {
        "market": {"stocks_mean_pct": 7.0, "stocks_vol_pct": 15.0,
                   "bonds_mean_pct": 3.5, "bonds_vol_pct": 7.0,
                   "cash_mean_pct": 1.5, "cash_vol_pct": 0.5},
        "inflation_pct": 2.5,
        "tax_model": "flat",
        "effective_tax_rate_pct": 22.0,
        "ss_taxable_share": 0.85,
        "engine_version": "4",
    }
    # scenario overrides flow into the assumptions (means overridden, vols kept)
    custom = authed.post(
        "/api/v1/simulate",
        json={"params": {"return_override_pct": 5.0, "inflation_override_pct": 3.1},
              "seed": 7, "n_paths": 100},
    ).json()
    assert custom["assumptions"]["market"] == {
        "stocks_mean_pct": 5.0, "stocks_vol_pct": 15.0,
        "bonds_mean_pct": 5.0, "bonds_vol_pct": 7.0,
        "cash_mean_pct": 5.0, "cash_vol_pct": 0.5,
    }
    assert custom["assumptions"]["inflation_pct"] == 3.1
    assert custom["assumptions"]["effective_tax_rate_pct"] == 22.0
    assert custom["assumptions"]["tax_model"] == "flat"


def test_simulate_assumptions_bracket_mode_and_filing_status(authed):
    """T-012 phase 2: a null flat-tax override (fresh-profile default) runs
    the bracket model; assumptions carry tax_model + filing_status and drop
    the flat-mode fields. Filing status: mfj iff >= 2 members with role in
    {self, partner}; `other` adults and children never make it mfj."""
    _setup_plan(authed)  # fresh profile -> effective_tax_rate_pct null
    body = authed.post(
        "/api/v1/simulate", json={"scenario_id": 0, "seed": 7, "n_paths": 100}
    ).json()
    assert body["assumptions"]["tax_model"] == "brackets"
    assert body["assumptions"]["filing_status"] == "single"
    assert "effective_tax_rate_pct" not in body["assumptions"]
    assert "ss_taxable_share" not in body["assumptions"]

    # an `other` adult does NOT change the filing status (coordinator ruling)
    authed.post(
        "/api/v1/household",
        json={"name": "Mom", "role": "other", "birth_year": 1955,
              "life_expectancy": 95},
    )
    body = authed.post(
        "/api/v1/simulate", json={"scenario_id": 0, "seed": 7, "n_paths": 100}
    ).json()
    assert body["assumptions"]["filing_status"] == "single"

    # a partner does: self + partner -> mfj
    authed.post(
        "/api/v1/household",
        json={"name": "Dana", "role": "partner", "birth_year": 1983,
              "life_expectancy": 94},
    )
    body = authed.post(
        "/api/v1/simulate", json={"scenario_id": 0, "seed": 7, "n_paths": 100}
    ).json()
    assert body["assumptions"]["filing_status"] == "mfj"


def test_profile_flat_override_roundtrips_null(authed):
    """The flat-tax knob is nullable (v1.2.2): null clears the override."""
    prof = authed.get("/api/v1/profile").json()
    assert prof["effective_tax_rate_pct"] is None  # fresh profiles: brackets
    prof["effective_tax_rate_pct"] = 22.0
    assert authed.put("/api/v1/profile", json=prof).json()[
        "effective_tax_rate_pct"] == 22.0
    prof["effective_tax_rate_pct"] = None
    assert authed.put("/api/v1/profile", json=prof).json()[
        "effective_tax_rate_pct"] is None


def test_compare_results_carry_assumptions(authed):
    _setup_plan(authed)
    scn = authed.post(
        "/api/v1/scenarios",
        json={"name": "Cautious", "params": {"return_override_pct": 4.0}},
    ).json()
    results = authed.post(
        "/api/v1/scenarios/compare",
        json={"scenario_ids": [0, scn["id"]], "n_paths": 100, "seed": 7},
    ).json()["results"]
    assert results[0]["assumptions"]["market"]["stocks_mean_pct"] == 7.0
    assert results[1]["assumptions"]["market"]["stocks_mean_pct"] == 4.0
    for r in results:
        assert r["engine_version"] == "4"
        assert len(r["engine_notes"]) == 3
        # fresh profile -> null override -> bracket mode
        assert r["assumptions"]["tax_model"] == "brackets"
        assert r["assumptions"]["filing_status"] == "single"


def test_simulate_member_overrides_move_milestones(authed):
    self_id = _setup_plan(authed)
    partner_id = authed.post(
        "/api/v1/household",
        json={"name": "Dana", "role": "partner", "birth_year": 1983,
              "life_expectancy": 94, "retirement_age": 67,
              "ss_monthly_at_fra": 1_900.0, "ss_claim_age": 67},
    ).json()["id"]
    resp = authed.post(
        "/api/v1/simulate",
        json={"params": {
            "retirement_age": 55,  # sugar for self
            "member_overrides": {str(partner_id): {"retirement_age": 60,
                                                    "ss_claim_age": 62}},
        }, "seed": 9, "n_paths": 200},
    )
    assert resp.status_code == 200
    ms = resp.json()["milestones"]
    retire = {m["member_id"]: m["age"] for m in ms if m["kind"] == "retirement"}
    # self retires at 55; Dana (3 years younger) retires at 60 -> self age 63
    assert retire == {self_id: 55, partner_id: 63}
    dana_ss = [m for m in ms if m["kind"] == "ss_start" and m["member_id"] == partner_id]
    assert dana_ss[0]["label"] == "Dana claims Social Security (70% of FRA)"


def test_child_never_extends_horizon(authed):
    """Ruling 2026-07-11: horizon = latest life expectancy among ADULT
    members; a young child (decades of remaining life expectancy) must not
    stretch the simulation."""
    _setup_plan(authed)  # self: born 1980, le 92
    authed.post(
        "/api/v1/household",
        json={"name": "Dana", "role": "partner", "birth_year": 1983,
              "life_expectancy": 94},
    )
    authed.post(
        "/api/v1/household",
        json={"name": "Riley", "role": "child", "birth_year": 2014,
              "life_expectancy": 92},
    )
    body = authed.post(
        "/api/v1/simulate", json={"scenario_id": 0, "seed": 2, "n_paths": 100}
    ).json()
    # horizon ends with the oldest-living ADULT: Dana (born 1983, le 94) is
    # alive through 2077, when self (born 1980) is 97 — not the child's 2106.
    assert body["ages"][-1] == 97


def test_child_role_creates_no_schedules_or_milestones(authed):
    """Even if a child member carries retirement/SS fields, the sim ignores
    them: no milestones, no horizon effect, no household-transition effect."""
    _setup_plan(authed)
    child_id = authed.post(
        "/api/v1/household",
        json={"name": "Riley", "role": "child", "birth_year": 2014,
              "life_expectancy": 92, "retirement_age": 70,
              "ss_monthly_at_fra": 1_000.0, "ss_claim_age": 70},
    ).json()["id"]
    body = authed.post(
        "/api/v1/simulate", json={"scenario_id": 0, "seed": 2, "n_paths": 100}
    ).json()
    assert body["ages"][-1] == 92  # self's own life expectancy caps the plan
    assert not any(m["member_id"] == child_id for m in body["milestones"])


def test_simulate_spending_delta_pct_cuts_spending(authed):
    _setup_plan(authed)
    authed.put(
        "/api/v1/spending",
        json={"categories": [{"name": "Everything", "monthly_amount": 1_000.0,
                              "kind": "essential"}],
              "monthly_savings_target": 0},
    )
    base = authed.post(
        "/api/v1/simulate", json={"scenario_id": 0, "seed": 4, "n_paths": 300}
    ).json()
    trimmed = authed.post(
        "/api/v1/simulate",
        json={"params": {"spending_delta_pct": -25.0}, "seed": 4, "n_paths": 300},
    ).json()
    boosted = authed.post(
        "/api/v1/simulate",
        json={"params": {"spending_delta_pct": 25.0}, "seed": 4, "n_paths": 300},
    ).json()
    assert (trimmed["ending_net_worth"]["p50"] > base["ending_net_worth"]["p50"]
            > boosted["ending_net_worth"]["p50"])


def test_scenario_member_overrides_validation(authed):
    bad_key = authed.post(
        "/api/v1/scenarios",
        json={"name": "X", "params": {"member_overrides": {"dana": {"retirement_age": 60}}}},
    )
    assert bad_key.status_code == 422
    bad_claim = authed.post(
        "/api/v1/scenarios",
        json={"name": "X", "params": {"member_overrides": {"2": {"ss_claim_age": 61}}}},
    )
    assert bad_claim.status_code == 422
    bad_field = authed.post(
        "/api/v1/scenarios",
        json={"name": "X", "params": {"member_overrides": {"2": {"name": "Nope"}}}},
    )
    assert bad_field.status_code == 422
    ok = authed.post(
        "/api/v1/scenarios",
        json={"name": "OK", "params": {
            "member_overrides": {"2": {"retirement_age": 60, "ss_claim_age": 62}},
            "spending_delta_pct": -10.0,
        }},
    )
    assert ok.status_code == 201
    assert ok.json()["params"]["member_overrides"] == {
        "2": {"retirement_age": 60, "ss_claim_age": 62}
    }


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
    # each compare result carries its own milestone list
    base_ret = [m for m in results[0]["milestones"] if m["kind"] == "retirement"]
    scn_ret = [m for m in results[1]["milestones"] if m["kind"] == "retirement"]
    assert base_ret[0]["age"] == 65
    assert scn_ret[0]["age"] == 55
