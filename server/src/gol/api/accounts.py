"""Accounts CRUD + balance snapshot history + import freshness (v1.2)."""

from __future__ import annotations

import datetime as dt

from fastapi import APIRouter, Response
from pydantic import BaseModel, Field
from sqlalchemy import func, select

from gol.analytics.freshness import compute_freshness
from gol.api.common import Db, get_or_404, iso, parse_date
from gol.auth.deps import Authenticated
from gol.errors import ApiError
from gol.models import (
    ACCOUNT_TYPES,
    ASSET_CLASSES,
    TRACK_FRESHNESS_TYPES,
    Account,
    BalanceSnapshot,
    HouseholdMember,
    Transaction,
)

router = APIRouter(tags=["accounts"])


class AccountCreate(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    type: str
    institution: str | None = None
    balance: float = 0.0
    growth_rate_pct: float | None = None
    asset_class: str | None = None
    member_id: int | None = None
    include_in_net_worth: bool = True
    notes: str = ""
    # v1.2 freshness: track_freshness omitted -> default by account type
    track_freshness: bool | None = None
    staleness_days: int | None = Field(default=None, ge=1, le=3650)


class AccountPatch(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    type: str | None = None
    institution: str | None = None
    balance: float | None = None
    growth_rate_pct: float | None = None
    asset_class: str | None = None
    member_id: int | None = None
    include_in_net_worth: bool | None = None
    notes: str | None = None
    track_freshness: bool | None = None
    staleness_days: int | None = Field(default=None, ge=1, le=3650)


class BalanceBody(BaseModel):
    date: str
    amount: float


def _validate_enums(type_: str | None, asset_class: str | None) -> None:
    if type_ is not None and type_ not in ACCOUNT_TYPES:
        raise ApiError(422, "validation_error", f"type must be one of {', '.join(ACCOUNT_TYPES)}")
    if asset_class is not None and asset_class not in ASSET_CLASSES:
        raise ApiError(
            422, "validation_error", f"asset_class must be one of {', '.join(ASSET_CLASSES)}"
        )


def _validate_member(db, member_id: int | None) -> None:
    if member_id is not None:
        get_or_404(db, HouseholdMember, member_id, "member_not_found")


def newest_txn_dates(db, account_ids: list[int] | None = None) -> dict[int, dt.date]:
    """account_id -> newest transaction date (freshness input), one query."""
    query = select(Transaction.account_id, func.max(Transaction.date)).group_by(
        Transaction.account_id
    )
    if account_ids is not None:
        query = query.where(Transaction.account_id.in_(account_ids))
    return dict(db.execute(query).all())


def account_freshness(acc: Account, newest_txn: dt.date | None) -> tuple[str, int | None]:
    return compute_freshness(
        acc.track_freshness, acc.last_import_at, newest_txn,
        acc.staleness_days, dt.date.today(),
    )


def _serialize(acc: Account, newest_txn: dt.date | None) -> dict:
    freshness, _days = account_freshness(acc, newest_txn)
    return {
        "id": acc.id,
        "name": acc.name,
        "type": acc.type,
        "institution": acc.institution,
        "balance": acc.balance,
        "growth_rate_pct": acc.growth_rate_pct,
        "asset_class": acc.asset_class,
        "member_id": acc.member_id,
        "include_in_net_worth": acc.include_in_net_worth,
        "notes": acc.notes,
        "created_at": iso(acc.created_at),
        "last_import_at": acc.last_import_at.isoformat() if acc.last_import_at else None,
        "newest_transaction_date": iso(newest_txn),
        "staleness_days": acc.staleness_days,
        "track_freshness": acc.track_freshness,
        "freshness": freshness,
    }


def _serialize_one(db, acc: Account) -> dict:
    return _serialize(acc, newest_txn_dates(db, [acc.id]).get(acc.id))


def _set_balance(db, acc: Account, amount: float, date: dt.date | None = None) -> None:
    """Writing `balance` creates (or updates) a snapshot dated today."""
    date = date or dt.date.today()
    existing = next((b for b in acc.balances if b.date == date), None)
    if existing is not None:
        existing.amount = amount
    else:
        db.add(BalanceSnapshot(account_id=acc.id, date=date, amount=amount))
    db.flush()
    db.refresh(acc)


@router.get("/accounts")
def list_accounts(db: Db, _: Authenticated):
    accounts = db.query(Account).order_by(Account.id).all()
    newest = newest_txn_dates(db)
    return [_serialize(a, newest.get(a.id)) for a in accounts]


@router.post("/accounts", status_code=201)
def create_account(body: AccountCreate, db: Db, _: Authenticated):
    _validate_enums(body.type, body.asset_class)
    _validate_member(db, body.member_id)
    track = body.track_freshness
    if track is None:
        track = body.type in TRACK_FRESHNESS_TYPES
    acc = Account(
        name=body.name,
        type=body.type,
        institution=body.institution,
        growth_rate_pct=body.growth_rate_pct,
        asset_class=body.asset_class,
        member_id=body.member_id,
        include_in_net_worth=body.include_in_net_worth,
        notes=body.notes,
        track_freshness=track,
        staleness_days=body.staleness_days,
    )
    db.add(acc)
    db.flush()
    _set_balance(db, acc, body.balance)
    return _serialize_one(db, acc)


@router.get("/accounts/{account_id}")
def get_account(account_id: int, db: Db, _: Authenticated):
    return _serialize_one(db, get_or_404(db, Account, account_id, "account_not_found"))


@router.patch("/accounts/{account_id}")
def patch_account(account_id: int, body: AccountPatch, db: Db, _: Authenticated):
    acc = get_or_404(db, Account, account_id, "account_not_found")
    data = body.model_dump(exclude_unset=True)
    _validate_enums(data.get("type"), data.get("asset_class"))
    _validate_member(db, data.get("member_id"))
    if data.get("track_freshness", False) is None:
        raise ApiError(422, "validation_error", "track_freshness must be true or false")
    # changing type does NOT flip an explicit track_freshness choice; the
    # type-based value is only a default at creation time
    balance = data.pop("balance", None)
    for key, value in data.items():
        setattr(acc, key, value)
    if balance is not None:
        _set_balance(db, acc, balance)
    db.flush()
    return _serialize_one(db, acc)


@router.delete("/accounts/{account_id}", status_code=204)
def delete_account(account_id: int, db: Db, _: Authenticated):
    acc = get_or_404(db, Account, account_id, "account_not_found")
    db.delete(acc)
    db.flush()
    return Response(status_code=204)


@router.get("/accounts/{account_id}/balances")
def list_balances(account_id: int, db: Db, _: Authenticated):
    acc = get_or_404(db, Account, account_id, "account_not_found")
    return [
        {"date": iso(b.date), "amount": b.amount}
        for b in sorted(acc.balances, key=lambda b: b.date)
    ]


@router.post("/accounts/{account_id}/balances", status_code=201)
def add_balance(account_id: int, body: BalanceBody, db: Db, _: Authenticated):
    acc = get_or_404(db, Account, account_id, "account_not_found")
    date = parse_date(body.date)
    _set_balance(db, acc, body.amount, date)
    return {"date": date.isoformat(), "amount": body.amount}


@router.delete("/accounts/{account_id}/balances/{date}", status_code=204)
def delete_balance(account_id: int, date: str, db: Db, _: Authenticated):
    acc = get_or_404(db, Account, account_id, "account_not_found")
    parsed = parse_date(date)
    snapshot = next((b for b in acc.balances if b.date == parsed), None)
    if snapshot is None:
        raise ApiError(404, "balance_not_found", f"no snapshot on {date}")
    db.delete(snapshot)
    db.flush()
    return Response(status_code=204)
