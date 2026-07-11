"""Monthly-resolution projection engine: deterministic path + Monte Carlo.

Vectorized over paths — arrays are shaped (n_paths, n_months); the only Python
loops are over months (state recurrence) and over household members (tiny),
never over paths.

Model summary (coarse by design, see ARCHITECTURE.md):
- Buckets: cash, invested (with per-member tax-deferred sub-buckets), property,
  debt.
- Lognormal monthly returns per asset class; invested bucket is a monthly
  rebalanced mix of stocks/bonds/cash weights. Tax-deferred sub-buckets grow
  with the same blended factor and shrink pro-rata on shortfall withdrawals.
- Inflation is AR(1) around the assumed mean; a per-path price index inflates
  retirement spending and social security.
- Per-member timing (v1.1): income/contribution stops are pre-resolved into
  flow windows by assembly; each member's social security starts at their
  claim month (actuarially adjusted amount) and stops at their life end; RMDs
  force an annual distribution (balance / Uniform Lifetime Table divisor) from
  the member's tax-deferred bucket from their RMD start month to their life
  end, taxed at the effective rate, remainder to cash.
- Household retirement transition: baseline expenses stop (via flow windows)
  and spending switches to annual_retirement_spending (inflated) at the LAST
  retirement.
- Shortfalls are withdrawn from cash first, then from invested grossed up by a
  coarse effective tax on the (fixed) retirement-account share — unchanged
  from v1 so migrated plans simulate identically.
- Income is taxed at the effective rate. Taxes are a coarse knob, not brackets.
- Social security: at most ``SS_TAXABLE_SHARE`` (85%) of the benefit is
  taxable (engine v2, T-011), so SS take-home is ``ss * (1 - 0.85 * tax)``.
  The provisional-income phase-in is deliberately NOT modeled (bracket
  workstream); 85% is the honest ceiling, not a precise model.
"""

from __future__ import annotations

import numpy as np

from gol.sim.tables import SS_CLAIM_FACTORS, rmd_divisor
from gol.sim.types import (
    CONTRIB_DEBT,
    CONTRIB_INVESTED,
    EXPENSE,
    INCOME,
    FlowSpec,
    PlanInputs,
)

PERCENTILES = (10, 25, 50, 75, 90)

# At most this share of a social security benefit is taxable (IRS ceiling).
SS_TAXABLE_SHARE = 0.85


def _flow_array(spec: FlowSpec, n_months: int) -> np.ndarray:
    """Monthly amounts for one flow: growth applied annually-compounded."""
    out = np.zeros(n_months)
    end = n_months if spec.end_month is None else min(spec.end_month, n_months)
    start = max(spec.start_month, 0)
    if start >= end:
        return out
    t = np.arange(start, end)
    growth = (1.0 + spec.annual_growth_pct / 100.0) ** ((t - start) / 12.0)
    out[start:end] = spec.amount_monthly * growth
    return out


def _build_flow_arrays(inputs: PlanInputs) -> dict[str, np.ndarray]:
    n = inputs.n_months
    arrays = {k: np.zeros(n) for k in (INCOME, EXPENSE, CONTRIB_INVESTED, CONTRIB_DEBT)}
    td_contrib = np.zeros((len(inputs.members), n))
    for spec in inputs.flows:
        arr = _flow_array(spec, n)
        arrays[spec.kind] += arr
        if spec.kind == CONTRIB_INVESTED and spec.td_member is not None:
            td_contrib[spec.td_member] += arr
    arrays["td_contrib"] = td_contrib

    one_time = np.zeros(n)
    for ev in inputs.one_time_events:
        if 0 <= ev.month < n:
            one_time[ev.month] += ev.amount
    arrays["one_time"] = one_time

    ret_spend = np.zeros(n)
    ret_spend[max(0, min(inputs.retirement_month, n)):] = (
        inputs.annual_retirement_spending / 12.0
    )
    arrays["ret_spend_base"] = ret_spend

    # Social security: per member, from claim month to their life end.
    ss = np.zeros(n)
    for m in inputs.members:
        if m.ss_monthly <= 0 or m.ss_start_month is None:
            continue
        start = max(0, min(m.ss_start_month, n))
        end = max(0, min(m.life_end_month, n))
        ss[start:end] += m.ss_monthly
    arrays["ss_base"] = ss
    return arrays


