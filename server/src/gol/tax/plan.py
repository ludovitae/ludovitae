"""One household tax year: compose brackets + SS taxability into a result.

``compute_tax_year`` is the surface the engine integration (phase 2) will
call once per plan year, vectorized over Monte Carlo paths: every amount
field accepts a scalar or an ``np.ndarray`` (e.g. shape ``(n_paths,)``) and
the result fields match the broadcast shape — plain floats when all inputs
were scalar. Filing status is a scalar string.

Model (phase 1, federal ordinary income only — see docs/TAX-DESIGN.md):
- Tax-deferred withdrawals (including RMDs) are ordinary income.
- The taxable share of SS comes from the provisional-income tiers; the SS
  taxability thresholds are nominal/unindexed while the brackets and standard
  deduction scale with ``price_index``.
- Deduction defaults to the standard deduction for the status (x index).
- No LTCG composition, no state tax, no AMT/NIIT, no credits, no senior
  bonus deduction (phase-1 non-goals).
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from gol.tax.federal import (
    _maybe_scalar,
    ordinary_marginal_rate,
    ordinary_tax,
    standard_deduction,
)
from gol.tax.social_security import taxable_social_security

Amount = float | np.ndarray


@dataclass(frozen=True)
class TaxYearInput:
    """One plan year of household income, in that year's nominal dollars."""

    filing_status: str  # "single" | "mfj"
    ordinary_income: Amount = 0.0  # wages/interest/etc., excl. SS + withdrawals
    ss_benefits: Amount = 0.0  # gross Social Security received
    tax_deferred_withdrawals: Amount = 0.0  # incl. RMDs; taxed as ordinary
    price_index: Amount = 1.0  # cumulative inflation factor for brackets/deduction
    deduction: Amount | None = None  # None -> standard deduction x price_index


@dataclass(frozen=True)
class TaxYearResult:
    """Shapes mirror the broadcast inputs (floats for all-scalar inputs)."""

    taxable_ss: Amount  # taxable share of SS benefits
    agi: Amount  # ordinary + withdrawals + taxable SS
    taxable_income: Amount  # max(0, agi - deduction)
    tax: Amount  # federal ordinary-income tax
    effective_rate: Amount  # tax / gross cash income (0 when no income)
    marginal_rate: Amount  # bracket rate at taxable_income


def compute_tax_year(inp: TaxYearInput) -> TaxYearResult:
    """Federal household tax for one year (pure; vectorization-ready)."""
    ordinary = np.asarray(inp.ordinary_income, dtype=float)
    ss = np.asarray(inp.ss_benefits, dtype=float)
    withdrawals = np.asarray(inp.tax_deferred_withdrawals, dtype=float)
    index = np.asarray(inp.price_index, dtype=float)

    non_ss_income = ordinary + withdrawals
    taxable_ss = np.asarray(
        taxable_social_security(ss, non_ss_income, inp.filing_status), dtype=float
    )
    agi = non_ss_income + taxable_ss

    if inp.deduction is None:
        deduction = np.asarray(standard_deduction(inp.filing_status, index), dtype=float)
    else:
        deduction = np.asarray(inp.deduction, dtype=float)
    taxable = np.maximum(agi - deduction, 0.0)

    tax = np.asarray(ordinary_tax(taxable, inp.filing_status, index), dtype=float)
    marginal = np.asarray(
        ordinary_marginal_rate(taxable, inp.filing_status, index), dtype=float
    )

    # Effective rate over gross cash income (what the household actually
    # received), matching how the engine's effective_tax_rate_pct knob reads.
    gross = non_ss_income + ss
    gross, tax_b = np.broadcast_arrays(gross, tax)
    effective = np.divide(tax_b, gross, out=np.zeros_like(tax_b), where=gross > 0.0)

    amounts = (
        inp.ordinary_income,
        inp.ss_benefits,
        inp.tax_deferred_withdrawals,
        inp.price_index,
        *(() if inp.deduction is None else (inp.deduction,)),
    )
    return TaxYearResult(
        taxable_ss=_maybe_scalar(taxable_ss + np.zeros_like(tax), *amounts),
        agi=_maybe_scalar(agi + np.zeros_like(tax), *amounts),
        taxable_income=_maybe_scalar(taxable + np.zeros_like(tax), *amounts),
        tax=_maybe_scalar(tax, *amounts),
        effective_rate=_maybe_scalar(effective, *amounts),
        marginal_rate=_maybe_scalar(marginal, *amounts),
    )
