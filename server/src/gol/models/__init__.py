"""SQLAlchemy models for the Game of Life domain."""

from __future__ import annotations

import datetime as dt

from sqlalchemy import (
    JSON,
    Boolean,
    Date,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from gol.db import Base, Money

ACCOUNT_TYPES = (
    "checking",
    "savings",
    "brokerage",
    "retirement",
    "hsa",
    "property",
    "vehicle",
    "other_asset",
    "mortgage",
    "loan",
    "credit_card",
    "other_liability",
)
LIABILITY_TYPES = ("mortgage", "loan", "credit_card", "other_liability")
INVESTABLE_TYPES = ("brokerage", "retirement", "hsa")
CASH_TYPES = ("checking", "savings")
PROPERTY_TYPES = ("property", "vehicle", "other_asset")
ASSET_CLASSES = ("stocks", "bonds", "cash", "mixed")
FLOW_KINDS = ("income", "expense", "contribution")
MEMBER_ROLES = ("self", "partner", "child", "other")
# Only adult members drive the sim horizon and timing schedules
# (coordinator ruling 2026-07-11; docs/API.md household section).
ADULT_ROLES = ("self", "partner", "other")
SPENDING_KINDS = ("essential", "discretionary")
# v1.2 import freshness: transactional/investment types default to tracked;
# property/vehicle/loan-ish types default to off (docs/API.md freshness).
TRACK_FRESHNESS_TYPES = ("checking", "savings", "credit_card", "brokerage", "retirement", "hsa")
CATEGORY_SOURCES = ("manual", "rule", "heuristic", "ai", "none")
# v1.2.2 (#26, coordinator ruling): transactions imported into investment-type
# accounts get this category and are excluded from all spending analytics —
# a dividend reinvestment is not spending (same family as transfer pairs).
INVESTMENT_ACTIVITY_CATEGORY = "investment-activity"
RULE_MATCHES = ("contains", "exact")
RULE_FIELDS = ("payee",)


def utcnow() -> dt.datetime:
    return dt.datetime.now(dt.UTC).replace(tzinfo=None)


class Profile(Base):
    """Household-level assumptions only (v1.1) — person-level fields live on
    HouseholdMember. monthly_savings_target is the spending profile's
    informational target (docs/API.md /spending)."""

    __tablename__ = "profile"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    annual_retirement_spending: Mapped[float] = mapped_column(Money, default=80000.0)
    inflation_pct: Mapped[float] = mapped_column(Float, default=2.5)
    # Nullable flat-rate tax override (T-012 phase 2): a value runs the flat
    # v1 engine path; NULL runs the bracket-aware model. Fresh profiles
    # default to NULL (brackets); migration 0005 keeps existing values so
    # upgraded databases simulate identically until the owner clears it.
    effective_tax_rate_pct: Mapped[float | None] = mapped_column(
        Float, nullable=True, default=None
    )
    monthly_savings_target: Mapped[float] = mapped_column(Money, default=0.0)


class HouseholdMember(Base):
    """A person in the household (v1.1). Exactly one `self` row exists; it is
    created by migration/first access and cannot be deleted."""

    __tablename__ = "household_members"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(200))
    role: Mapped[str] = mapped_column(String(16))
    birth_year: Mapped[int] = mapped_column(Integer)
    life_expectancy: Mapped[int] = mapped_column(Integer, default=92)
    retirement_age: Mapped[int | None] = mapped_column(Integer, nullable=True)
    ss_monthly_at_fra: Mapped[float | None] = mapped_column(Money, nullable=True)
    ss_claim_age: Mapped[int | None] = mapped_column(Integer, nullable=True)
    notes: Mapped[str] = mapped_column(Text, default="")


class SpendingCategory(Base):
    """Planned spending stream (v1.1); coexists with expense flows (both count
    in the sim — see docs/API.md double-count rule)."""

    __tablename__ = "spending_categories"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(200))
    monthly_amount: Mapped[float] = mapped_column(Money, default=0.0)
    kind: Mapped[str] = mapped_column(String(16), default="essential")
    annual_growth_pct: Mapped[float | None] = mapped_column(Float, nullable=True)


