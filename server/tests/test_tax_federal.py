"""gol.tax.federal — bracket math, 2026 data tables, scalar/array parity.

All hand-worked expectations derive from the 2026 tables (IRS Rev. Proc.
2025-32; cross-checked against Tax Foundation "2026 Tax Brackets",
https://taxfoundation.org/data/all/federal/2026-tax-brackets/).
"""

import numpy as np
import pytest

from gol.tax.federal import (
    FILING_STATUSES,
    LTCG_BRACKETS,
    ORDINARY_BRACKETS,
    STANDARD_DEDUCTION,
    TAX_YEAR,
    TaxBrackets,
    bracket_tax,
    marginal_rate,
    ordinary_marginal_rate,
    ordinary_tax,
    standard_deduction,
)

# ---------------------------------------------------------------- data tables


def test_tax_year_is_2026():
    assert TAX_YEAR == 2026


@pytest.mark.parametrize("table", [ORDINARY_BRACKETS, LTCG_BRACKETS])
def test_tables_cover_both_statuses(table):
    assert set(table) == set(FILING_STATUSES) == {"single", "mfj"}


@pytest.mark.parametrize("status", FILING_STATUSES)
def test_ordinary_brackets_shape(status):
    b = ORDINARY_BRACKETS[status]
    assert b.rates == (0.10, 0.12, 0.22, 0.24, 0.32, 0.35, 0.37)
    assert b.thresholds[0] == 0.0
    assert all(x < y for x, y in zip(b.thresholds, b.thresholds[1:], strict=False))


def test_mfj_ordinary_thresholds_double_single_through_32pct():
    # 2026 law: MFJ bracket edges are exactly 2x single up to the 32% bracket;
    # the 35%->37% edge is compressed ("marriage penalty" at the top).
    s = ORDINARY_BRACKETS["single"].thresholds
    m = ORDINARY_BRACKETS["mfj"].thresholds
    assert m[1:5] == tuple(2 * x for x in s[1:5])
    assert m[6] < 2 * s[6]


def test_standard_deduction_2026_values():
    # Rev. Proc. 2025-32 §2.15.
    assert STANDARD_DEDUCTION == {"single": 16_100.0, "mfj": 32_200.0}


@pytest.mark.parametrize("status", FILING_STATUSES)
def test_ltcg_brackets_are_0_15_20(status):
    assert LTCG_BRACKETS[status].rates == (0.00, 0.15, 0.20)


def test_brackets_validation():
    with pytest.raises(ValueError):
        TaxBrackets(thresholds=(0.0, 10.0), rates=(0.1,))  # length mismatch
    with pytest.raises(ValueError):
        TaxBrackets(thresholds=(1.0, 10.0), rates=(0.1, 0.2))  # not 0-based
    with pytest.raises(ValueError):
        TaxBrackets(thresholds=(0.0, 10.0, 10.0), rates=(0.1, 0.2, 0.3))  # not increasing


@pytest.mark.parametrize(
    "fn", [ordinary_tax, ordinary_marginal_rate, standard_deduction]
)
def test_unknown_status_raises(fn):
    with pytest.raises(ValueError, match="filing_status"):
        fn(1000.0, "hoh") if fn is not standard_deduction else fn("hoh")


# ------------------------------------------------------------- bracket math


def test_zero_and_negative_taxable_income():
    assert ordinary_tax(0.0, "single") == 0.0
    assert ordinary_tax(-5_000.0, "mfj") == 0.0


def test_first_bracket_boundary_single():
    # Whole 10% bracket: 10% x 12,400 = 1,240; the next dollar is taxed at 12%.
    assert ordinary_tax(12_400.0, "single") == pytest.approx(1_240.0)
    assert ordinary_tax(12_500.0, "single") == pytest.approx(1_240.0 + 0.12 * 100.0)


def test_every_threshold_is_continuous():
    # Tax function must be continuous at each bracket edge: the last cent
    # below edge thresholds[i+1] is taxed at rates[i], with no jump.
    for status in FILING_STATUSES:
        b = ORDINARY_BRACKETS[status]
        for edge, rate_below in zip(b.thresholds[1:], b.rates[:-1], strict=True):
            below = ordinary_tax(edge - 0.01, status)
            at = ordinary_tax(edge, status)
            assert at - below == pytest.approx(rate_below * 0.01, abs=1e-9)


def test_hand_worked_single_83900():
    # Single, taxable 83,900 (2026):
    #   10% x 12,400                 = 1,240.00
    #   12% x (50,400 - 12,400)      = 4,560.00
    #   22% x (83,900 - 50,400)      = 7,370.00
    #   total                        = 13,170.00
    assert ordinary_tax(83_900.0, "single") == pytest.approx(13_170.0)


