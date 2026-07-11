"""T-012 phase 2: bracket-aware tax mode in the engine.

Covers the coordinator's ruling 5: pinned-seed bracket-mode goldens
(documented numbers), a flat-vs-brackets comparison with hand-computed
expectations for simple single-member cases, and the 1000-path performance
budget. Flat-mode bit-for-bit identity is asserted by the UNCHANGED goldens
in test_sim_engine.py and the exact-equality golden in
test_migration_identity.py.

Hand-computed cases use a zero-growth, zero-inflation world so one plan year
maps exactly onto one `gol.tax.compute_tax_year` evaluation (price index 1,
withholding projection == actual, December settlement == 0).
"""

from __future__ import annotations

import time
from dataclasses import replace

import pytest

from gol.sim import FlowSpec, MarketParams, MemberSpec, PlanInputs, run_simulation
from test_sim_engine import base_inputs

ZERO_GROWTH = MarketParams(
    stocks_mean_pct=0.0, stocks_vol_pct=0.0, bonds_mean_pct=0.0, bonds_vol_pct=0.0,
    cash_mean_pct=0.0, cash_vol_pct=0.0, inflation_vol_pct=0.0,
)


def bracket_inputs(**overrides) -> PlanInputs:
    """The test_sim_engine golden household, switched to bracket mode."""
    return replace(
        base_inputs(**overrides), effective_tax_rate_pct=None, filing_status="single"
    )


@pytest.fixture(scope="module")
def bracket_golden_result():
    return run_simulation(bracket_inputs(), n_paths=1000, seed=1234)


class TestBracketGolden:
    """Pinned seed 1234, 1000 paths — the same golden household as
    TestGolden in test_sim_engine.py, run under tax_model=brackets
    (single filer). Documented movement vs the flat-18% goldens: this
    household's bracket-mode effective rate is well below 18% (working-years
    salary ~$114k gross taxes at ~14% effective; retirement-years SS is
    taxed on the provisional-income share instead of a flat 85%, and
    RMD/withdrawal income mostly fills the 10/12/22% brackets), so every
    post-tax number rises: success 0.742 -> 0.824, median ruin age
    86.5 -> 88.0, final det NW 4,335,800.73 -> 5,749,590.65."""

    @pytest.fixture()
    def result(self, bracket_golden_result):
        return bracket_golden_result

    def test_pinned_values(self, result):
        assert result["success_probability"] == pytest.approx(0.824)
        assert result["median_ruin_age"] == pytest.approx(88.0)
        assert result["deterministic"]["net_worth"][0] == pytest.approx(923_042.70)
        assert result["deterministic"]["net_worth"][-1] == pytest.approx(5_749_590.65)
        assert result["percentiles"]["p10"][0] == pytest.approx(829_719.55)
        assert result["percentiles"]["p50"][-1] == pytest.approx(3_764_762.52)
        assert result["ending_net_worth"]["p10"] == pytest.approx(-889_222.81)
        assert result["ending_net_worth"]["p50"] == pytest.approx(3_764_762.52)
        assert result["ending_net_worth"]["p90"] == pytest.approx(12_718_615.50)

    def test_documented_direction_vs_flat(self, result):
        """Validation plan §7.4: flat 18% overtaxes this household (it taxes
        100% of income and 85% of SS regardless of brackets), so bracket
        mode must land strictly higher on the documented aggregates."""
        flat = run_simulation(base_inputs(), n_paths=1000, seed=1234)
        assert result["success_probability"] > flat["success_probability"]
        assert (result["deterministic"]["net_worth"][-1]
                > flat["deterministic"]["net_worth"][-1])

    def test_milestones_unchanged_by_tax_mode(self, result):
        flat = run_simulation(base_inputs(), n_paths=1000, seed=1234)
        assert result["milestones"] == flat["milestones"]


# --- hand-computed single-member cases (zero growth, zero inflation) --------


