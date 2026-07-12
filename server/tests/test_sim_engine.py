"""Engine tests: golden pinned-seed values, determinism, v1.1 timing rules
(SS claim factors, RMD table + forced distributions, staggered retirements,
milestones), and sanity properties."""

from __future__ import annotations

import time

import pytest

from gol.sim import (
    SS_CLAIM_FACTORS,
    FlowSpec,
    MarketParams,
    MemberSpec,
    PlanInputs,
    rmd_divisor,
    rmd_start_age,
    run_simulation,
)

ZERO_GROWTH = MarketParams(
    stocks_mean_pct=0.0, stocks_vol_pct=0.0, bonds_mean_pct=0.0, bonds_vol_pct=0.0,
    cash_mean_pct=0.0, cash_vol_pct=0.0, inflation_vol_pct=0.0,
)


def base_inputs(retirement_age: int = 65, tax_deferred0: float = 360_000,
                td_routing: bool = True, roth0: float = 0.0,
                **overrides) -> PlanInputs:
    """The golden household: age 46 (born 1980 -> RMDs at 75), retires at 65,
    60% of the 600k portfolio tax-deferred, SS 2,200 claimed at FRA."""
    start_age, life_expectancy = 46, 92
    horizon = (life_expectancy - start_age + 1) * 12
    ret = max(0, min((retirement_age - start_age) * 12, horizon))
    member = MemberSpec(
        id=1, name="Alex", age0_months=start_age * 12, life_end_month=horizon,
        retirement_month=(retirement_age - start_age) * 12,
        ss_monthly=2_200, ss_start_month=(67 - start_age) * 12, ss_claim_age=67,
        tax_deferred0=tax_deferred0, roth0=roth0,
        rmd_start_month=(75 - start_age) * 12,
    )
    params = dict(
        start_age=start_age, start_year=2026, horizon_months=horizon,
        retirement_month=ret, members=(member,),
        cash0=50_000, invested0=600_000, property0=500_000, debt0=300_000,
        invested_weights=(0.7, 0.25, 0.05), retirement_share=0.6,
        property_growth_pct=3.0, debt_growth_pct=5.0,
        flows=(
            FlowSpec("income", 9_500, 3.0, end_month=ret),
            FlowSpec("expense", 5_200, 2.5, end_month=ret),
            FlowSpec("contrib_invested", 1_500, end_month=ret,
                     td_member=0 if td_routing else None),
            FlowSpec("contrib_debt", 2_200),
        ),
        annual_retirement_spending=80_000,
        inflation_mean_pct=2.5, effective_tax_rate_pct=18.0,
    )
    params.update(overrides)
    return PlanInputs(**params)


@pytest.fixture(scope="module")
def golden_result():
    return run_simulation(base_inputs(), n_paths=1000, seed=1234)


class TestGolden:
    """Pinned seed 1234, 1000 paths — values re-locked for engine v2 (T-011):
    taxable social security is capped at 85% (was 100%), so every post-claim
    number rises vs the v1.1 goldens (SS take-home is now
    ss * (1 - 0.85 * 0.18) instead of ss * (1 - 0.18)). Year-0 values are
    unchanged — SS starts at 67. v1.1 -> v2 movement: success 0.737 -> 0.742,
    ruin age 86.4 -> 86.5, final det NW 4,237,007.25 -> 4,335,800.73."""

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
        assert result["success_probability"] == pytest.approx(0.742)
        assert result["median_ruin_age"] == pytest.approx(86.5)
        assert result["deterministic"]["net_worth"][0] == pytest.approx(918_579.96)
        assert result["deterministic"]["net_worth"][-1] == pytest.approx(4_335_800.73)
        assert result["percentiles"]["p10"][0] == pytest.approx(825_671.68)
        assert result["percentiles"]["p50"][-1] == pytest.approx(2_575_871.74)
        assert result["ending_net_worth"]["p10"] == pytest.approx(-1_738_542.06)
        assert result["ending_net_worth"]["p50"] == pytest.approx(2_575_871.74)
        assert result["ending_net_worth"]["p90"] == pytest.approx(11_567_603.35)

    def test_milestones(self, result):
        assert [(m["kind"], m["age"]) for m in result["milestones"]] == [
            ("retirement", 65), ("ss_start", 67), ("rmd_start", 75),
        ]
        labels = [m["label"] for m in result["milestones"]]
        assert labels == [
            "Alex retires",
            "Alex claims Social Security (100% of FRA)",
            "RMDs begin for Alex",
        ]


