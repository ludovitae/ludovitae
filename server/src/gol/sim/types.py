"""Input dataclasses for the simulation engine (pure, ORM-free)."""

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
class FlowSpec:
    """A recurring monthly flow on the plan's month grid.

    ``start_month`` inclusive, ``end_month`` exclusive (None = plan end).
    ``stops_at_retirement``: clipped to the retirement month (income flows with
    ends_at_retirement, and all baseline expense flows — spending switches to
    the retirement budget at that point).
    """

    kind: str  # income | expense | contrib_invested | contrib_debt
    amount_monthly: float
    annual_growth_pct: float = 0.0
    start_month: int = 0
    end_month: int | None = None
    stops_at_retirement: bool = False


@dataclass(frozen=True)
class OneTimeEvent:
    month: int
    amount: float  # positive = money in


@dataclass(frozen=True)
class PlanInputs:
    start_age: int
    retirement_age: int
    life_expectancy: int
    start_year: int

    cash0: float = 0.0
    invested0: float = 0.0
    property0: float = 0.0
    debt0: float = 0.0

    # (stocks, bonds, cash) weights inside the invested bucket; sum to 1.
    invested_weights: tuple[float, float, float] = (0.6, 0.4, 0.0)
    # Fraction of invested held in retirement-type accounts (drives the coarse
    # effective tax applied to withdrawals).
    retirement_share: float = 0.0

    property_growth_pct: float = 0.0
    debt_growth_pct: float = 0.0

    flows: tuple[FlowSpec, ...] = ()
    one_time_events: tuple[OneTimeEvent, ...] = ()

    annual_retirement_spending: float = 0.0
    social_security_monthly: float = 0.0
    ss_start_age: int = 67
    inflation_mean_pct: float = 2.5
    effective_tax_rate_pct: float = 18.0

    market: MarketParams = field(default_factory=MarketParams)

    @property
    def n_years(self) -> int:
        return self.life_expectancy - self.start_age + 1

    @property
    def n_months(self) -> int:
        return self.n_years * 12

    @property
    def retirement_month(self) -> int:
        return max(0, min((self.retirement_age - self.start_age) * 12, self.n_months))

    def to_dict(self) -> dict:
        return asdict(self)