def test_wage_earner_taxed_by_brackets_exactly():
    """Single filer, $5,000/mo salary, nothing else. 2026 hand-computation:
    taxable = 60,000 - 16,100 (std ded) = 43,900;
    tax = 12,400 x 10% + (43,900 - 12,400) x 12% = 1,240 + 3,780 = 5,020
    (an 8.37% effective rate). Year-end cash = 60,000 - 5,020 = 54,980,
    accruing linearly (projection == actual -> December settlement is 0).
    Flat mode at 18% would keep 60,000 x 0.82 = 49,200."""
    member = MemberSpec(id=1, name="W", age0_months=40 * 12, life_end_month=24)
    common = dict(
        start_age=40, start_year=2026, horizon_months=24, retirement_month=24,
        members=(member,), flows=(FlowSpec("income", 5_000),),
        annual_retirement_spending=0.0, inflation_mean_pct=0.0, market=ZERO_GROWTH,
    )
    brackets = run_simulation(
        PlanInputs(effective_tax_rate_pct=None, filing_status="single", **common),
        n_paths=1, seed=0,
    )["deterministic"]
    assert brackets["cash"] == pytest.approx([54_980.0, 109_960.0])
    flat = run_simulation(
        PlanInputs(effective_tax_rate_pct=18.0, **common), n_paths=1, seed=0
    )["deterministic"]
    assert flat["cash"] == pytest.approx([49_200.0, 98_400.0])


def _retiree_inputs(td0: float, **kw) -> dict:
    """Single retiree, SS $2,000/mo from month 0, RMD-forced distributions
    (already past RMD age -> annual distribution fires at month 0)."""
    start_age, le = 74, 80
    horizon = (le - start_age + 1) * 12
    member = MemberSpec(
        id=1, name="R", age0_months=start_age * 12, life_end_month=horizon,
        ss_monthly=2_000, ss_start_month=0, ss_claim_age=67,
        tax_deferred0=td0, rmd_start_month=(73 - start_age) * 12,
    )
    return dict(
        start_age=start_age, start_year=2026, horizon_months=horizon,
        retirement_month=horizon, members=(member,), invested0=td0,
        invested_weights=(1.0, 0.0, 0.0), retirement_share=1.0,
        annual_retirement_spending=0.0, inflation_mean_pct=0.0,
        market=ZERO_GROWTH, **kw,
    )


def test_modest_retiree_ss_plus_rmd_cited_example():
    """The TAX-DESIGN §7.3 cited retiree: single, SS 24,000 + tax-deferred
    distributions 30,000 -> federal tax 2,776 (cross-checked against the
    Bipartisan Policy Center 2026 calculator in phase 1). Engine setup:
    td0 = 765,000 at age 74 (ULT divisor 25.5) forces exactly a 30,000 RMD.
    Worksheet: provisional = 30,000 + 12,000 = 42,000 -> taxable SS =
    min(4,500 + 0.85 x 8,000, 20,400) = 11,300; taxable income =
    41,300 - 16,100 = 25,200; tax = 1,240 + 12,800 x 12% = 2,776.
    Year-1 cash = 24,000 + 30,000 - 2,776 = 51,224.
    Flat mode: 24,000 x (1 - 0.85 x 0.18) + 30,000 x 0.82 = 44,928 — the
    documented direction (flat overtaxes modest retirement income)."""
    common = _retiree_inputs(td0=765_000.0)
    brackets = run_simulation(
        PlanInputs(effective_tax_rate_pct=None, filing_status="single", **common),
        n_paths=1, seed=0,
    )["deterministic"]
    assert brackets["cash"][0] == pytest.approx(51_224.0)
    assert brackets["invested"][0] == pytest.approx(735_000.0)
    flat = run_simulation(
        PlanInputs(effective_tax_rate_pct=18.0, **common), n_paths=1, seed=0
    )["deterministic"]
    assert flat["cash"][0] == pytest.approx(44_928.0)
    assert brackets["cash"][0] > flat["cash"][0]


def test_large_rmd_fills_brackets_above_flat_rate():
    """The other documented direction: a forced 500,000 RMD fills brackets
    through 35%, beating a flat 18%. Hand-computation (single, SS 24,000):
    provisional = 512,000 -> taxable SS hits the 85% cap = 20,400;
    taxable income = 520,400 - 16,100 = 504,300;
    tax = 1,240 + 4,560 + 12,166 + 23,058 + 17,424
        + (504,300 - 256,225) x 35% = 145,274.25 (27.7% effective).
    Year-1 cash = 524,000 - 145,274.25 = 378,725.75.
    Flat mode nets 24,000 x 0.847 + 500,000 x 0.82 = 430,328 — MORE than
    bracket mode: RMDs filling brackets is now visible."""
    common = _retiree_inputs(td0=12_750_000.0)  # 12.75M / 25.5 = 500,000 RMD
    brackets = run_simulation(
        PlanInputs(effective_tax_rate_pct=None, filing_status="single", **common),
        n_paths=1, seed=0,
    )["deterministic"]
    assert brackets["cash"][0] == pytest.approx(378_725.75)
    flat = run_simulation(
        PlanInputs(effective_tax_rate_pct=18.0, **common), n_paths=1, seed=0
    )["deterministic"]
    assert flat["cash"][0] == pytest.approx(430_328.0)
    assert brackets["cash"][0] < flat["cash"][0]


