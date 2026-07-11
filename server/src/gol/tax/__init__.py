"""Bracket-aware federal tax module (T-012 phase 1).

Standalone and engine-independent: pure functions over floats or numpy
arrays, no ORM or gol.sim imports. Integration into the simulation engine is
a follow-up task — see docs/TAX-DESIGN.md for the plan.
"""

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
from gol.tax.plan import TaxYearInput, TaxYearResult, compute_tax_year
from gol.tax.social_security import (
    SS_TAXABILITY_THRESHOLDS,
    provisional_income,
    taxable_social_security,
)

__all__ = [
    "FILING_STATUSES",
    "LTCG_BRACKETS",
    "ORDINARY_BRACKETS",
    "SS_TAXABILITY_THRESHOLDS",
    "STANDARD_DEDUCTION",
    "TAX_YEAR",
    "TaxBrackets",
    "TaxYearInput",
    "TaxYearResult",
    "bracket_tax",
    "compute_tax_year",
    "marginal_rate",
    "ordinary_marginal_rate",
    "ordinary_tax",
    "provisional_income",
    "standard_deduction",
    "taxable_social_security",
]
