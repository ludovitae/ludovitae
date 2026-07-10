"""Engine tests: golden pinned-seed values, determinism, sanity properties."""

from __future__ import annotations

import time

import pytest

from gol.sim import FlowSpec, PlanInputs, run_simulation


def base_inputs(**overrides) -> PlanInputs:
    params = dict(
        start_age=46, retirement_age=65, life_expectancy=92, start_year=2026,
        cash0=50_000, invested0=600_000, property0=500_000, debt0=300_000,
        invested_weights=(0.7, 0.25, 0.05), retirement_share=0.6,
        property_growth_pct=3.0, debt_growth_pct=5.0,
        flows=(
            FlowSpec("income", 9_500, 3.0, stops_at_retirement=True),
            FlowSpec("expense", 5_200, 2.5, stops_at_retirement=True),
            FlowSpec("contrib_invested", 1_500, stops_at_retirement=True),
            FlowSpec("contrib_debt", 2_200),
        ),
        annual_retirement_spending=80_000, social_security_monthly=2_200, ss_start_age=67,
        inflation_mean_pct=2.5, effective_tax_rate_pct=18.0,
    )
    params.update(overrides)
    return PlanInputs(**params)


@pytest.fixture(scope="module")
def golden_result():
    return run_simulation(base_inputs(), n_paths=1000, seed=1234)


class TestGolden:
    """Pinned seed 1234, 1000 paths — values locked at engine version 1."""

    @pytest.fixture()
    def result(self, golden_result):
        return golden_result

    def test_shapes(self, result):
        assert result["ages"][0] == 46
        assert result["ages"][-1] == 92
        assert len(result["ages"]) == 47
        for series in result["deterministic"].values():
            assert len(series) == 47
        for series in result["percentiles"].values():
            assert len(series) == 47

    def test_pinned_values(self, result):
        assert result["success_probability"] == pytest.approx(0.739)
        assert result["median_ruin_age"] == pytest.approx(86.3)
        assert result["deterministic"]["net_worth"][0] == pytest.approx(918_579.96)
        assert result["deterministic"]["net_worth"][-1] == pytest.approx(4_499_929.33)
        assert result["percentiles"]["p10"][0] == pytest.approx(825_671.68)
        assert result["percentiles"]["p50"][-1] == pytest.approx(2_641_539.39)
        assert result["ending_net_worth"]["p10"] == pytest.approx(-1_806_169.72)
        assert result["ending_net_worth"]["p50"] == pytest.approx(2_641_539.39)
        assert result["ending_net_worth"]["p90"] == pytest.approx(12_925_104.75)


def test_same_seed_identical_output():
    a = run_simulation(base_inputs(), n_paths=500, seed=42)
    b = run_simulation(base_inputs(), n_paths=500, seed=42)
    assert a == b


def test_different_seed_different_output():
    a = run_simulation(base_inputs(), n_paths=500, seed=42)
    b = run_simulation(base_inputs(), n_paths=500, seed=43)
    assert a["percentiles"]["p50"] != b["percentiles"]["p50"]


def test_percentile_bands_ordered():
    r = run_simulation(base_inputs(), n_paths=1000, seed=7)
    p = r["percentiles"]
    for i in range(len(r["ages"])):
        assert p["p10"][i] <= p["p25"][i] <= p["p50"][i] <= p["p75"][i] <= p["p90"][i]


def test_more_savings_higher_median():
    baseline = run_simulation(base_inputs(), n_paths=1000, seed=99)
    extra = base_inputs(
        flows=base_inputs().flows
        + (
            FlowSpec("expense", -1_000, stops_at_retirement=True),
            FlowSpec("contrib_invested", 1_000, stops_at_retirement=True),
        )
    )
    saved = run_simulation(extra, n_paths=1000, seed=99)
    assert saved["ending_net_worth"]["p50"] > baseline["ending_net_worth"]["p50"]
    assert saved["success_probability"] >= baseline["success_probability"]


def test_earlier_retirement_lower_success():
    later = run_simulation(base_inputs(retirement_age=65), n_paths=1000, seed=99)
    earlier = run_simulation(base_inputs(retirement_age=55), n_paths=1000, seed=99)
    assert earlier["success_probability"] < later["success_probability"]


def test_higher_spending_lower_success():
    frugal = run_simulation(
        base_inputs(annual_retirement_spending=60_000), n_paths=1000, seed=5
    )
    lavish = run_simulation(
        base_inputs(annual_retirement_spending=110_000), n_paths=1000, seed=5
    )
    assert lavish["success_probability"] < frugal["success_probability"]


def test_no_ruin_paths_reports_null_ruin_age():
    cushy = base_inputs(
        invested0=6_000_000, annual_retirement_spending=40_000, debt0=0,
    )
    r = run_simulation(cushy, n_paths=500, seed=3)
    assert r["success_probability"] == 1.0
    assert r["median_ruin_age"] is None


def test_1000_paths_under_time_budget():
    inputs = base_inputs()
    start = time.perf_counter()
    run_simulation(inputs, n_paths=1000, seed=0)
    elapsed = time.perf_counter() - start
    assert elapsed < 1.5, f"simulation took {elapsed:.2f}s (budget 1.5s)"