class Account(Base):
    __tablename__ = "accounts"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(200))
    type: Mapped[str] = mapped_column(String(32))
    institution: Mapped[str | None] = mapped_column(String(200), nullable=True)
    growth_rate_pct: Mapped[float | None] = mapped_column(Float, nullable=True)
    asset_class: Mapped[str | None] = mapped_column(String(16), nullable=True)
    member_id: Mapped[int | None] = mapped_column(
        ForeignKey("household_members.id", ondelete="SET NULL"), nullable=True
    )
    include_in_net_worth: Mapped[bool] = mapped_column(Boolean, default=True)
    notes: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[dt.date] = mapped_column(Date, default=dt.date.today)
    # v1.2 import freshness (docs/API.md): last_import_at is set on every
    # import commit; staleness_days is a per-account threshold override
    # (null -> default 35); track_freshness defaults by account type.
    last_import_at: Mapped[dt.datetime | None] = mapped_column(DateTime, nullable=True)
    staleness_days: Mapped[int | None] = mapped_column(Integer, nullable=True)
    track_freshness: Mapped[bool] = mapped_column(Boolean, default=False)
    # v1.2.2 (#26): hashed external-account link — sha256 of the provider's
    # raw account id (OFX ACCTID / CSV account-number cell), never the raw id.
    # Upserted on import commit, last-write-wins; not exposed on the API.
    external_account_id: Mapped[str | None] = mapped_column(
        String(64), nullable=True, index=True
    )
    # v1.2.2 (#30, coordinator ruling): display form of the external link —
    # "···" + last 4 of the raw id, captured AT LINK TIME alongside the hash
    # (the hash is one-way, so this cannot be backfilled). Null on accounts
    # linked before migration 0008; the serializer covers that case.
    external_account_masked: Mapped[str | None] = mapped_column(
        String(16), nullable=True
    )

    balances: Mapped[list[BalanceSnapshot]] = relationship(
        back_populates="account", cascade="all, delete-orphan", order_by="BalanceSnapshot.date"
    )

    @property
    def balance(self) -> float:
        if not self.balances:
            return 0.0
        return max(self.balances, key=lambda b: b.date).amount


class BalanceSnapshot(Base):
    __tablename__ = "balance_snapshots"
    __table_args__ = (UniqueConstraint("account_id", "date", name="uq_balance_account_date"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    account_id: Mapped[int] = mapped_column(
        ForeignKey("accounts.id", ondelete="CASCADE"), index=True
    )
    date: Mapped[dt.date] = mapped_column(Date)
    amount: Mapped[float] = mapped_column(Money)

    account: Mapped[Account] = relationship(back_populates="balances")


class Flow(Base):
    __tablename__ = "flows"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(200))
    kind: Mapped[str] = mapped_column(String(16))
    amount_monthly: Mapped[float] = mapped_column(Money)
    annual_growth_pct: Mapped[float] = mapped_column(Float, default=0.0)
    start_date: Mapped[dt.date | None] = mapped_column(Date, nullable=True)
    end_date: Mapped[dt.date | None] = mapped_column(Date, nullable=True)
    account_id: Mapped[int | None] = mapped_column(
        ForeignKey("accounts.id", ondelete="SET NULL"), nullable=True
    )
    category: Mapped[str | None] = mapped_column(String(100), nullable=True)
    member_id: Mapped[int | None] = mapped_column(
        ForeignKey("household_members.id", ondelete="SET NULL"), nullable=True
    )
    ends_at_retirement: Mapped[bool] = mapped_column(Boolean, default=False)


class Goal(Base):
    __tablename__ = "goals"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(200))
    emoji: Mapped[str | None] = mapped_column(String(16), nullable=True)
    target_amount: Mapped[float] = mapped_column(Money)
    target_date: Mapped[dt.date | None] = mapped_column(Date, nullable=True)
    priority: Mapped[int] = mapped_column(Integer, default=3)
    funded_amount: Mapped[float] = mapped_column(Money, default=0.0)
    notes: Mapped[str] = mapped_column(Text, default="")


