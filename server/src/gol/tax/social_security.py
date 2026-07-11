"""Taxable share of Social Security benefits (provisional-income method).

Implements the IRC §86 / IRS Publication 915 worksheet: provisional income
(= non-SS ordinary income + tax-exempt interest + half of benefits) is
compared against two statutory thresholds; up to 50% of benefits become
taxable in the middle tier and up to 85% above the upper threshold.

The thresholds are **deliberately unindexed**: IRC §86(c) fixes them in
nominal dollars — $25,000/$34,000 (single) and $32,000/$44,000 (MFJ) — with
no inflation adjustment. They have not moved since they were set (base tier
1984, 85% tier 1994), which is why an ever-growing share of benefits becomes
taxable over time. The sim must NOT scale these by its price index; that
nominal fixity is the realistic behaviour. Sources: IRC §86(c); IRS Pub 915
(https://www.irs.gov/publications/p915); SSA, "Income Taxes and Your Social
Security Benefit" (https://www.ssa.gov/benefits/retirement/planner/taxes.html).

Same vectorization contract as gol.tax.federal: amounts are floats or numpy
arrays (broadcast together); status is a scalar string.
"""

from __future__ import annotations

import numpy as np

from gol.tax.federal import _check_status, _maybe_scalar

# filing_status -> (base threshold [50% tier], upper threshold [85% tier]),
# nominal dollars, unindexed by law (IRC §86(c)).
SS_TAXABILITY_THRESHOLDS: dict[str, tuple[float, float]] = {
    "single": (25_000.0, 34_000.0),
    "mfj": (32_000.0, 44_000.0),
}


def provisional_income(
    other_income: float | np.ndarray, ss_benefits: float | np.ndarray
) -> float | np.ndarray:
    """Provisional (combined) income: non-SS ordinary income (AGI excluding
    SS, plus tax-exempt interest — the sim has none) + 50% of benefits."""
    out = np.asarray(other_income, dtype=float) + 0.5 * np.asarray(ss_benefits, dtype=float)
    return _maybe_scalar(out, other_income, ss_benefits)


def taxable_social_security(
    ss_benefits: float | np.ndarray,
    other_income: float | np.ndarray,
    filing_status: str,
) -> float | np.ndarray:
    """Taxable portion of annual SS benefits (Pub 915 worksheet, simplified
    to the no-exclusions case).

    - provisional <= base: 0 taxable.
    - base < provisional <= upper: min(50% of the excess over base, 50% of
      benefits).
    - provisional > upper: 85% of the excess over upper, plus the smaller of
      the frozen 50%-tier amount (min(50% of benefits, 50% of (upper-base)))
      — all capped at 85% of benefits.
    """
    base, upper = SS_TAXABILITY_THRESHOLDS[_check_status(filing_status)]
    ss = np.asarray(ss_benefits, dtype=float)
    p = provisional_income(np.asarray(other_income, dtype=float), ss)

    excess_base = np.maximum(p - base, 0.0)
    excess_upper = np.maximum(p - upper, 0.0)
    # 50% tier: half the excess over base, capped at half the tier width once
    # provisional passes the upper threshold, never more than half of SS.
    tier_50 = np.minimum(0.5 * np.minimum(excess_base, upper - base), 0.5 * ss)
    out = np.minimum(tier_50 + 0.85 * excess_upper, 0.85 * ss)
    return _maybe_scalar(out, ss_benefits, other_income)
