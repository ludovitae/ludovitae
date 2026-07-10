"""Monthly-resolution projection engine: deterministic path + Monte Carlo.

Vectorized over paths — arrays are shaped (n_paths, n_months); the only Python
loop is over months (state recurrence), never over paths.

Model summary (coarse by design, see ARCHITECTURE.md):
- Four buckets: cash, invested, property, debt.
- Lognormal monthly returns per asset class; invested bucket is a monthly
  rebalanced mix of stocks/bonds/cash weights.
- Inflation is AR(1) around the assumed mean; a per-path price index inflates
  retirement spending and social security.
- Retirement transition: flagged income and all baseline expense flows stop;
  spending switches to annual_retirement_spending (inflated); shortfalls are
  withdrawn from cash first, then from invested grossed up by a coarse
  effective tax on the retirement-account share.
- Income is taxed at the effective rate. Taxes are a v1 knob, not brackets.
"""

from __future__ import annotations

import numpy as np

from gol.sim.types import (
    CONTRIB_DEBT,
    CONTRIB_INVESTED,
    EXPENSE,
    INCOME,
    FlowSpec,
    PlanInputs,
)

PERCENTILES = (10, 25, 50, 75, 90)


def _flow_array(spec: FlowSpec, n_months: int, retirement_month: int) -> np.ndarray:
    """Monthly amounts for one flow: growth applied annually-compounded."""
    out = np.zeros(n_months)
    end = n_months if spec.end_month is None else min(spec.end_month, n_months)
    if spec.stops_at_retirement:
        end = min(end, retirement_month)
    start = max(spec.start_month, 0)
    if start >= end:
        return out
    t = np.arange(start, end)
    growth = (1.0 + spec.annual_growth_pct / 100.0) ** ((t - start) / 12.0)
    out[start:end] = spec.amount_monthly * growth
    return out


def _build_flow_arrays(inputs: PlanInputs) -> dict[str, np.ndarray]:
    n, ret = inputs.n_months, inputs.retirement_month
    arrays = {k: np.zeros(n) for k in (INCOME, EXPENSE, CONTRIB_INVESTED, CONTRIB_DEBT)}
    for spec in inputs.flows:
        arrays[spec.kind] += _flow_array(spec, n, ret)

    one_time = np.zeros(n)
    for ev in inputs.one_time_events:
        if 0 <= ev.month < n:
            one_time[ev.month] += ev.amount
    arrays["one_time"] = one_time

    ret_spend = np.zeros(n)
    ret_spend[ret:] = inputs.annual_retirement_spending / 12.0
    arrays["ret_spend_base"] = ret_spend

    ss = np.zeros(n)
    ss_month = max(0, min((inputs.ss_start_age - inputs.start_age) * 12, n))
    ss[ss_month:] = inputs.social_security_monthly
    arrays["ss_base"] = ss
    return arrays


def _monthly_lognormal_factors(
    mean_pct: float, vol_pct: float, z: np.ndarray | None, shape: tuple[int, int]
) -> np.ndarray:
    """Monthly growth factors for an asset class.

    Annual log-return ~ N(ln(1+m) - s^2/2, s^2) so E[annual factor] = 1+m;
    monthly params scale by 1/12 (mean) and 1/sqrt(12) (vol). ``z=None``
    yields the deterministic expected factor (1+m)^(1/12).
    """
    if z is None:
        return np.full(shape, (1.0 + mean_pct / 100.0) ** (1.0 / 12.0))
    sigma_a = vol_pct / 100.0
    mu_m = (np.log(1.0 + mean_pct / 100.0) - 0.5 * sigma_a**2) / 12.0
    sigma_m = sigma_a / np.sqrt(12.0)
    return np.exp(mu_m + sigma_m * z)


def _inflation_price_index(
    inputs: PlanInputs, eps: np.ndarray | None, shape: tuple[int, int]
) -> np.ndarray:
    """Cumulative price index per path (AR(1) monthly inflation)."""
    mean_m = (1.0 + inputs.inflation_mean_pct / 100.0) ** (1.0 / 12.0) - 1.0
    if eps is None:
        return np.cumprod(np.full(shape, 1.0 + mean_m), axis=1)
    phi = inputs.market.inflation_ar1_phi
    sigma_m = inputs.market.inflation_vol_pct / 100.0 / np.sqrt(12.0)
    n_paths, n_months = shape
    rates = np.empty(shape)
    prev = np.zeros(n_paths)  # deviation from mean
    for t in range(n_months):  # loop over months, vectorized over paths
        prev = phi * prev + sigma_m * eps[:, t]
        rates[:, t] = mean_m + prev
    return np.cumprod(1.0 + rates, axis=1)


