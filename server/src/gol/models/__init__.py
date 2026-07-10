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


def utcnow() -> dt.datetime:
    return dt.datetime.now(dt.UTC).replace(tzinfo=None)


class Profile(Base):
    __tablename__ = "profile"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    birth_year: Mapped[int] = mapped_column(Integer, default=1980)
    retirement_age: Mapped[int] = mapped_column(Integer, default=65)
    life_expectancy: Mapped[int] = mapped_column(Integer, default=92)
    annual_retirement_spending: Mapped[float] = mapped_column(Money, default=80000.0)
    social_security_monthly: Mapped[float] = mapped_column(Money, default=0.0)
    social_security_start_age: Mapped[int] = mapped_column(Integer, default=67)
    inflation_pct: Mapped[float] = mapped_column(Float, default=2.5)
    effective_tax_rate_pct: Mapped[float] = mapped_column(Float, default=18.0)


class Account(Base):
    __tablename__ = "accounts"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(200))
    type: Mapped[str] = mapped_column(String(32))
    institution: Mapped[str | None] = mapped_column(String(200), nullable=True)
    growth_rate_pct: Mapped[float | None] = mapped_column(Float, nullable=True)
    asset_class: Mapped[str | None] = mapped_column(String(16), nullable=True)
    include_in_net_worth: Mapped[bool] = mapped_column(Boolean, default=True)
    notes: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[dt.date] = mapped_column(Date, default=dt.date.today)

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
