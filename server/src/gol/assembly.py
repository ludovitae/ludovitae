"""Assembly layer: builds sim PlanInputs from the database (baseline reality)
and applies scenario param diffs. This is the only bridge between the ORM and
the pure engine in gol/sim/.

v1.1 timing resolution happens here: per-member retirement/SS/RMD months are
computed on the self member's month grid, retirement stops are baked into
flow windows (owner's retirement for owned income/contributions, the
household transition — last retirement — for expenses and unowned flows),
and retirement-account contributions are routed to the account owner's
tax-deferred bucket.
"""

from __future__ import annotations

import datetime as dt

from sqlalchemy import select
from sqlalchemy.orm import Session as DbSession
from sqlalchemy.orm import selectinload

from gol.errors import ApiError
from gol.models import (
    ADULT_ROLES,
    CASH_TYPES,
    INVESTABLE_TYPES,
    LIABILITY_TYPES,
    PROPERTY_TYPES,
    Account,
    Flow,
    HouseholdMember,
    Profile,
    Setting,
    SpendingCategory,
)
from gol.sim import (
    SS_CLAIM_FACTORS,
    FlowSpec,
    MarketParams,
    MemberSpec,
    OneTimeEvent,
    PlanInputs,
    rmd_start_age,
)
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


def get_or_create_household(db: DbSession) -> list[HouseholdMember]:
    """All members, id order. Guarantees the exactly-one-self invariant by
    creating a default self member (v1 profile defaults) when missing."""
    members = list(
        db.execute(select(HouseholdMember).order_by(HouseholdMember.id)).scalars()
    )
    if not any(m.role == "self" for m in members):
        member = HouseholdMember(
            name="You", role="self", birth_year=1980, life_expectancy=92,
            retirement_age=65, ss_monthly_at_fra=0.0, ss_claim_age=67,
        )
        db.add(member)
        db.flush()
        members = list(
            db.execute(select(HouseholdMember).order_by(HouseholdMember.id)).scalars()
        )
    return members


def _months_from_now(date: dt.date, today: dt.date) -> int:
    return (date.year - today.year) * 12 + (date.month - today.month)


def _flow_window(flow: Flow, today: dt.date) -> tuple[int, int | None]:
    start = 0 if flow.start_date is None else max(0, _months_from_now(flow.start_date, today))
    end = None if flow.end_date is None else max(0, _months_from_now(flow.end_date, today) + 1)
    return start, end


def _cap_end(end: int | None, stop_month: int) -> int:
    return stop_month if end is None else min(end, stop_month)


def validate_person_data(
    birth_year: int, life_expectancy: int, today: dt.date | None = None
) -> None:
    """Write-time consistency check for a household member (#7).

    Mirrors exactly the ``invalid_plan_horizon`` guard in ``build_plan_inputs``
    (below), so degenerate person data is rejected at write time instead of
    only when a simulation runs. The two conditions kept in sync:

    * ``birth_year`` in the future — current age would be negative.
    * ``life_expectancy`` below the member's current age — nothing to simulate.

    Uses error code ``invalid_person_data``. ``retirement_age`` is deliberately
    NOT checked here because the simulate-time guard only clamps it (never
    rejects it). The guard stays in place as defense in depth.
    """
    today = today or dt.date.today()
    current_age = today.year - birth_year
    if current_age < 0:
        raise ApiError(
            422, "invalid_person_data",
            "birth_year is in the future; current age must be non-negative",
        )
    if life_expectancy < current_age:
        raise ApiError(
            422, "invalid_person_data",
            "life_expectancy is below current age; nothing to simulate",
        )


