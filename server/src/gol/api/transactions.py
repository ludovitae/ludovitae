"""GET /transactions (+v1.2 uncategorized filter) and bulk manual
categorization (POST /transactions/categorize)."""

from __future__ import annotations

from fastapi import APIRouter, Query
from pydantic import BaseModel, Field
from sqlalchemy import select

from gol.api.common import Db, iso, parse_date
from gol.auth.deps import Authenticated
from gol.errors import ApiError
from gol.models import Transaction

router = APIRouter(tags=["transactions"])


def serialize_txn(t: Transaction) -> dict:
    return {
        "id": t.id,
        "account_id": t.account_id,
        "date": iso(t.date),
        "amount": t.amount,
        "payee": t.payee,
        "category": t.category,
        "transfer_pair_id": t.transfer_pair_id,
        "category_source": t.category_source,
    }


@router.get("/transactions")
def list_transactions(
    db: Db,
    _: Authenticated,
    account_id: int | None = None,
    from_: str | None = Query(default=None, alias="from"),
    to: str | None = None,
    uncategorized: int = Query(default=0, ge=0, le=1),
    limit: int = Query(default=500, ge=1, le=10000),
):
    query = select(Transaction).order_by(Transaction.date.desc(), Transaction.id.desc())
    if account_id is not None:
        query = query.where(Transaction.account_id == account_id)
    if from_ is not None:
        query = query.where(Transaction.date >= parse_date(from_, "from"))
    if to is not None:
        query = query.where(Transaction.date <= parse_date(to, "to"))
    if uncategorized:
        query = query.where(Transaction.category.is_(None))
    rows = db.execute(query.limit(limit)).scalars().all()
    return [serialize_txn(t) for t in rows]


class BulkCategorizeBody(BaseModel):
    ids: list[int] = Field(min_length=1)
    category: str = Field(min_length=1, max_length=100)


@router.post("/transactions/categorize")
def bulk_categorize(body: BulkCategorizeBody, db: Db, _: Authenticated):
    """Manual bulk categorization: sets category_source='manual' (never
    overwritten by rules/heuristics afterwards)."""
    ids = set(body.ids)
    rows = db.execute(select(Transaction).where(Transaction.id.in_(ids))).scalars().all()
    if len(rows) != len(ids):
        missing = ids - {t.id for t in rows}
        raise ApiError(404, "transaction_not_found", f"unknown transaction ids: {sorted(missing)}")
    for txn in rows:
        txn.category = body.category
        txn.category_source = "manual"
    db.flush()
    return {"updated": len(rows)}
