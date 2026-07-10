"""Assembly layer: builds sim PlanInputs from the database (baseline reality)
and applies scenario param diffs. This is the only bridge between the ORM and
the pure engine in gol/sim/.
"""

from __future__ import annotations

import datetime as dt

from sqlalchemy import select
from sqlalchemy.orm import Session as DbSession, selectinload

from gol.models import (
    CASH_TYPES,
    INVESTABLE_TYPES,
    LIABILITY_TYPES,
    PROPERTY_TYPES,
    Account,
    Flow,
    Profile,
    Setting,
)
from gol.sim import FlowSpec, MarketParams, OneTimeEvent, PlanInputs
from gol.sim.types import CONTRIB_DEBT, CONTRIB_INVESTED, EXPENSE, INCOME

# asset_class -> (stocks, bonds, cash) weights; "mixed" is a 60/40 portfolio.
_CLASS_WEIGHTS = {
    "stocks": (1.0, 0.0, 0.0),
    "bonds": (0.0, 1.0, 0.0),
    "cash": (0.0, 0.0, 1.0),
    "mixed": (0.6, 0.4, 0.0),
    None: (0.6, 0.4, 0.0),
}


def get_or_create_profile(db: DbSession) -> Profile:
    profile = db.execute(select(Profile)).scalar_one_or_none()
    if profile is None:
        profile = Profile()
        db.add(profile)
        db.flush()
    return profile


def get_or_create_settings(db: DbSession) -> Setting:
    setting = db.execute(select(Setting)).scalar_one_or_none()
    if setting is None:
        setting = Setting()
        db.add(setting)
        db.flush()
    return setting


def _months_from_now(date: dt.date, today: dt.date) -> int:
    return (date.year - today.year) * 12 + (date.month - today.month)


def _flow_window(flow: Flow, today: dt.date) -> tuple[int, int | None]:
    start = 0 if flow.start_date is None else max(0, _months_from_now(flow.start_date, today))
    end = None if flow.end_date is None else max(0, _months_from_now(flow.end_date, today) + 1)
    return start, end