def _rmd_schedule(inputs: PlanInputs) -> dict[int, list[tuple[int, float]]]:
    """month -> [(member_index, ULT divisor)]. Annual, on the plan-year grid
    (member ages are birth-year based, so age ticks align with plan years);
    RMDs run from the member's RMD start month to their life end."""
    by_month: dict[int, list[tuple[int, float]]] = {}
    for idx, m in enumerate(inputs.members):
        if m.rmd_start_month is None:
            continue
        start = m.rmd_start_month
        while start < 0:
            start += 12  # already past RMD age: distributions continue annually
        end = min(inputs.n_months, max(0, m.life_end_month))
        for t in range(start, end, 12):
            age = (m.age0_months + t) // 12
            by_month.setdefault(t, []).append((idx, rmd_divisor(age)))
    return by_month


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
) -> dict[str, np.ndarray | dict]:
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
    ss_net = 1.0 - SS_TAXABLE_SHARE * tax  # only 85% of SS is taxable (engine v2)
    prop_f = (1.0 + inputs.property_growth_pct / 100.0) ** (1.0 / 12.0)
    debt_f = (1.0 + inputs.debt_growth_pct / 100.0) ** (1.0 / 12.0)

    cash = np.full(n_paths, float(inputs.cash0))
    invested = np.full(n_paths, float(inputs.invested0))
    prop = np.full(n_paths, float(inputs.property0))
    debt = np.full(n_paths, float(inputs.debt0))

    # Per-member tax-deferred sub-buckets of `invested` (RMD accounting only:
    # they never move money by themselves, so plans without RMD activity
    # reproduce v1 outputs exactly).
    n_members = len(inputs.members)
    td = np.zeros((n_members, n_paths))
    for i, member in enumerate(inputs.members):
        td[i] = float(member.tax_deferred0)
    td_contrib = flows["td_contrib"]
    rmd_at = _rmd_schedule(inputs)
    # Track sub-buckets only when they can ever be non-zero (perf).
    track_td = n_members > 0 and (td.any() or td_contrib.any())
    # First scheduled RMD month per member (for the milestone balance check).
    rmd_first: dict[int, int] = {}
    for t, items in rmd_at.items():
        for idx, _ in items:
            rmd_first[idx] = min(rmd_first.get(idx, t), t)
    td_at_rmd_start: dict[int, np.ndarray] = {}

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
        cash = cash + income_fixed[t] * (1.0 - tax) + ss_base[t] * p * ss_net
        cash = cash - expense_fixed[t] - ret_spend_base[t] * p + one_time[t]

        cash = cash - contrib_inv[t]
        invested = invested + contrib_inv[t]
        if track_td:
            for i in range(n_members):
                if td_contrib[i, t]:
                    td[i] += td_contrib[i, t]
        pay = np.minimum(contrib_debt[t], debt)
        cash = cash - pay
        debt = debt - pay

        # Forced RMDs: annual distribution from the member's tax-deferred
        # bucket, taxed at the effective rate, remainder to cash.
        if track_td and t in rmd_at:
            for i, divisor in rmd_at[t]:
                if rmd_first.get(i) == t:
                    td_at_rmd_start[i] = td[i].copy()
                dist = td[i] / divisor
                td[i] = td[i] - dist
                invested = invested - dist
                cash = cash + dist * (1.0 - tax)

        # Cover negative cash from invested, grossing up for withdrawal tax.
        shortfall = np.maximum(-cash, 0.0)
        gross = shortfall / (1.0 - wtax)
        w = np.minimum(gross, np.maximum(invested, 0.0))
        inv_before = invested
        invested = invested - w
        cash = cash + w * (1.0 - wtax)
        if track_td:
            # Withdrawals shrink tax-deferred sub-buckets pro-rata.
            denom = np.where(inv_before > 0.0, inv_before, 1.0)
            td = td * np.where(inv_before > 0.0, 1.0 - w / denom, 1.0)

        invested = invested * f_invested[:, t]
        if track_td:
            td = td * f_invested[:, t]
        cash = np.where(cash > 0, cash * f_cash[:, t], cash)
        prop = prop * prop_f
        debt = debt * debt_f

        out["cash"][:, t] = cash
        out["invested"][:, t] = invested
        out["property"][:, t] = prop
        out["debt"][:, t] = debt
        out["net_worth"][:, t] = cash + invested + prop - debt

    out["td_at_rmd_start"] = td_at_rmd_start
    return out


def _ss_label(name: str, claim_age: int | None) -> str:
    if claim_age in SS_CLAIM_FACTORS:
        return f"{name} claims Social Security ({SS_CLAIM_FACTORS[claim_age] * 100:g}% of FRA)"
    return f"{name} claims Social Security"


def _milestones(inputs: PlanInputs, det_td_at_rmd_start: dict[int, np.ndarray]) -> list[dict]:
    """Every member's retirement / SS-claim / RMD-start events within the
    horizon, on the self member's age axis (docs/API.md v1.1). Events already
    in the past (negative month) or beyond the horizon are omitted; RMD start
    is only a milestone when there is a balance to distribute."""
    n = inputs.n_months
    events: list[tuple[int, int, dict]] = []
    for idx, m in enumerate(inputs.members):
        member_events: list[tuple[int, str, str]] = []
        if m.retirement_month is not None and 0 <= m.retirement_month < n:
            member_events.append((m.retirement_month, "retirement", f"{m.name} retires"))
        if m.ss_monthly > 0 and m.ss_start_month is not None and 0 <= m.ss_start_month < n:
            member_events.append(
                (m.ss_start_month, "ss_start", _ss_label(m.name, m.ss_claim_age))
            )
        if (
            m.rmd_start_month is not None
            and 0 <= m.rmd_start_month < min(n, m.life_end_month)
            and float(det_td_at_rmd_start.get(idx, np.zeros(1))[0]) > 0.005
        ):
            member_events.append((m.rmd_start_month, "rmd_start", f"RMDs begin for {m.name}"))
        for month, kind, label in member_events:
            events.append(
                (month, m.id,
                 {"age": inputs.start_age + month // 12,
                  "year": inputs.start_year + month // 12,
                  "kind": kind, "label": label, "member_id": m.id})
            )
    events.sort(key=lambda e: (e[0], e[1]))
    return [e[2] for e in events]


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
    milestones = _milestones(inputs, det["td_at_rmd_start"])

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
        "milestones": milestones,
    }
