"""T-003 sim-engine edge cases: degenerate horizons, boundary demographics,
and empty/all-debt households. These assert the engine and the /simulate API
degrade gracefully — valid shapes or documented validation errors, never 500s.
"""

from __future__ import annotations

import pytest

from gol.sim import FlowSpec, PlanInputs, run_simulation

PCTL_KEYS = {"p10", "p25", "p50", "p75", "p90"}
DET_KEYS = {"net_worth", "invested", "cash", "property", "debt"}


def _plan(**overrides) -> PlanInputs:
    base = dict(
        start_age=46, retirement_age=65, life_expectancy=92, start_year=2026,
    )
    base.update(overrides)
    return PlanInputs(**base)


def _assert_valid_shape(result: dict, expected_years: int) -> None:
    assert len(result["ages"]) == expected_years
    for series in result["deterministic"].values():
        assert len(series) == expected_years
    for series in result["percentiles"].values():
        assert len(series) == expected_years
    assert set(result["percentiles"]) == PCTL_KEYS
    assert set(result["deterministic"]) == DET_KEYS
    assert 0.0 <= result["success_probability"] <= 1.0
    # percentile bands stay ordered at every age
    p = result["percentiles"]
    for i in range(expected_years):
        assert p["p10"][i] <= p["p25"][i] <= p["p50"][i] <= p["p75"][i] <= p["p90"][i]


# --- boundary demographics -------------------------------------------------


def test_retirement_age_already_passed_at_start():
    """retirement_age < start_age: retirement transition applies from month 0."""
    r = run_simulation(
        _plan(retirement_age=40, cash0=50_000, invested0=400_000,
              annual_retirement_spending=60_000),
        n_paths=200, seed=7,
    )
    _assert_valid_shape(r, 47)


def test_retirement_age_at_life_expectancy():
    """retirement_age == life_expectancy: no meaningful retirement window."""
    r = run_simulation(
        _plan(retirement_age=92, invested0=500_000), n_paths=200, seed=7
    )
    _assert_valid_shape(r, 47)


def test_retirement_age_beyond_life_expectancy():
    """retirement_age > life_expectancy is clamped, not crash."""
    r = run_simulation(
        _plan(retirement_age=110, invested0=500_000), n_paths=200, seed=7
    )
    _assert_valid_shape(r, 47)


def test_start_age_equals_life_expectancy_single_year():
    r = run_simulation(_plan(start_age=92, retirement_age=65), n_paths=50, seed=1)
    _assert_valid_shape(r, 1)
    assert r["ages"] == [92]


# --- household composition --------------------------------------------------


def test_zero_income_household():
    """No income flows: spending draws down assets; still a valid run."""
    r = run_simulation(
        _plan(cash0=20_000, invested0=100_000,
              flows=(FlowSpec("expense", 4_000, stops_at_retirement=True),),
              annual_retirement_spending=50_000),
        n_paths=200, seed=3,
    )
    _assert_valid_shape(r, 47)


def test_all_debt_household():
    """Only liabilities, no assets: net worth negative from the start."""
    r = run_simulation(
        _plan(debt0=300_000, debt_growth_pct=5.0), n_paths=200, seed=3
    )
    _assert_valid_shape(r, 47)
    assert r["deterministic"]["net_worth"][0] < 0
    assert r["success_probability"] == 0.0
    # already underwater → ruin reported at the start age
    assert r["median_ruin_age"] == pytest.approx(46.0)


def test_negative_net_worth_start_recoverable():
    """Debt exceeds assets at t0 but strong income can climb out."""
    r = run_simulation(
        _plan(cash0=10_000, invested0=50_000, debt0=200_000,
              flows=(
                  FlowSpec("income", 15_000, stops_at_retirement=True),
                  FlowSpec("expense", 4_000, stops_at_retirement=True),
                  FlowSpec("contrib_debt", 5_000),
              )),
        n_paths=300, seed=11,
    )
    _assert_valid_shape(r, 47)
    assert r["deterministic"]["net_worth"][0] < 0
    # net worth trends upward as debt is paid and income invested
    assert r["deterministic"]["net_worth"][-1] > r["deterministic"]["net_worth"][0]


def test_empty_household_all_zero():
    """Everything zero: valid response, immediate ruin under any spending."""
    r = run_simulation(
        _plan(annual_retirement_spending=80_000), n_paths=100, seed=1
    )
    _assert_valid_shape(r, 47)
    assert r["success_probability"] == 0.0


# --- events at/beyond life expectancy --------------------------------------


def test_one_time_event_beyond_horizon_is_ignored():
    from gol.sim.types import OneTimeEvent

    beyond = _plan(invested0=500_000,
                   one_time_events=(OneTimeEvent(month=99_999, amount=1_000_000),))
    within = _plan(invested0=500_000)
    r_beyond = run_simulation(beyond, n_paths=100, seed=5)
    r_within = run_simulation(within, n_paths=100, seed=5)
    # an event past the plan horizon has no effect on any output
    assert r_beyond == r_within


def test_recurring_flow_past_horizon_is_clipped():
    late = _plan(invested0=500_000,
                 flows=(FlowSpec("income", 5_000, start_month=10_000),))
    r = run_simulation(late, n_paths=100, seed=5)
    baseline = run_simulation(_plan(invested0=500_000), n_paths=100, seed=5)
    assert r == baseline


# --- n_paths bounds at the engine level ------------------------------------


def test_single_path_still_produces_bands():
    r = run_simulation(_plan(invested0=500_000), n_paths=1, seed=1)
    _assert_valid_shape(r, 47)
    # with one path all percentile bands coincide
    p = r["percentiles"]
    assert p["p10"][-1] == p["p90"][-1]


def test_large_path_count_within_cap():
    r = run_simulation(_plan(invested0=500_000), n_paths=10_000, seed=1)
    assert r["n_paths"] == 10_000
    _assert_valid_shape(r, 47)