def build_plan_inputs(
    db: DbSession, params: dict | None = None, today: dt.date | None = None
) -> PlanInputs:
    """Baseline PlanInputs from profile/accounts/flows, with a scenario params
    diff applied on top (all keys optional, per docs/API.md)."""
    params = params or {}
    today = today or dt.date.today()
    profile = get_or_create_profile(db)

    start_year = today.year
    start_age = start_year - profile.birth_year
    retirement_age = int(params.get("retirement_age") or profile.retirement_age)
    life_expectancy = profile.life_expectancy

    accounts = (
        db.execute(select(Account).options(selectinload(Account.balances)))
        .scalars()
        .all()
    )
    cash0 = invested0 = property0 = debt0 = 0.0
    retirement_bal = 0.0
    w_acc = [0.0, 0.0, 0.0]
    prop_growth_weighted = debt_growth_weighted = 0.0
    invested_by_id: dict[int, bool] = {}
    liability_by_id: dict[int, bool] = {}

    for acc in accounts:
        invested_by_id[acc.id] = acc.type in INVESTABLE_TYPES
        liability_by_id[acc.id] = acc.type in LIABILITY_TYPES
        if not acc.include_in_net_worth:
            continue
        bal = acc.balance
        if acc.type in CASH_TYPES:
            cash0 += bal
        elif acc.type in INVESTABLE_TYPES:
            invested0 += bal
            if acc.type == "retirement":
                retirement_bal += bal
            weights = _CLASS_WEIGHTS.get(acc.asset_class, _CLASS_WEIGHTS[None])
            for i in range(3):
                w_acc[i] += bal * weights[i]
        elif acc.type in PROPERTY_TYPES:
            property0 += bal
            prop_growth_weighted += bal * (acc.growth_rate_pct or 0.0)
        elif acc.type in LIABILITY_TYPES:
            debt0 += bal
            debt_growth_weighted += bal * (acc.growth_rate_pct or 0.0)

    invested_weights = (
        tuple(w / invested0 for w in w_acc) if invested0 > 0 else (0.6, 0.4, 0.0)
    )
    retirement_share = retirement_bal / invested0 if invested0 > 0 else 0.0
    property_growth = prop_growth_weighted / property0 if property0 > 0 else 0.0
    debt_growth = debt_growth_weighted / debt0 if debt0 > 0 else 0.0

    specs: list[FlowSpec] = []
    for flow in db.execute(select(Flow)).scalars():
        start, end = _flow_window(flow, today)
        if flow.kind == "income":
            specs.append(
                FlowSpec(INCOME, flow.amount_monthly, flow.annual_growth_pct, start, end,
                         stops_at_retirement=flow.ends_at_retirement)
            )
        elif flow.kind == "expense":
            # Regular spending is replaced by annual_retirement_spending at
            # retirement (ARCHITECTURE.md retirement transition).
            specs.append(
                FlowSpec(EXPENSE, flow.amount_monthly, flow.annual_growth_pct, start, end,
                         stops_at_retirement=True)
            )
        elif flow.kind == "contribution":
            if flow.account_id is None:
                continue
            if liability_by_id.get(flow.account_id):
                kind = CONTRIB_DEBT
            elif invested_by_id.get(flow.account_id):
                kind = CONTRIB_INVESTED
            else:
                continue  # cash->cash / property transfers are net-worth no-ops
            specs.append(
                FlowSpec(kind, flow.amount_monthly, flow.annual_growth_pct, start, end,
                         stops_at_retirement=flow.ends_at_retirement)
            )

    one_time: list[OneTimeEvent] = []

    # --- scenario diff ---
    delta = params.get("monthly_savings_delta")
    if delta:
        # Interpreted as redirected spending: spend `delta` less (or more, if
        # negative) and contribute it to invested assets, until retirement.
        specs.append(FlowSpec(EXPENSE, -float(delta), 0.0, 0, None, stops_at_retirement=True))
        specs.append(
            FlowSpec(CONTRIB_INVESTED, float(delta), 0.0, 0, None, stops_at_retirement=True)
        )

    for ev in params.get("events") or []:
        kind = ev.get("kind")
        if kind == "one_time":
            month = (int(ev["age"]) - start_age) * 12
            if month >= 0:
                one_time.append(OneTimeEvent(month=month, amount=float(ev["amount"])))
        elif kind in ("recurring_expense", "recurring_income"):
            start_m = max(0, (int(ev.get("start_age") or start_age) - start_age) * 12)
            end_age = ev.get("end_age")
            end_m = None if end_age is None else max(0, (int(end_age) - start_age + 1) * 12)
            spec_kind = EXPENSE if kind == "recurring_expense" else INCOME
            specs.append(
                FlowSpec(spec_kind, float(ev["amount_monthly"]), 0.0, start_m, end_m,
                         stops_at_retirement=False)
            )

    market = MarketParams()
    ret_override = params.get("return_override_pct")
    if ret_override is not None:
        # Expected-return override applied to every asset class (vols kept).
        market = MarketParams(
            stocks_mean_pct=float(ret_override),
            bonds_mean_pct=float(ret_override),
            cash_mean_pct=float(ret_override),
        )

    inflation = params.get("inflation_override_pct")
    spending = params.get("annual_retirement_spending")

    return PlanInputs(
        start_age=start_age,
        retirement_age=retirement_age,
        life_expectancy=life_expectancy,
        start_year=start_year,
        cash0=cash0,
        invested0=invested0,
        property0=property0,
        debt0=debt0,
        invested_weights=invested_weights,  # type: ignore[arg-type]
        retirement_share=retirement_share,
        property_growth_pct=property_growth,
        debt_growth_pct=debt_growth,
        flows=tuple(specs),
        one_time_events=tuple(one_time),
        annual_retirement_spending=(
            float(spending) if spending is not None else profile.annual_retirement_spending
        ),
        social_security_monthly=profile.social_security_monthly,
        ss_start_age=profile.social_security_start_age,
        inflation_mean_pct=(
            float(inflation) if inflation is not None else profile.inflation_pct
        ),
        effective_tax_rate_pct=profile.effective_tax_rate_pct,
        market=market,
    )
