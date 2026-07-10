"""GET /transactions with filters (rows come from import)."""

from __future__ import annotations

from fastapi import APIRouter, Query
from sqlalchemy import select

from gol.api.common import Db, iso, parse_date
from gol.auth.deps import Authenticated
from gol.models import Transaction

router = APIRouter(tags=["transactions"])


@router.get("/transactions")
def list_transactions(
    db: Db,
    _: Authenticated,
    account_id: int | None = None,
    from_: str | None = Query(default=None, alias="from"),
    to: str | None = None,
    limit: int = Query(default=500, ge=1, le=10000),
):
    query = select(Transaction).order_by(Transaction.date.desc(), Transaction.id.desc())
    if account_id is not None:
        query = query.where(Transaction.account_id == account_id)
    if from_ is not None:
        query = query.where(Transaction.date >= parse_date(from_, "from"))
    if to is not None:
        query = query.where(Transaction.date <= parse_date(to, "to"))
    rows = db.execute(query.limit(limit)).scalars().all()
    return [
        {
            "id": t.id,
            "account_id": t.account_id,
            "date": iso(t.date),
            "amount": t.amount,
            "payee": t.payee,
            "category": t.category,
        }
        for t in rows
    ]