def test_hand_worked_mfj_61800():
    # MFJ, taxable 61,800 (2026):
    #   10% x 24,800                 = 2,480.00
    #   12% x (61,800 - 24,800)      = 4,440.00
    #   total                        = 6,920.00
    assert ordinary_tax(61_800.0, "mfj") == pytest.approx(6_920.0)


def test_hand_worked_single_top_bracket():
    # Single, taxable 1,000,000 (2026):
    #   10% x 12,400                     =   1,240.00
    #   12% x (50,400-12,400)            =   4,560.00
    #   22% x (105,700-50,400)           =  12,166.00
    #   24% x (201,775-105,700)          =  23,058.00
    #   32% x (256,225-201,775)          =  17,424.00
    #   35% x (640,600-256,225)          = 134,531.25
    #   37% x (1,000,000-640,600)        = 132,978.00
    #   total                            = 325,957.25
    assert ordinary_tax(1_000_000.0, "single") == pytest.approx(325_957.25)


def test_marginal_rate_boundaries():
    assert ordinary_marginal_rate(0.0, "single") == 0.10
    assert ordinary_marginal_rate(-100.0, "single") == 0.10
    assert ordinary_marginal_rate(12_399.99, "single") == 0.10
    # Exactly at a threshold: the next dollar's rate.
    assert ordinary_marginal_rate(12_400.0, "single") == 0.12
    assert ordinary_marginal_rate(640_600.0, "single") == 0.37
    assert ordinary_marginal_rate(100_800.0, "mfj") == 0.22


# ------------------------------------------------------ inflation indexation


def test_index_scales_thresholds_homogeneously():
    # bracket_tax is positively homogeneous: tax(f*x, index=f) = f*tax(x).
    for x in (10_000.0, 83_900.0, 300_000.0):
        for f in (1.25, 2.0):
            assert ordinary_tax(f * x, "single", index=f) == pytest.approx(
                f * ordinary_tax(x, "single")
            )


def test_index_scales_standard_deduction():
    assert standard_deduction("single", index=1.5) == pytest.approx(24_150.0)
    assert standard_deduction("mfj") == 32_200.0


def test_index_array_broadcasts_against_scalar_amount():
    idx = np.array([1.0, 2.0])
    out = ordinary_tax(83_900.0, "single", index=idx)
    assert out.shape == (2,)
    assert out[0] == pytest.approx(13_170.0)
    # Doubled thresholds: 83,900 sits lower in the schedule.
    #   10% x 24,800 + 12% x (83,900 - 24,800) = 2,480 + 7,092 = 9,572
    assert out[1] == pytest.approx(9_572.0)


def test_marginal_rate_respects_index():
    assert ordinary_marginal_rate(60_000.0, "single") == 0.22
    assert ordinary_marginal_rate(60_000.0, "single", index=2.0) == 0.12


# ------------------------------------------------------- scalar/array parity


def test_scalar_inputs_return_python_floats():
    out = ordinary_tax(83_900.0, "single")
    assert isinstance(out, float)
    assert isinstance(ordinary_marginal_rate(83_900.0, "single"), float)
    assert isinstance(standard_deduction("single"), float)


def test_array_scalar_parity_ordinary_tax():
    amounts = np.array([-1_000.0, 0.0, 12_400.0, 83_900.0, 1_000_000.0])
    vec = ordinary_tax(amounts, "single")
    assert isinstance(vec, np.ndarray) and vec.shape == amounts.shape
    for i, a in enumerate(amounts):
        assert vec[i] == ordinary_tax(float(a), "single")


def test_array_scalar_parity_marginal_rate():
    amounts = np.array([0.0, 12_400.0, 50_400.0, 999_999.0])
    vec = ordinary_marginal_rate(amounts, "single")
    for i, a in enumerate(amounts):
        assert vec[i] == ordinary_marginal_rate(float(a), "single")


def test_2d_paths_by_years_shape_preserved():
    amounts = np.full((4, 3), 83_900.0)
    idx = np.ones((4, 3))
    out = bracket_tax(amounts, ORDINARY_BRACKETS["single"], idx)
    assert out.shape == (4, 3)
    assert np.allclose(out, 13_170.0)


def test_generic_bracket_tax_matches_manual_ltcg():
    # LTCG data-only sanity: 15% of the slice above the 0% breakpoint.
    # Single, 100,000 of gains with no ordinary stacking (phase-1 naive use):
    #   0% x 49,450 + 15% x (100,000 - 49,450) = 7,582.50
    assert bracket_tax(100_000.0, LTCG_BRACKETS["single"]) == pytest.approx(7_582.50)
    assert marginal_rate(40_000.0, LTCG_BRACKETS["mfj"]) == 0.00
