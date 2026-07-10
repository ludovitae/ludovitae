"""GET /dashboard — net worth aggregate, history, per-type breakdown."""

from __future__ import annotations

import datetime as dt

from fastapi import APIRouter
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from gol.api.common import Db, iso
from gol.auth.deps import Authenticated
from gol.models import LIABILITY_TYPES, Account, Flow, Goal

router = APIRouter(tags=["dashboard"])


def _net_worth_history(accounts: list[Account]) -> list[dict]:
    dates: set[dt.date] = set()
    for acc in accounts:
        dates.update(b.date for b in acc.balances)
    history = []
    for date in sorted(dates):
        total = 0.0
        for acc in accounts:
            past = [b for b in acc.balances if b.date <= date]
            if not past:
                continue
            amount = max(past, key=lambda b: b.date).amount
            total += -amount if acc.type in LIABILITY_TYPES else amount
        history.append({"date": iso(date), "net_worth": round(total, 2)})
    return history


@router.get("/dashboard")
def dashboard(db: Db, _: Authenticated):
    accounts = [
        a
        for a in db.execute(
            select(Account).options(selectinload(Account.balances))
        ).scalars()
        if a.include_in_net_worth
    ]
    assets = liabilities = 0.0
    by_type: dict[str, float] = {}
    for acc in accounts:
        bal = acc.balance
        by_type[acc.type] = round(by_type.get(acc.type, 0.0) + bal, 2)
        if acc.type in LIABILITY_TYPES:
            liabilities += bal
        else:
            assets += bal

    today = dt.date.today()
    surplus = 0.0
    for flow in db.execute(select(Flow)).scalars():
        if flow.start_date and flow.start_date > today:
            continue
        if flow.end_date and flow.end_date < today:
            continue
        if flow.kind == "income":
            surplus += flow.amount_monthly
        elif flow.kind == "expense":
            surplus -= flow.amount_monthly

    goals = db.execute(select(Goal).order_by(Goal.priority, Goal.id)).scalars().all()
    goals_summary = [
        {
            "id": g.id,
            "name": g.name,
            "emoji": g.emoji,
            "target_amount": g.target_amount,
            "funded_amount": g.funded_amount,
            "target_date": iso(g.target_date),
            "priority": g.priority,
            "pct_funded": round(100.0 * g.funded_amount / g.target_amount, 1)
            if g.target_amount
            else 0.0,
        }
        for g in goals
    ]

    return {
        "net_worth": round(assets - liabilities, 2),
        "assets": round(assets, 2),
        "liabilities": round(liabilities, 2),
        "history": _net_worth_history(accounts),
        "by_type": by_type,
        "goals_summary": goals_summary,
        "monthly_surplus": round(surplus, 2),
    }
