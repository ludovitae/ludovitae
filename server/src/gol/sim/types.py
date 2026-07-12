"""Input dataclasses for the simulation engine (pure, ORM-free).

v1.1: person-level timing lives on ``MemberSpec`` entries. All month fields
are offsets from plan month 0 on the self member's grid; they may be negative
(the event already happened) or beyond the horizon (it never happens in-plan).
The engine clamps for array work and omits out-of-range milestones. The
assembly layer resolves retirement stops into each flow's ``end_month``, so
flow windows are explicit here.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass, field

INCOME = "income"
EXPENSE = "expense"
CONTRIB_INVESTED = "contrib_invested"
CONTRIB_DEBT = "contrib_debt"


@dataclass(frozen=True)
class MarketParams:
    """Annual return/vol assumptions per asset class (documented defaults)."""

    stocks_mean_pct: float = 7.0
    stocks_vol_pct: float = 15.0
    bonds_mean_pct: float = 3.5
    bonds_vol_pct: float = 7.0
    cash_mean_pct: float = 1.5
    cash_vol_pct: float = 0.5
    inflation_vol_pct: float = 1.2
    inflation_ar1_phi: float = 0.85


@dataclass(frozen=True)
class MemberSpec:
    """One household member on the plan's month grid.

    ``ss_monthly`` is the already-actuarially-adjusted benefit (today's
    dollars); ``ss_claim_age`` is carried only for the milestone label.
    ``tax_deferred0`` is the member's starting pre-tax retirement balance and
    ``roth0`` the starting post-tax (Roth) retirement balance — both
    sub-buckets of the household ``invested0``. ``life_end_month`` is
    exclusive: the month after the member's last plan year.

    The Roth sub-bucket (#25) is a sibling of the tax-deferred one: it grows
    with the same blended factor and shrinks pro-rata on shortfall
    withdrawals, but it is EXCLUDED from the RMD base and its withdrawals are
    untaxed (they never gross up). A member holding only Roth retirement money
    therefore has no RMDs and no phantom withdrawal tax.
    """

    id: int
    name: str
    age0_months: int  # age at plan start, in months (birth-year granularity)
    life_end_month: int
    retirement_month: int | None = None
    ss_monthly: float = 0.0
    ss_start_month: int | None = None
    ss_claim_age: int | None = None
    tax_deferred0: float = 0.0
    roth0: float = 0.0
    rmd_start_month: int | None = None


@dataclass(frozen=True)
class FlowSpec:
    """A recurring monthly flow on the plan's month grid.

    ``start_month`` inclusive, ``end_month`` exclusive (None = plan end).
    Retirement stops are pre-resolved into ``end_month`` by the assembly
    layer (owner's retirement for owned income/contributions, the household
    transition for expenses and unowned income).

    ``td_member``: index into ``PlanInputs.members`` whose tax-deferred
    sub-bucket a ``contrib_invested`` flow lands in (None = not tax-deferred).
    ``roth_member``: same, for the Roth sub-bucket (#25). At most one of the
    two is set; both None means a plain taxable/HSA invested contribution.
    """

    kind: str  # income | expense | contrib_invested | contrib_debt
    amount_monthly: float
    annual_growth_pct: float = 0.0
    start_month: int = 0
    end_month: int | None = None
    td_member: int | None = None
    roth_member: int | None = None


@dataclass(frozen=True)
class OneTimeEvent:
    month: int
    amount: float  # positive = money in


@dataclass(frozen=True)
class PlanInputs:
    start_age: int  # the self member's age at plan start (output age axis)
    start_year: int
    horizon_months: int  # multiple of 12; runs to the latest life expectancy
    # Household spending transition month (last retirement), clamped to
    # [0, horizon_months]; == horizon_months when nobody retires in-plan.
    retirement_month: int

    members: tuple[MemberSpec, ...] = ()

    cash0: float = 0.0
    invested0: float = 0.0
    property0: float = 0.0
    debt0: float = 0.0

    # (stocks, bonds, cash) weights inside the invested bucket; sum to 1.
    invested_weights: tuple[float, float, float] = (0.6, 0.4, 0.0)
    # Fraction of invested held in TAX-DEFERRED accounts — the deemed
    # ordinary-income (taxable) share of a shortfall withdrawal. Drives the
    # coarse effective tax on withdrawals; kept fixed (v1 semantics) so
    # migrated v1 plans simulate identically. Since #25 this EXCLUDES Roth
    # balances (assembly routes them to the Roth sub-bucket), so the Roth
    # slice of a pro-rata withdrawal is correctly untaxed; RMDs model the
    # forced-distribution reality on top (tax-deferred bucket only).
    retirement_share: float = 0.0

    property_growth_pct: float = 0.0
    debt_growth_pct: float = 0.0

    flows: tuple[FlowSpec, ...] = ()
    one_time_events: tuple[OneTimeEvent, ...] = ()

    annual_retirement_spending: float = 0.0
    inflation_mean_pct: float = 2.5
    # Flat-rate tax override. A number selects the v1 flat-rate engine path
    # (preserved verbatim); None selects the bracket-aware model (T-012
    # phase 2). The dataclass default stays 18.0 so directly-constructed
    # inputs (tests, tooling) keep v1 semantics; assembly passes the
    # profile's stored value, which is null for fresh profiles.
    effective_tax_rate_pct: float | None = 18.0
    # Household filing status for bracket mode: "single" | "mfj". Derived by
    # assembly (coordinator ruling: mfj iff >= 2 members with role in
    # {self, partner}); ignored in flat mode.
    filing_status: str = "single"

    market: MarketParams = field(default_factory=MarketParams)

    @property
    def n_months(self) -> int:
        return self.horizon_months

    @property
    def n_years(self) -> int:
        return self.horizon_months // 12

    def to_dict(self) -> dict:
        return asdict(self)