def test_mfj_thresholds_apply():
    """Same 60k wage in MFJ: taxable = 60,000 - 32,200 = 27,800;
    tax = 2,480 + 3,000 x 12% = 2,840; year-end cash = 57,160."""
    member = MemberSpec(id=1, name="W", age0_months=40 * 12, life_end_month=12)
    r = run_simulation(
        PlanInputs(
            start_age=40, start_year=2026, horizon_months=12, retirement_month=12,
            members=(member,), flows=(FlowSpec("income", 5_000),),
            annual_retirement_spending=0.0, inflation_mean_pct=0.0,
            market=ZERO_GROWTH, effective_tax_rate_pct=None, filing_status="mfj",
        ),
        n_paths=1, seed=0,
    )
    assert r["deterministic"]["cash"][0] == pytest.approx(57_160.0)


def test_withdrawal_grossup_settles_exactly_over_year():
    """Shortfall withdrawals in bracket mode: spending 4,000/mo with no
    income forces monthly withdrawals (retirement_share=1 -> all ordinary
    income), grossed up at the running marginal-rate estimate m̂:
    g_m = 4,000 / (1 - m̂). Taxable-so-far crosses the 10%->12% edge
    (12,400 + 16,100 deduction = 28,500) before month 7's withdrawal
    (7 x 4,444.44 = 31,111.11), so the year draws 7 months at m̂=10% and 5
    at m̂=12%. The December settle-up then makes the ANNUAL tax exact —
    m̂ >= the year's average rate, so the excess withholding comes back as a
    year-end refund in cash. Zero-growth invariants:
      gross     = 7 x 4,000/0.90 + 5 x 4,000/0.88   (= 53,838.38)
      tax       = 1,240 + (gross - 28,500) x 12%     (= 4,280.61, exact)
      net_worth = 500,000 - 48,000 - tax
      cash      = withheld - tax = (gross - 48,000) - tax (the refund)"""
    start_age = 60
    horizon = 2 * 12
    member = MemberSpec(
        id=1, name="S", age0_months=start_age * 12, life_end_month=horizon,
    )
    inputs = PlanInputs(
        start_age=start_age, start_year=2026, horizon_months=horizon,
        retirement_month=horizon, members=(member,), invested0=500_000,
        invested_weights=(1.0, 0.0, 0.0), retirement_share=1.0,
        flows=(FlowSpec("expense", 4_000),),
        annual_retirement_spending=0.0, inflation_mean_pct=0.0,
        market=ZERO_GROWTH, effective_tax_rate_pct=None, filing_status="single",
    )
    det = run_simulation(inputs, n_paths=1, seed=0)["deterministic"]
    gross = 7 * 4_000 / 0.90 + 5 * 4_000 / 0.88
    tax = 1_240 + (gross - 28_500) * 0.12
    assert det["invested"][0] == pytest.approx(500_000 - gross, abs=0.01)
    assert det["cash"][0] == pytest.approx((gross - 48_000) - tax, abs=0.01)
    assert det["net_worth"][0] == pytest.approx(500_000 - 48_000 - tax, abs=0.01)


def test_ss_only_modest_household_owes_nothing_in_bracket_mode():
    """The headline honesty win over the flat model: an SS-only household
    (2,000/mo, single) has provisional income 12,000 < 25,000, so NONE of
    the benefit is taxable — bracket-mode year-1 cash is the full 24,000.
    Flat mode at 18% would tax 85% of it: 24,000 x (1 - 0.85 x 0.18) =
    20,328."""
    start_age, le = 70, 75
    horizon = (le - start_age + 1) * 12
    member = MemberSpec(
        id=1, name="N", age0_months=start_age * 12, life_end_month=horizon,
        ss_monthly=2_000, ss_start_month=0, ss_claim_age=67,
    )
    common = dict(
        start_age=start_age, start_year=2026, horizon_months=horizon,
        retirement_month=horizon, members=(member,),
        annual_retirement_spending=0.0, inflation_mean_pct=0.0,
        market=ZERO_GROWTH,
    )
    brackets = run_simulation(
        PlanInputs(effective_tax_rate_pct=None, filing_status="single", **common),
        n_paths=1, seed=0,
    )["deterministic"]
    assert brackets["cash"][0] == pytest.approx(24_000.0)
    flat = run_simulation(
        PlanInputs(effective_tax_rate_pct=18.0, **common), n_paths=1, seed=0
    )["deterministic"]
    assert flat["cash"][0] == pytest.approx(20_328.0)


