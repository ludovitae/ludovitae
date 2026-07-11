"""gol.tax.social_security — provisional-income tiers (IRS Pub 915 worksheet).

Thresholds are statutory and unindexed (IRC §86(c)): 25,000/34,000 single,
32,000/44,000 MFJ. Hand-worked expectations follow the Pub 915 worksheet:
https://www.irs.gov/publications/p915
"""

import numpy as np
import pytest

from gol.tax.social_security import (
    SS_TAXABILITY_THRESHOLDS,
    provisional_income,
    taxable_social_security,
)


def test_statutory_thresholds_pinned_unindexed():
    # These are fixed in nominal dollars by IRC §86(c) — set 1983 (50% tier)
    # and 1993 (85% tier), never inflation-adjusted. Pin them so nobody
    # "helpfully" indexes them later.
    assert SS_TAXABILITY_THRESHOLDS == {
        "single": (25_000.0, 34_000.0),
        "mfj": (32_000.0, 44_000.0),
    }


def test_provisional_income_is_other_plus_half_ss():
    assert provisional_income(30_000.0, 24_000.0) == pytest.approx(42_000.0)
    assert provisional_income(0.0, 0.0) == 0.0


def test_zero_benefits_taxable_is_zero():
    assert taxable_social_security(0.0, 1_000_000.0, "single") == 0.0


@pytest.mark.parametrize(
    ("status", "other"), [("single", 10_000.0), ("mfj", 15_000.0)]
)
def test_below_base_threshold_nothing_taxable(status, other):
    # single: provisional = 10,000 + 10,000 = 20,000 <= 25,000
    # mfj:    provisional = 15,000 + 10,000 = 25,000 <= 32,000
    assert taxable_social_security(20_000.0, other, status) == 0.0


def test_exactly_at_base_threshold_nothing_taxable():
    # provisional = 15,000 + 10,000 = 25,000, not > 25,000 (single base).
    assert taxable_social_security(20_000.0, 15_000.0, "single") == 0.0


def test_middle_tier_half_of_excess_single():
    # ss=20,000, other=20,000: provisional = 30,000; excess over 25,000 base
    # = 5,000 -> taxable = min(2,500, 10,000) = 2,500.
    assert taxable_social_security(20_000.0, 20_000.0, "single") == pytest.approx(2_500.0)


def test_middle_tier_capped_at_half_of_benefits():
    # ss=4,000, other=30,000: provisional = 32,000; half the 7,000 excess is
    # 3,500 but the 50%-of-benefits cap binds -> 2,000.
    assert taxable_social_security(4_000.0, 30_000.0, "single") == pytest.approx(2_000.0)


def test_upper_tier_mfj_not_capped():
    # MFJ ss=20,000, other=40,000: provisional = 50,000 > 44,000.
    #   50% tier: min(0.5 x min(50,000-32,000, 44,000-32,000), 0.5 x 20,000)
    #           = min(0.5 x 12,000, 10,000) = 6,000
    #   85% tier: 0.85 x (50,000 - 44,000) = 5,100
    #   total 11,100 < 85% cap (17,000) -> 11,100.
    assert taxable_social_security(20_000.0, 40_000.0, "mfj") == pytest.approx(11_100.0)


def test_upper_tier_single_hand_worked():
    # single ss=24,000, other=30,000: provisional = 42,000 > 34,000.
    #   50% tier: min(0.5 x min(17,000, 9,000), 12,000) = 4,500
    #   85% tier: 0.85 x (42,000 - 34,000) = 6,800
    #   total 11,300 < cap (20,400) -> 11,300.
    assert taxable_social_security(24_000.0, 30_000.0, "single") == pytest.approx(11_300.0)


def test_85_percent_cap_binds_mfj():
    # MFJ ss=40,000, other=60,000: provisional = 80,000.
    #   50% tier: min(0.5 x min(48,000, 12,000), 20,000) = 6,000
    #   85% tier: 0.85 x 36,000 = 30,600; 6,000 + 30,600 = 36,600
    #   cap: 0.85 x 40,000 = 34,000 -> exactly 34,000 taxable.
    assert taxable_social_security(40_000.0, 60_000.0, "mfj") == pytest.approx(34_000.0)


def test_high_income_taxes_exactly_85_percent():
    for status in ("single", "mfj"):
        assert taxable_social_security(30_000.0, 500_000.0, status) == pytest.approx(
            0.85 * 30_000.0
        )


def test_mfj_thresholds_shelter_more_than_single():
    # Same income, MFJ taxes less of the benefit than single.
    single = taxable_social_security(24_000.0, 30_000.0, "single")
    mfj = taxable_social_security(24_000.0, 30_000.0, "mfj")
    assert mfj < single


def test_taxable_share_is_monotonic_in_other_income():
    other = np.linspace(0.0, 200_000.0, 401)
    out = taxable_social_security(30_000.0, other, "single")
    assert np.all(np.diff(out) >= -1e-9)
    assert out[0] == 0.0
    assert out[-1] == pytest.approx(25_500.0)  # 85% of 30,000


def test_array_scalar_parity():
    ss = np.array([0.0, 4_000.0, 20_000.0, 24_000.0, 40_000.0])
    other = np.array([10_000.0, 30_000.0, 20_000.0, 30_000.0, 200_000.0])
    vec = taxable_social_security(ss, other, "single")
    assert isinstance(vec, np.ndarray) and vec.shape == ss.shape
    for i in range(len(ss)):
        scalar = taxable_social_security(float(ss[i]), float(other[i]), "single")
        assert isinstance(scalar, float)
        assert vec[i] == scalar


def test_scalar_ss_broadcasts_against_array_income():
    other = np.array([0.0, 30_000.0, 500_000.0])
    out = taxable_social_security(24_000.0, other, "single")
    assert out.shape == (3,)
    assert out[0] == 0.0 and out[2] == pytest.approx(20_400.0)


def test_unknown_status_raises():
    with pytest.raises(ValueError, match="filing_status"):
        taxable_social_security(10_000.0, 10_000.0, "married")
