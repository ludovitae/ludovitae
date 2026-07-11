"""Federal income tax brackets and bracket math (tax year 2026).

Rates and thresholds ship as data; the math is generic over any
``TaxBrackets`` table, so updating to a new tax year is a data edit.

Sources (2026, post-OBBBA/TCJA-extension law, IRS Rev. Proc. 2025-32):
- IRS newsroom, "IRS releases tax inflation adjustments for tax year 2026":
  https://www.irs.gov/newsroom/irs-releases-tax-inflation-adjustments-for-tax-year-2026-including-amendments-from-the-one-big-beautiful-bill
- Rev. Proc. 2025-32: https://www.irs.gov/pub/irs-drop/rp-25-32.pdf
- Cross-checked against Tax Foundation, "2026 Tax Brackets":
  https://taxfoundation.org/data/all/federal/2026-tax-brackets/

Vectorization contract: every function taking amounts accepts a scalar
``float`` or an ``np.ndarray`` (any shape) for the amount and for the
``index`` factor, broadcasts them, and returns a matching-shape array — or a
plain ``float`` when every input was scalar. Filing status is always a
scalar string.

``index`` inflation-indexes the bracket thresholds / deduction by a supplied
cumulative price factor (the sim engine will pass its per-path price index).
Real law indexes annually by chained CPI with rounding rules; a continuous
factor is a deliberate, documented approximation (docs/TAX-DESIGN.md).
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

TAX_YEAR = 2026

# Supported filing statuses (phase 1). The household has one filer; see
# docs/TAX-DESIGN.md for the proposed derivation (mfj if >= 2 adults).
FILING_STATUSES = ("single", "mfj")


@dataclass(frozen=True)
class TaxBrackets:
    """Progressive brackets: ``thresholds[i]`` is the (inclusive) lower bound
    of the slice taxed at ``rates[i]``; ``thresholds[0]`` must be 0 and
    thresholds must be strictly increasing. The top bracket is unbounded."""

    thresholds: tuple[float, ...]
    rates: tuple[float, ...]

    def __post_init__(self) -> None:
        if len(self.thresholds) != len(self.rates):
            raise ValueError("thresholds and rates must have equal length")
        if self.thresholds[0] != 0.0:
            raise ValueError("first threshold must be 0")
        if any(b <= a for a, b in zip(self.thresholds, self.thresholds[1:], strict=False)):
            raise ValueError("thresholds must be strictly increasing")


# --- 2026 ordinary income (Rev. Proc. 2025-32 §2.01, taxable income) --------
ORDINARY_BRACKETS: dict[str, TaxBrackets] = {
    "single": TaxBrackets(
        thresholds=(0.0, 12_400.0, 50_400.0, 105_700.0, 201_775.0, 256_225.0, 640_600.0),
        rates=(0.10, 0.12, 0.22, 0.24, 0.32, 0.35, 0.37),
    ),
    "mfj": TaxBrackets(
        thresholds=(0.0, 24_800.0, 100_800.0, 211_400.0, 403_550.0, 512_450.0, 768_700.0),
        rates=(0.10, 0.12, 0.22, 0.24, 0.32, 0.35, 0.37),
    ),
}

# --- 2026 long-term capital gains (Rev. Proc. 2025-32 §2.03) ----------------
# Data only in phase 1: the engine's coarse buckets can't yet separate basis
# from gain, so nothing computes LTCG tax. Shipped now so phase 2 is a code
# change, not a research task. NB: real LTCG brackets stack on top of
# ordinary taxable income; that composition is phase 2 (docs/TAX-DESIGN.md).
LTCG_BRACKETS: dict[str, TaxBrackets] = {
    "single": TaxBrackets(
        thresholds=(0.0, 49_450.0, 545_500.0),
        rates=(0.00, 0.15, 0.20),
    ),
    "mfj": TaxBrackets(
        thresholds=(0.0, 98_900.0, 613_700.0),
        rates=(0.00, 0.15, 0.20),
    ),
}

# --- 2026 standard deduction (Rev. Proc. 2025-32 §2.15) ---------------------
STANDARD_DEDUCTION: dict[str, float] = {
    "single": 16_100.0,
    "mfj": 32_200.0,
}


def _check_status(filing_status: str) -> str:
    if filing_status not in FILING_STATUSES:
        raise ValueError(f"unknown filing_status {filing_status!r}; expected {FILING_STATUSES}")
    return filing_status


def _maybe_scalar(out: np.ndarray, *inputs: object) -> np.ndarray | float:
    """Return a plain float when every amount input was scalar."""
    if all(np.ndim(x) == 0 for x in inputs):
        return float(out)
    return out


def bracket_tax(
    amount: float | np.ndarray,
    brackets: TaxBrackets,
    index: float | np.ndarray = 1.0,
) -> float | np.ndarray:
    """Progressive tax on ``amount`` under ``brackets`` with thresholds scaled
    by ``index``. Negative amounts tax to 0. ``amount`` and ``index``
    broadcast together (e.g. per-path arrays)."""
    amt = np.asarray(amount, dtype=float)
    idx = np.asarray(index, dtype=float)
    lo = np.asarray(brackets.thresholds)
    hi = np.append(lo[1:], np.inf)
    rates = np.asarray(brackets.rates)
    lo_s = lo * idx[..., None]
    width = (hi - lo) * idx[..., None]  # inf stays inf for the top bracket
    taxed = np.clip(amt[..., None] - lo_s, 0.0, width)
    out = np.sum(taxed * rates, axis=-1)
    return _maybe_scalar(out, amount, index)


def marginal_rate(
    amount: float | np.ndarray,
    brackets: TaxBrackets,
    index: float | np.ndarray = 1.0,
) -> float | np.ndarray:
    """Rate of the bracket containing ``max(amount, 0)``. Exactly at a
    threshold, the next dollar's rate (the upper bracket) is returned."""
    amt = np.asarray(amount, dtype=float)
    idx = np.asarray(index, dtype=float)
    lo = np.asarray(brackets.thresholds)
    rates = np.asarray(brackets.rates)
    k = np.sum(amt[..., None] >= lo * idx[..., None], axis=-1) - 1
    out = rates[np.maximum(k, 0)]
    return _maybe_scalar(out, amount, index)


def standard_deduction(
    filing_status: str, index: float | np.ndarray = 1.0
) -> float | np.ndarray:
    """Standard deduction for the status, inflation-scaled by ``index``."""
    base = STANDARD_DEDUCTION[_check_status(filing_status)]
    out = base * np.asarray(index, dtype=float)
    return _maybe_scalar(out, index)


def ordinary_tax(
    taxable_income: float | np.ndarray,
    filing_status: str,
    index: float | np.ndarray = 1.0,
) -> float | np.ndarray:
    """Federal ordinary-income tax on *taxable* income (post-deduction)."""
    return bracket_tax(taxable_income, ORDINARY_BRACKETS[_check_status(filing_status)], index)


def ordinary_marginal_rate(
    taxable_income: float | np.ndarray,
    filing_status: str,
    index: float | np.ndarray = 1.0,
) -> float | np.ndarray:
    """Marginal ordinary rate at the given *taxable* income."""
    return marginal_rate(taxable_income, ORDINARY_BRACKETS[_check_status(filing_status)], index)