class Transaction(Base):
    __tablename__ = "transactions"
    __table_args__ = (UniqueConstraint("account_id", "dedupe_hash", name="uq_txn_dedupe"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    account_id: Mapped[int] = mapped_column(
        ForeignKey("accounts.id", ondelete="CASCADE"), index=True
    )
    date: Mapped[dt.date] = mapped_column(Date, index=True)
    amount: Mapped[float] = mapped_column(Money)
    payee: Mapped[str] = mapped_column(String(300), default="")
    category: Mapped[str | None] = mapped_column(String(100), nullable=True)
    dedupe_hash: Mapped[str] = mapped_column(String(64))
    # v1.2: both legs of a paired transfer share one id (the smaller of the
    # two transaction ids — deterministic and stable across re-imports).
    transfer_pair_id: Mapped[int | None] = mapped_column(Integer, nullable=True, index=True)
    category_source: Mapped[str] = mapped_column(String(16), default="none")


class CategoryRule(Base):
    """User categorization rule (v1.2). Applied on import and via
    POST /rules/apply — priority asc, first match wins; never overwrites a
    manual (or ai) category."""

    __tablename__ = "category_rules"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    pattern: Mapped[str] = mapped_column(String(300))
    match: Mapped[str] = mapped_column(String(16), default="contains")
    field: Mapped[str] = mapped_column(String(16), default="payee")
    category: Mapped[str] = mapped_column(String(100))
    priority: Mapped[int] = mapped_column(Integer, default=100)


class AiSettings(Base):
    """Singleton row for the AI admin panel (v1.2). The API key lives only in
    this local, chmod-0600 database; it is NEVER logged and NEVER returned by
    the API (masked last4 only)."""

    __tablename__ = "ai_settings"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    api_key: Mapped[str | None] = mapped_column(String(300), nullable=True)
    enabled: Mapped[bool] = mapped_column(Boolean, default=False)
    monthly_budget_usd: Mapped[float] = mapped_column(Float, default=5.0)


class AiUsage(Base):
    """Ledger of AI spend (v1.2) — one row per (future) API call. Costs are
    floats, not Money: token costs are fractions of a cent."""

    __tablename__ = "ai_usage"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    created_at: Mapped[dt.datetime] = mapped_column(DateTime, default=utcnow)
    month: Mapped[str] = mapped_column(String(7), index=True)  # "YYYY-MM"
    purpose: Mapped[str] = mapped_column(String(50))
    input_tokens: Mapped[int] = mapped_column(Integer, default=0)
    output_tokens: Mapped[int] = mapped_column(Integer, default=0)
    est_cost_usd: Mapped[float] = mapped_column(Float, default=0.0)


class TransferPairTombstone(Base):
    """A user-unpaired transaction pair (coordinator ruling 2026-07-11):
    auto-pairing must never re-link these two transactions. Manual
    POST /transfers/pair on the same two ids clears the tombstone.
    Always stored with txn_id_a < txn_id_b."""

    __tablename__ = "transfer_pair_tombstones"
    __table_args__ = (UniqueConstraint("txn_id_a", "txn_id_b", name="uq_tombstone_pair"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    txn_id_a: Mapped[int] = mapped_column(
        ForeignKey("transactions.id", ondelete="CASCADE"), index=True
    )
    txn_id_b: Mapped[int] = mapped_column(
        ForeignKey("transactions.id", ondelete="CASCADE"), index=True
    )


class ImportPreset(Base):
    """Saved CSV column mapping per institution (v1.2.2, T-009). Keyed by the
    header fingerprint — sha256 of the lowercased, sorted, comma-joined CSV
    header list — so re-uploading the same institution's export auto-applies
    the mapping (and flip_signs) without re-mapping columns."""

    __tablename__ = "import_presets"
    __table_args__ = (
        UniqueConstraint("header_fingerprint", name="uq_import_preset_fingerprint"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(200))
    header_fingerprint: Mapped[str] = mapped_column(String(64))
    mapping: Mapped[dict] = mapped_column(JSON)
    flip_signs: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[dt.datetime] = mapped_column(DateTime, default=utcnow)
    # v1.2.2 (#26): the wizard's picker default — last single-target account
    # this preset committed into. Loose reference (no FK: SQLite add_column
    # cannot carry one); serialization null-checks existence instead.
    last_account_id: Mapped[int | None] = mapped_column(Integer, nullable=True)


class Scenario(Base):
    __tablename__ = "scenarios"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(200))
    description: Mapped[str] = mapped_column(Text, default="")
    is_baseline: Mapped[bool] = mapped_column(Boolean, default=False)
    params: Mapped[dict] = mapped_column(JSON, default=dict)


class SimulationRun(Base):
    __tablename__ = "simulation_runs"
    __table_args__ = (UniqueConstraint("cache_key", name="uq_simrun_cache_key"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    cache_key: Mapped[str] = mapped_column(String(64))
    engine_version: Mapped[str] = mapped_column(String(8))
    seed: Mapped[int] = mapped_column(Integer)
    n_paths: Mapped[int] = mapped_column(Integer)
    result: Mapped[dict] = mapped_column(JSON)
    created_at: Mapped[dt.datetime] = mapped_column(DateTime, default=utcnow)


class PlanSnapshot(Base):
    """A frozen, named plan capture (v1.3, #21). Stores the FULL /simulate
    response it produced plus a summary of the inputs it consumed, at a moment
    in time. NEVER mutated after creation — engine upgrades do not touch old
    snapshots (that is the whole point). At most one row has is_benchmark=True
    (the active comparison line); the PATCH handler enforces zero-or-one."""

    __tablename__ = "plan_snapshots"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(200))
    created_at: Mapped[dt.datetime] = mapped_column(DateTime, default=utcnow)
    # engine_version copied from the captured response for cheap list metadata
    # and to make "captured under a now-superseded engine" visible.
    engine_version: Mapped[str] = mapped_column(String(8))
    # Loose reference (no FK): the scenario may be deleted; informational only.
    scenario_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    is_benchmark: Mapped[bool] = mapped_column(Boolean, default=False)
    # Denormalized summary fields (also inside inputs_summary) — used by the
    # list view and the tracking plan-line for spending/saving without
    # unpacking the JSON blobs.
    captured_net_worth: Mapped[float] = mapped_column(Money, default=0.0)
    monthly_spending: Mapped[float] = mapped_column(Money, default=0.0)
    monthly_saving: Mapped[float] = mapped_column(Money, default=0.0)
    # The frozen /simulate response and the inputs summary it consumed.
    response: Mapped[dict] = mapped_column(JSON)
    inputs_summary: Mapped[dict] = mapped_column(JSON)


class AuthCredential(Base):
    """Single-row table holding the argon2id password hash. Never plaintext."""

    __tablename__ = "auth_credential"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    password_hash: Mapped[str] = mapped_column(String(300))
    created_at: Mapped[dt.datetime] = mapped_column(DateTime, default=utcnow)


class AuthSession(Base):
    """Server-side session; the cookie holds the raw token, we store its hash."""

    __tablename__ = "auth_sessions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    csrf_token: Mapped[str] = mapped_column(String(64))
    created_at: Mapped[dt.datetime] = mapped_column(DateTime, default=utcnow)
    last_seen_at: Mapped[dt.datetime] = mapped_column(DateTime, default=utcnow)


class Setting(Base):
    __tablename__ = "settings"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    theme: Mapped[str] = mapped_column(String(16), default="fintech")
    reduce_motion: Mapped[bool] = mapped_column(Boolean, default=False)
