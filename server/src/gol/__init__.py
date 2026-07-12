"""Game of Life backend package."""

ENGINE_VERSION = "4"

# Human-readable behavior changes since the prior engine version, surfaced in
# every /simulate response so the UI can explain why cached numbers moved.
ENGINE_NOTES = [
    "Accounts carry a tax treatment (tax_deferred | roth | taxable | hsa):"
    " Roth retirement balances now grow tax-free, take no RMDs, and are"
    " withdrawn untaxed — fixing phantom RMDs and phantom withdrawal tax on"
    " Roth accounts. Households whose retirement money is all tax-deferred"
    " are numerically unchanged; households with a Roth split see lower tax"
    " and no forced Roth distributions",
    "Bracket-aware federal tax when the flat-rate override is unset"
    " (tax_model=brackets): 2026 brackets and standard deduction indexed by"
    " simulated inflation, Social Security taxed via provisional income"
    " (replaces the flat 85% cap), RMDs and withdrawals fill brackets;"
    " annual settlement with monthly withholding",
    "Flat-rate mode (effective_tax_rate_pct set, tax_model=flat) is"
    " numerically unchanged from engine v2",
]