def test_no_tax_deferral_golden():
    """Same household with no tax-deferred money (RMDs can never fire):
    tax-deferral accounting must not move money by itself. Through engine
    v1.1 this pinned the exact v1 numbers; the v2 SS taxable cap (T-011)
    deliberately ended v1 parity for any SS-receiving household, so these
    are the re-pinned v2 numbers (v1.1 -> v2: success 0.739 -> 0.744, ruin
    age 86.3 -> 86.5, final det NW 4,499,929.33 -> 4,603,767.29)."""
    r = run_simulation(base_inputs(tax_deferred0=0, td_routing=False),
                       n_paths=1000, seed=1234)
    assert r["success_probability"] == pytest.approx(0.744)
    assert r["median_ruin_age"] == pytest.approx(86.5)
    assert r["deterministic"]["net_worth"][0] == pytest.approx(918_579.96)
    assert r["deterministic"]["net_worth"][-1] == pytest.approx(4_603_767.29)
    assert r["percentiles"]["p10"][0] == pytest.approx(825_671.68)
    assert r["percentiles"]["p50"][-1] == pytest.approx(2_691_121.17)
    assert r["ending_net_worth"]["p10"] == pytest.approx(-1_735_489.59)
    assert r["ending_net_worth"]["p50"] == pytest.approx(2_691_121.17)
    assert r["ending_net_worth"]["p90"] == pytest.approx(13_027_976.22)


def test_roth_bucket_is_inert_and_untaxed():
    """#25: the per-member Roth sub-bucket grows/shrinks with `invested` but
    never moves money by itself, is excluded from RMDs, and its withdrawals
    never gross up. So holding the retirement balance as Roth is bit-for-bit
    identical to holding it as a plain taxable balance with no tax-deferred
    withdrawal share — the whole point is that Roth carries no tax drag."""
    roth = base_inputs(tax_deferred0=0, roth0=360_000, retirement_share=0.0,
                       td_routing=False)
    taxable = base_inputs(tax_deferred0=0, roth0=0, retirement_share=0.0,
                          td_routing=False)
    r = run_simulation(roth, n_paths=1000, seed=1234)
    t = run_simulation(taxable, n_paths=1000, seed=1234)
    assert r == t


