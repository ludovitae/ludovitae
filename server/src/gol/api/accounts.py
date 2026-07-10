"""Accounts CRUD + balance snapshot history."""

from __future__ import annotations

import datetime as dt

from fastapi import APIRouter, Response
from pydantic import BaseModel, Field

from gol.api.common import Db, get_or_404, iso, parse_date
from gol.auth.deps import Authenticated
from gol.errors import ApiError
from gol.models import ACCOUNT_TYPES, ASSET_CLASSES, Account, BalanceSnapshot

router = APIRouter(tags=["accounts"])


class AccountCreate(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    type: str
    institution: str | None = None
    balance: float = 0.0
    growth_rate_pct: float | None = None
    asset_class: str | None = None
    include_in_net_worth: bool = True
    notes: str = ""


class AccountPatch(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    type: str | None = None
    institution: str | None = None
    balance: float | None = None
    growth_rate_pct: float | None = None
    asset_class: str | None = None
    include_in_net_worth: bool | None = None
    notes: str | None = None


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


def _serialize(acc: Account) -> dict:
    return {
        "id": acc.id,
        "name": acc.name,
        "type": acc.type,
        "institution": acc.institution,
        "balance": acc.balance,
        "growth_rate_pct": acc.growth_rate_pct,
        "asset_class": acc.asset_class,
        "include_in_net_worth": acc.include_in_net_worth,
        "notes": acc.notes,
        "created_at": iso(acc.created_at),
    }


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
    return [_serialize(a) for a in db.query(Account).order_by(Account.id).all()]


@router.post("/accounts", status_code=201)
def create_account(body: AccountCreate, db: Db, _: Authenticated):
    _validate_enums(body.type, body.asset_class)
    acc = Account(
        name=body.name,
        type=body.type,
        institution=body.institution,
        growth_rate_pct=body.growth_rate_pct,
        asset_class=body.asset_class,
        include_in_net_worth=body.include_in_net_worth,
        notes=body.notes,
    )
    db.add(acc)
    db.flush()
    _set_balance(db, acc, body.balance)
    return _serialize(acc)


@router.get("/accounts/{account_id}")
def get_account(account_id: int, db: Db, _: Authenticated):
    return _serialize(get_or_404(db, Account, account_id, "account_not_found"))


@router.patch("/accounts/{account_id}")
def patch_account(account_id: int, body: AccountPatch, db: Db, _: Authenticated):
    acc = get_or_404(db, Account, account_id, "account_not_found")
    data = body.model_dump(exclude_unset=True)
    _validate_enums(data.get("type"), data.get("asset_class"))
    balance = data.pop("balance", None)
    for key, value in data.items():
        setattr(acc, key, value)
    if balance is not None:
        _set_balance(db, acc, balance)
    db.flush()
    return _serialize(acc)


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
