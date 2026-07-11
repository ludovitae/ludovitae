"""Spending profile (v1.1): GET/PUT /spending (full replace) and
GET /spending/observed (trailing-N-month outflow averages from transactions).
"""

from __future__ import annotations

import datetime as dt

from fastapi import APIRouter, Query
from pydantic import BaseModel, Field
from sqlalchemy import select

from gol.api.common import Db
from gol.assembly import get_or_create_profile
from gol.auth.deps import Authenticated
from gol.errors import ApiError
from gol.models import SPENDING_KINDS, SpendingCategory, Transaction

router = APIRouter(tags=["spending"])

# v1.2: transfer-PAIRED transactions (transfer_pair_id set) are excluded from
# all spending analytics, this endpoint included. The v1.1 category=="transfer"
# heuristic below remains as a FALLBACK for one-sided transfers whose
# counterpart account was never imported (T-007 log, 2026-07-11).
TRANSFER_CATEGORY = "transfer"


class CategoryBody(BaseModel):
    id: int | None = None  # keep an existing category's id on full replace
    name: str = Field(min_length=1, max_length=200)
    monthly_amount: float = Field(ge=0)
    kind: str
    annual_growth_pct: float | None = Field(default=None, ge=-50, le=50)


class SpendingBody(BaseModel):
    categories: list[CategoryBody]
    monthly_savings_target: float = Field(ge=0)


def _serialize(db) -> dict:
    profile = get_or_create_profile(db)
    cats = db.execute(
        select(SpendingCategory).order_by(SpendingCategory.id)
    ).scalars().all()
    return {
        "categories": [
            {"id": c.id, "name": c.name, "monthly_amount": c.monthly_amount,
             "kind": c.kind, "annual_growth_pct": c.annual_growth_pct}
            for c in cats
        ],
        "monthly_savings_target": profile.monthly_savings_target,
    }


@router.get("/spending")
def get_spending(db: Db, _: Authenticated):
    return _serialize(db)


@router.put("/spending")
def put_spending(body: SpendingBody, db: Db, _: Authenticated):
    for cat in body.categories:
        if cat.kind not in SPENDING_KINDS:
            raise ApiError(
                422, "validation_error",
                f"kind must be one of {', '.join(SPENDING_KINDS)}",
            )
    existing = {
        c.id: c
        for c in db.execute(select(SpendingCategory)).scalars()
    }
    keep: set[int] = set()
    for cat in body.categories:
        if cat.id is not None and cat.id not in existing:
            raise ApiError(
                404, "category_not_found",
                f"spending category {cat.id} not found (omit id to create)",
            )
        row = existing.get(cat.id) if cat.id is not None else None
        if row is not None:
            row.name = cat.name
            row.monthly_amount = cat.monthly_amount
            row.kind = cat.kind
            row.annual_growth_pct = cat.annual_growth_pct
            keep.add(row.id)
        else:
            row = SpendingCategory(
                name=cat.name, monthly_amount=cat.monthly_amount,
                kind=cat.kind, annual_growth_pct=cat.annual_growth_pct,
            )
            db.add(row)
            db.flush()
            keep.add(row.id)
    for cat_id, row in existing.items():
        if cat_id not in keep:
            db.delete(row)
    profile = get_or_create_profile(db)
    profile.monthly_savings_target = body.monthly_savings_target
    db.flush()
    return _serialize(db)


def _month_start(date: dt.date) -> dt.date:
    return date.replace(day=1)


def _shift_months(date: dt.date, months: int) -> dt.date:
    total = date.year * 12 + (date.month - 1) + months
    return dt.date(total // 12, total % 12 + 1, 1)


@router.get("/spending/observed")
def observed_spending(
    db: Db,
    _: Authenticated,
    months: int = Query(default=12, ge=1, le=60),
):
    """Trailing-N-full-month averages of outflows (negative-amount
    transactions), grouped by category. Transfer pairs are excluded (v1.2),
    plus the category=="transfer" fallback (case-insensitive); empty data
    yields zeros."""
    to = _month_start(dt.date.today())
    from_ = _shift_months(to, -months)
    rows = db.execute(
        select(Transaction.category, Transaction.amount)
        .where(Transaction.date >= from_)
        .where(Transaction.date < to)
        .where(Transaction.amount < 0)
        .where(Transaction.transfer_pair_id.is_(None))
    ).all()

    totals: dict[str, float] = {}
    counts: dict[str, int] = {}
    for category, amount in rows:
        key = (category or "").strip().lower() or "uncategorized"
        if key == TRANSFER_CATEGORY:
            continue
        totals[key] = totals.get(key, 0.0) - amount  # outflows -> positive
        counts[key] = counts.get(key, 0) + 1

    by_category = [
        {"category": key, "monthly_avg": round(totals[key] / months, 2),
         "txn_count": counts[key]}
        for key in totals
    ]
    by_category.sort(key=lambda c: (-c["monthly_avg"], c["category"]))
    return {
        "months": months,
        "from": from_.isoformat(),
        "to": to.isoformat(),
        "total_monthly_avg": round(sum(totals.values()) / months, 2),
        "by_category": by_category,
    }