def test_roth_only_member_has_no_rmd_and_beats_tax_deferred():
    """#25 (the bug being fixed): a member whose retirement money is entirely
    Roth takes NO RMDs and pays NO phantom withdrawal tax — so their outcome
    strictly beats the identical household holding the same balance as
    tax-deferred (which is RMD'd and taxed on withdrawal)."""
    roth = base_inputs(tax_deferred0=0, roth0=360_000, retirement_share=0.0,
                       td_routing=False)
    td = base_inputs(tax_deferred0=360_000, roth0=0, retirement_share=0.6,
                     td_routing=False)
    r = run_simulation(roth, n_paths=1000, seed=1234)
    d = run_simulation(td, n_paths=1000, seed=1234)
    # Roth-only: no forced distribution milestone.
    assert not any(m["kind"] == "rmd_start" for m in r["milestones"])
    # Tax-deferred: RMDs legitimately fire.
    assert any(m["kind"] == "rmd_start" for m in d["milestones"])
    # No RMD drag + no withdrawal tax on the retirement share -> strictly ahead.
    assert (r["deterministic"]["net_worth"][-1]
            > d["deterministic"]["net_worth"][-1])
    assert r["success_probability"] >= d["success_probability"]


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
    ret = base_inputs().retirement_month
    extra = base_inputs(
        flows=base_inputs().flows
        + (
            FlowSpec("expense", -1_000, end_month=ret),
            FlowSpec("contrib_invested", 1_000, end_month=ret),
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


# --- v1.1 timing rules -------------------------------------------------------


def test_ss_claim_factors_match_contract():
    assert SS_CLAIM_FACTORS == {
        62: 0.70, 63: 0.75, 64: 0.80, 65: 0.8667, 66: 0.9333,
        67: 1.0, 68: 1.08, 69: 1.16, 70: 1.24,
    }


def test_rmd_table_lookups():
    assert rmd_divisor(73) == 26.5
    assert rmd_divisor(75) == 24.6
    assert rmd_divisor(90) == 12.2
    assert rmd_divisor(100) == 6.4
    assert rmd_divisor(120) == 2.0
    assert rmd_divisor(131) == 2.0  # clamped to the 120+ row
    assert rmd_start_age(1959) == 73
    assert rmd_start_age(1960) == 75
    assert rmd_start_age(1980) == 75


def test_rmd_forced_distribution_math():
    """Zero-growth world: distributions follow balance / ULT divisor exactly,
    taxed at the effective rate, remainder to cash."""
    start_age, le = 74, 92
    horizon = (le - start_age + 1) * 12
    member = MemberSpec(
        id=1, name="Ruth", age0_months=start_age * 12, life_end_month=horizon,
        retirement_month=None, tax_deferred0=102_000,
        rmd_start_month=(73 - start_age) * 12,  # already past -> fires at month 0
    )
    inputs = PlanInputs(
        start_age=start_age, start_year=2026, horizon_months=horizon,
        retirement_month=horizon, members=(member,),
        invested0=102_000, invested_weights=(1.0, 0.0, 0.0), retirement_share=1.0,
        annual_retirement_spending=0.0, inflation_mean_pct=0.0,
        effective_tax_rate_pct=20.0, market=ZERO_GROWTH,
    )
    det = run_simulation(inputs, n_paths=1, seed=0)["deterministic"]
    d74 = 102_000 / rmd_divisor(74)  # 102000 / 25.5 = 4000
    assert det["invested"][0] == pytest.approx(102_000 - d74)
    assert det["cash"][0] == pytest.approx(d74 * 0.8)
    bal2 = 102_000 - d74
    d75 = bal2 / rmd_divisor(75)
    assert det["invested"][1] == pytest.approx(bal2 - d75)
    assert det["cash"][1] == pytest.approx((d74 + d75) * 0.8)


def test_rmds_stop_at_member_life_end():
    """A younger co-member extends the horizon; the RMD taker's forced
    distributions still stop at their own life end."""
    horizon = (92 - 46 + 1) * 12  # young member's horizon on self axis
    old = MemberSpec(
        id=1, name="Elder", age0_months=88 * 12 - 46 * 12 + 46 * 12,  # age 88
        life_end_month=(90 - 88 + 1) * 12,  # dies (le 90) long before horizon
        tax_deferred0=100_000, rmd_start_month=0,
    )
    young = MemberSpec(id=2, name="Kid", age0_months=46 * 12, life_end_month=horizon)
    inputs = PlanInputs(
        start_age=46, start_year=2026, horizon_months=horizon,
        retirement_month=horizon, members=(old, young),
        invested0=100_000, invested_weights=(1.0, 0.0, 0.0),
        annual_retirement_spending=0.0, inflation_mean_pct=0.0,
        effective_tax_rate_pct=0.0, market=ZERO_GROWTH,
    )
    det = run_simulation(inputs, n_paths=1, seed=0)["deterministic"]
    # distributions happen in years 0..2 (until Elder's life end), then stop:
    assert det["invested"][2] < det["invested"][1] < det["invested"][0] < 100_000
    assert det["invested"][3:] == pytest.approx([det["invested"][2]] * (len(det["invested"]) - 3))


def test_staggered_retirements_income_steps_down_twice():
    """Two earners, retirements two years apart: household income steps down
    at each retirement; spending switches at the LAST one."""
    start_age = 60
    horizon = 6 * 12
    ret_a, ret_b = 24, 48
    a = MemberSpec(id=1, name="Ann", age0_months=start_age * 12,
                   life_end_month=horizon, retirement_month=ret_a)
    b = MemberSpec(id=2, name="Ben", age0_months=58 * 12,
                   life_end_month=horizon, retirement_month=ret_b)
    inputs = PlanInputs(
        start_age=start_age, start_year=2026, horizon_months=horizon,
        retirement_month=ret_b, members=(a, b),
        flows=(
            FlowSpec("income", 1_000, end_month=ret_a),  # Ann's, stops first
            FlowSpec("income", 1_000, end_month=ret_b),  # Ben's, stops later
        ),
        annual_retirement_spending=0.0, inflation_mean_pct=0.0,
        effective_tax_rate_pct=0.0, market=ZERO_GROWTH,
    )
    r = run_simulation(inputs, n_paths=1, seed=0)
    assert r["deterministic"]["cash"] == pytest.approx(
        [24_000.0, 48_000.0, 60_000.0, 72_000.0, 72_000.0, 72_000.0]
    )
    assert [(m["kind"], m["age"], m["member_id"], m["label"]) for m in r["milestones"]] == [
        ("retirement", 62, 1, "Ann retires"),
        ("retirement", 64, 2, "Ben retires"),
    ]


def test_ss_claim_factor_affects_benefit_and_label():
    """Early claim: 70% of FRA, starting at the claim month."""
    start_age = 60
    horizon = 10 * 12
    member = MemberSpec(
        id=1, name="Eve", age0_months=start_age * 12, life_end_month=horizon,
        ss_monthly=2_000 * SS_CLAIM_FACTORS[62], ss_start_month=(62 - start_age) * 12,
        ss_claim_age=62,
    )
    inputs = PlanInputs(
        start_age=start_age, start_year=2026, horizon_months=horizon,
        retirement_month=horizon, members=(member,),
        annual_retirement_spending=0.0, inflation_mean_pct=0.0,
        effective_tax_rate_pct=0.0, market=ZERO_GROWTH,
    )
    r = run_simulation(inputs, n_paths=1, seed=0)
    det_cash = r["deterministic"]["cash"]
    assert det_cash[0] == pytest.approx(0.0)  # nothing before the claim
    assert det_cash[2] == pytest.approx(1_400 * 12)  # first full claim year
    assert r["milestones"] == [{
        "age": 62, "year": 2028, "kind": "ss_start",
        "label": "Eve claims Social Security (70% of FRA)", "member_id": 1,
    }]


def test_ss_taxed_on_85_pct_share_only():
    """Engine v2 (T-011): at most 85% of social security is taxable, while
    ordinary income stays fully taxed. Zero-growth, zero-inflation world,
    20% effective rate, $1,000/mo salary + $1,000/mo SS from month 0:
    monthly take-home = 1000 * 0.80 (income) + 1000 * (1 - 0.85 * 0.20) = 830
    (SS) -> $19,560/yr. The v1 engine taxed SS in full: $19,200/yr."""
    start_age = 70
    horizon = 3 * 12
    member = MemberSpec(
        id=1, name="Sol", age0_months=start_age * 12, life_end_month=horizon,
        ss_monthly=1_000, ss_start_month=0, ss_claim_age=67,
    )
    inputs = PlanInputs(
        start_age=start_age, start_year=2026, horizon_months=horizon,
        retirement_month=horizon, members=(member,),
        flows=(FlowSpec("income", 1_000),),
        annual_retirement_spending=0.0, inflation_mean_pct=0.0,
        effective_tax_rate_pct=20.0, market=ZERO_GROWTH,
    )
    det = run_simulation(inputs, n_paths=1, seed=0)["deterministic"]
    assert det["cash"] == pytest.approx([19_560.0, 39_120.0, 58_680.0])
    # SS-heavy household nets more than under the v1 rule (100% taxable),
    # which would have paid out 19,200.0 in year one.
    assert det["cash"][0] > 19_200.0


def test_milestones_beyond_horizon_or_in_past_are_omitted():
    horizon = 5 * 12
    member = MemberSpec(
        id=1, name="Pat", age0_months=70 * 12, life_end_month=horizon,
        retirement_month=-5 * 12,             # retired years ago
        ss_monthly=1_000, ss_start_month=-3 * 12, ss_claim_age=67,  # claiming already
        tax_deferred0=50_000, rmd_start_month=5 * 12,  # RMD age beyond horizon
    )
    inputs = PlanInputs(
        start_age=70, start_year=2026, horizon_months=horizon, retirement_month=0,
        members=(member,), invested0=50_000,
        annual_retirement_spending=0.0, inflation_mean_pct=0.0,
        effective_tax_rate_pct=0.0, market=ZERO_GROWTH,
    )
    r = run_simulation(inputs, n_paths=1, seed=0)
    assert r["milestones"] == []
    # ...but the already-claimed benefit still pays out from month 0
    assert r["deterministic"]["cash"][0] == pytest.approx(12_000.0)


def test_rmd_milestone_omitted_without_balance():
    """No tax-deferred money at the RMD month -> no rmd_start milestone."""
    r = run_simulation(base_inputs(tax_deferred0=0, td_routing=False),
                       n_paths=1, seed=0)
    assert not any(m["kind"] == "rmd_start" for m in r["milestones"])


def test_1000_paths_under_time_budget():
    inputs = base_inputs()
    start = time.perf_counter()
    run_simulation(inputs, n_paths=1000, seed=0)
    elapsed = time.perf_counter() - start
    assert elapsed < 1.5, f"simulation took {elapsed:.2f}s (budget 1.5s)"