def test_annual_settlement_matches_tax_module_and_ss_creep():
    """Engine/module agreement on the plan-year grid, plus the §86(c) creep:
    a CPI-linked pension (18,000/yr real) + SS (12,000/yr real) under
    deterministic 2.5% inflation. Every year's net cash receipts (annual
    cash diffs; nothing else moves cash in this world) must equal
    gross - compute_tax_year(...).tax with the year's ACTUAL nominal gross
    amounts and the December price index — proving the engine accumulates
    nominal income, indexes brackets/deduction by its price index, and
    keeps the SS thresholds nominal. Creep: year-1 provisional income
    (18,000 + 6,000 ~= 24,300 nominal) sits below the frozen 25,000 base
    threshold (taxable SS = 0), but the same REAL income drifts across it
    as the price level rises — by the final year a chunk of SS is taxable.
    A zero-inflation twin would stay untaxable forever (phase-1 module
    tests pin the unindexed thresholds)."""
    import numpy as np

    from gol.tax import TaxYearInput, compute_tax_year

    start_age, le = 70, 92
    n_years = le - start_age + 1
    horizon = n_years * 12
    member = MemberSpec(
        id=1, name="C", age0_months=start_age * 12, life_end_month=horizon,
        ss_monthly=1_000, ss_start_month=0, ss_claim_age=67,
    )
    inputs = PlanInputs(
        start_age=start_age, start_year=2026, horizon_months=horizon,
        retirement_month=horizon, members=(member,),
        flows=(FlowSpec("income", 1_500, annual_growth_pct=2.5),),
        annual_retirement_spending=0.0, inflation_mean_pct=2.5,
        market=ZERO_GROWTH, effective_tax_rate_pct=None, filing_status="single",
    )
    det = run_simulation(inputs, n_paths=1, seed=0)["deterministic"]
    net_by_year = np.diff(np.concatenate([[0.0], det["cash"]]))

    # Reconstruct the engine's nominal amounts on its own grid.
    t = np.arange(horizon)
    mean_m = 1.025 ** (1.0 / 12.0) - 1.0
    price = (1.0 + mean_m) ** (t + 1)  # deterministic cumulative index
    pension = 1_500 * 1.025 ** (t / 12.0)
    ss = 1_000 * price
    taxable_ss_by_year = []
    for y in range(n_years):
        months = slice(12 * y, 12 * y + 12)
        year = compute_tax_year(TaxYearInput(
            filing_status="single",
            ordinary_income=float(pension[months].sum()),
            ss_benefits=float(ss[months].sum()),
            price_index=float(price[12 * y + 11]),
        ))
        gross = pension[months].sum() + ss[months].sum()
        assert net_by_year[y] == pytest.approx(gross - year.tax, abs=0.01), (
            f"year {y}: engine settlement disagrees with gol.tax"
        )
        taxable_ss_by_year.append(year.taxable_ss)
    assert taxable_ss_by_year[0] == 0.0  # provisional < 25,000 base threshold
    assert taxable_ss_by_year[-1] > 0.0  # nominal creep crossed the threshold


def test_bracket_mode_1000_paths_under_time_budget():
    """Ruling 5: bracket mode must hold the 1.5s / 1000-path budget with
    margin (measured ~0.31s on the dev box; flat mode ~0.18s)."""
    inputs = bracket_inputs()
    run_simulation(inputs, n_paths=100, seed=0)  # warm-up (imports, caches)
    start = time.perf_counter()
    run_simulation(inputs, n_paths=1000, seed=0)
    elapsed = time.perf_counter() - start
    assert elapsed < 1.5, f"bracket simulation took {elapsed:.2f}s (budget 1.5s)"