def _run_paths(
    inputs: PlanInputs, n_paths: int, rng: np.random.Generator | None
) -> dict[str, np.ndarray]:
    """Core monthly recurrence. rng=None → deterministic expected path."""
    n = inputs.n_months
    shape = (n_paths, n)
    flows = _build_flow_arrays(inputs)

    if rng is None:
        z_s = z_b = z_c = eps = None
    else:
        # Fixed draw order keeps seeded runs reproducible.
        z_s = rng.standard_normal(shape)
        z_b = rng.standard_normal(shape)
        z_c = rng.standard_normal(shape)
        eps = rng.standard_normal(shape)

    m = inputs.market
    f_stocks = _monthly_lognormal_factors(m.stocks_mean_pct, m.stocks_vol_pct, z_s, shape)
    f_bonds = _monthly_lognormal_factors(m.bonds_mean_pct, m.bonds_vol_pct, z_b, shape)
    f_cash = _monthly_lognormal_factors(m.cash_mean_pct, m.cash_vol_pct, z_c, shape)
    w_s, w_b, w_c = inputs.invested_weights
    f_invested = w_s * f_stocks + w_b * f_bonds + w_c * f_cash
    price = _inflation_price_index(inputs, eps, shape)

    tax = inputs.effective_tax_rate_pct / 100.0
    wtax = tax * inputs.retirement_share  # coarse tax on retirement-share withdrawals
    prop_f = (1.0 + inputs.property_growth_pct / 100.0) ** (1.0 / 12.0)
    debt_f = (1.0 + inputs.debt_growth_pct / 100.0) ** (1.0 / 12.0)

    cash = np.full(n_paths, float(inputs.cash0))
    invested = np.full(n_paths, float(inputs.invested0))
    prop = np.full(n_paths, float(inputs.property0))
    debt = np.full(n_paths, float(inputs.debt0))

    out = {k: np.empty(shape) for k in ("net_worth", "cash", "invested", "property", "debt")}

    income_fixed = flows[INCOME]
    expense_fixed = flows[EXPENSE]
    contrib_inv = flows[CONTRIB_INVESTED]
    contrib_debt = flows[CONTRIB_DEBT]
    one_time = flows["one_time"]
    ret_spend_base = flows["ret_spend_base"]
    ss_base = flows["ss_base"]

    for t in range(n):  # months; all ops below are vectorized over paths
        p = price[:, t]
        cash = cash + (income_fixed[t] + ss_base[t] * p) * (1.0 - tax)
        cash = cash - expense_fixed[t] - ret_spend_base[t] * p + one_time[t]

        cash = cash - contrib_inv[t]
        invested = invested + contrib_inv[t]
        pay = np.minimum(contrib_debt[t], debt)
        cash = cash - pay
        debt = debt - pay

        # Cover negative cash from invested, grossing up for withdrawal tax.
        shortfall = np.maximum(-cash, 0.0)
        gross = shortfall / (1.0 - wtax)
        w = np.minimum(gross, np.maximum(invested, 0.0))
        invested = invested - w
        cash = cash + w * (1.0 - wtax)

        invested = invested * f_invested[:, t]
        cash = np.where(cash > 0, cash * f_cash[:, t], cash)
        prop = prop * prop_f
        debt = debt * debt_f

        out["cash"][:, t] = cash
        out["invested"][:, t] = invested
        out["property"][:, t] = prop
        out["debt"][:, t] = debt
        out["net_worth"][:, t] = cash + invested + prop - debt

    return out


def _annual(arr: np.ndarray, n_years: int) -> np.ndarray:
    """Year-end samples (December of each plan year) from monthly columns."""
    idx = np.arange(n_years) * 12 + 11
    return arr[:, idx]


def run_simulation(inputs: PlanInputs, n_paths: int = 1000, seed: int = 0) -> dict:
    """Run deterministic + Monte Carlo projections; returns API-shaped dict."""
    n_years = inputs.n_years
    ages = [inputs.start_age + i for i in range(n_years)]

    det = _run_paths(inputs, 1, None)
    deterministic = {
        "net_worth": _annual(det["net_worth"], n_years)[0].round(2).tolist(),
        "invested": _annual(det["invested"], n_years)[0].round(2).tolist(),
        "cash": _annual(det["cash"], n_years)[0].round(2).tolist(),
        "property": _annual(det["property"], n_years)[0].round(2).tolist(),
        "debt": _annual(det["debt"], n_years)[0].round(2).tolist(),
    }

    rng = np.random.default_rng(seed)
    mc = _run_paths(inputs, n_paths, rng)
    nw_annual = _annual(mc["net_worth"], n_years)
    bands = np.percentile(nw_annual, PERCENTILES, axis=0)
    percentiles = {
        f"p{p}": bands[i].round(2).tolist() for i, p in enumerate(PERCENTILES)
    }

    final_nw = mc["net_worth"][:, -1]
    success_probability = float(np.mean(final_nw > 0.0))

    ruined = final_nw <= 0.0
    median_ruin_age: float | None = None
    if ruined.any():
        ever_neg = mc["net_worth"][ruined] < 0.0
        first_neg = np.argmax(ever_neg, axis=1)
        ruin_ages = inputs.start_age + first_neg / 12.0
        median_ruin_age = round(float(np.median(ruin_ages)), 1)

    ending = np.percentile(final_nw, [10, 50, 90])
    return {
        "n_paths": n_paths,
        "seed": seed,
        "start_year": inputs.start_year,
        "ages": ages,
        "deterministic": deterministic,
        "percentiles": percentiles,
        "success_probability": round(success_probability, 4),
        "median_ruin_age": median_ruin_age,
        "ending_net_worth": {
            "p10": round(float(ending[0]), 2),
            "p50": round(float(ending[1]), 2),
            "p90": round(float(ending[2]), 2),
        },
    }