def build_plan_inputs(
    db: DbSession, params: dict | None = None, today: dt.date | None = None
) -> PlanInputs:
    """Baseline PlanInputs from profile/household/accounts/flows/spending,
    with a scenario params diff applied on top (all keys optional)."""
    params = params or {}
    today = today or dt.date.today()
    profile = get_or_create_profile(db)
    members = get_or_create_household(db)
    self_member = next(m for m in members if m.role == "self")

    start_year = today.year
    start_age = start_year - self_member.birth_year

    # Guard degenerate plan horizons before they reach the numpy engine, which
    # would otherwise raise on a non-positive month count (surfacing as a 500).
    if start_age < 0:
        raise ApiError(
            422, "invalid_plan_horizon",
            "birth_year is in the future; current age must be non-negative",
        )
    if self_member.life_expectancy < start_age:
        raise ApiError(
            422, "invalid_plan_horizon",
            "life_expectancy is below current age; nothing to simulate",
        )

    # --- effective per-member timing (scenario overrides applied) -----------
    overrides: dict = params.get("member_overrides") or {}
    # Top-level retirement_age is sugar for the self member's override; an
    # explicit member_overrides entry for self wins over the sugar.
    # Children never drive timing: no retirement/SS/RMD schedules, and they
    # never extend the horizon (coordinator ruling 2026-07-11).
    adults = [m for m in members if m.role in ADULT_ROLES]
    retirement_ages: dict[int, int | None] = {}
    claim_ages: dict[int, int | None] = {}
    for m in adults:
        o = overrides.get(str(m.id)) or {}
        ret = o.get("retirement_age", m.retirement_age)
        if m.role == "self" and "retirement_age" not in o and params.get("retirement_age"):
            ret = int(params["retirement_age"])
        retirement_ages[m.id] = ret
        claim_ages[m.id] = o.get("ss_claim_age", m.ss_claim_age)

    age0 = {m.id: (start_year - m.birth_year) * 12 for m in members}
    # Horizon: latest life expectancy among ADULT members only.
    life_end = {m.id: (m.life_expectancy + 1) * 12 - age0[m.id] for m in members}
    horizon_months = max(life_end[m.id] for m in adults)

    ret_month_raw = {
        m.id: retirement_ages[m.id] * 12 - age0[m.id]
        for m in adults if retirement_ages[m.id] is not None
    }
    ret_month = {
        mid: max(0, min(raw, horizon_months)) for mid, raw in ret_month_raw.items()
    }
    # Household spending transition: the LAST retirement (horizon = never).
    household_ret = max(ret_month.values()) if ret_month else horizon_months

    # --- accounts: bucket balances + per-member tax-deferred ----------------
    accounts = (
        db.execute(select(Account).options(selectinload(Account.balances)))
        .scalars()
        .all()
    )
    member_ids = {m.id for m in members}
    member_index = {m.id: i for i, m in enumerate(members)}

    def owner_id(acc_member_id: int | None) -> int:
        # Unowned (or orphaned) tax-deferred balances use the self member.
        return acc_member_id if acc_member_id in member_ids else self_member.id

    cash0 = invested0 = property0 = debt0 = 0.0
    retirement_bal = 0.0
    tax_deferred0 = dict.fromkeys(member_ids, 0.0)
    w_acc = [0.0, 0.0, 0.0]
    prop_growth_weighted = debt_growth_weighted = 0.0
    invested_by_id: dict[int, bool] = {}
    liability_by_id: dict[int, bool] = {}
    account_owner: dict[int, int] = {}  # account id -> member id (retirement only)

    for acc in accounts:
        invested_by_id[acc.id] = acc.type in INVESTABLE_TYPES
        liability_by_id[acc.id] = acc.type in LIABILITY_TYPES
        if acc.type == "retirement":
            account_owner[acc.id] = owner_id(acc.member_id)
        if not acc.include_in_net_worth:
            continue
        bal = acc.balance
        if acc.type in CASH_TYPES:
            cash0 += bal
        elif acc.type in INVESTABLE_TYPES:
            invested0 += bal
            if acc.type == "retirement":
                retirement_bal += bal
                tax_deferred0[owner_id(acc.member_id)] += bal
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

    # --- scenario spending scale + inflation (needed while building flows) --
    inflation = params.get("inflation_override_pct")
    inflation_mean = float(inflation) if inflation is not None else profile.inflation_pct
    delta_pct = params.get("spending_delta_pct")
    spend_scale = 1.0 + float(delta_pct) / 100.0 if delta_pct else 1.0

    def member_stop_month(flow_member_id: int | None) -> int:
        """Where an ends_at_retirement flow stops: its owner's retirement, or
        the household transition when unowned / owner never retires."""
        if flow_member_id in ret_month:
            return ret_month[flow_member_id]
        return household_ret

    specs: list[FlowSpec] = []
    for flow in db.execute(select(Flow)).scalars():
        start, end = _flow_window(flow, today)
        if flow.kind == "income":
            if flow.ends_at_retirement:
                end = _cap_end(end, member_stop_month(flow.member_id))
            specs.append(FlowSpec(INCOME, flow.amount_monthly, flow.annual_growth_pct,
                                  start, end))
        elif flow.kind == "expense":
            # Regular spending is replaced by annual_retirement_spending at the
            # household retirement transition (ARCHITECTURE.md item 4).
            end = _cap_end(end, household_ret)
            specs.append(FlowSpec(EXPENSE, flow.amount_monthly * spend_scale,
                                  flow.annual_growth_pct, start, end))
        elif flow.kind == "contribution":
            if flow.account_id is None:
                continue
            if liability_by_id.get(flow.account_id):
                kind = CONTRIB_DEBT
            elif invested_by_id.get(flow.account_id):
                kind = CONTRIB_INVESTED
            else:
                continue  # cash->cash / property transfers are net-worth no-ops
            if flow.ends_at_retirement:
                end = _cap_end(end, member_stop_month(flow.member_id))
            td_member = None
            if kind == CONTRIB_INVESTED and flow.account_id in account_owner:
                td_member = member_index[account_owner[flow.account_id]]
            specs.append(FlowSpec(kind, flow.amount_monthly, flow.annual_growth_pct,
                                  start, end, td_member=td_member))

    # Spending categories are expense streams; null growth -> the (effective)
    # inflation assumption. They stop at the household retirement transition.
    for cat in db.execute(select(SpendingCategory)).scalars():
        if cat.monthly_amount == 0:
            continue
        growth = cat.annual_growth_pct if cat.annual_growth_pct is not None else inflation_mean
        specs.append(FlowSpec(EXPENSE, cat.monthly_amount * spend_scale, growth,
                              0, household_ret))

    one_time: list[OneTimeEvent] = []

    # --- scenario diff -------------------------------------------------------
    delta = params.get("monthly_savings_delta")
    if delta:
        # Redirected spending: spend `delta` less (or more, if negative) and
        # contribute it to invested assets, until the household retirement.
        # Deliberately NOT scaled by spending_delta_pct.
        specs.append(FlowSpec(EXPENSE, -float(delta), 0.0, 0, household_ret))
        specs.append(FlowSpec(CONTRIB_INVESTED, float(delta), 0.0, 0, household_ret))

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
            specs.append(FlowSpec(spec_kind, float(ev["amount_monthly"]), 0.0,
                                  start_m, end_m))

    market = MarketParams()
    ret_override = params.get("return_override_pct")
    if ret_override is not None:
        # Expected-return override applied to every asset class (vols kept).
        market = MarketParams(
            stocks_mean_pct=float(ret_override),
            bonds_mean_pct=float(ret_override),
            cash_mean_pct=float(ret_override),
        )

    # --- member specs --------------------------------------------------------
    member_specs = []
    for m in members:
        is_adult = m.role in ADULT_ROLES
        claim = claim_ages.get(m.id)
        ss_monthly = 0.0
        ss_start_month = None
        if is_adult and m.ss_monthly_at_fra and claim is not None:
            claim = min(max(int(claim), 62), 70)
            ss_monthly = m.ss_monthly_at_fra * SS_CLAIM_FACTORS[claim]
            ss_start_month = claim * 12 - age0[m.id]
        member_specs.append(MemberSpec(
            id=m.id,
            name=m.name,
            age0_months=age0[m.id],
            # a child's life end must never leak past the adult horizon
            life_end_month=min(life_end[m.id], horizon_months),
            retirement_month=ret_month_raw.get(m.id),
            ss_monthly=ss_monthly,
            ss_start_month=ss_start_month,
            ss_claim_age=claim,
            tax_deferred0=tax_deferred0[m.id],
            rmd_start_month=(
                rmd_start_age(m.birth_year) * 12 - age0[m.id] if is_adult else None
            ),
        ))

    spending = params.get("annual_retirement_spending")

    return PlanInputs(
        start_age=start_age,
        start_year=start_year,
        horizon_months=horizon_months,
        retirement_month=household_ret,
        members=tuple(member_specs),
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
        inflation_mean_pct=inflation_mean,
        effective_tax_rate_pct=profile.effective_tax_rate_pct,
        market=market,
    )
