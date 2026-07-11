"""Spending analytics (v1.2): /spending/summary, /spending/recurring,
/spending/hotspots, /spending/forecast.

All endpoints look at outflows only and exclude transfers two ways:
transfer-paired rows (transfer_pair_id set — the v1.2 mechanism) and the
v1.1 category=="transfer" heuristic, kept as a fallback for one-sided
transfers whose counterpart was never imported.

Where docs/API.md leaves shapes loose ("[...]"), the exact serialization is
pinned here and in the T-007 task log so T-008 (web) can match:
- hotspots.price_increases / possibly_forgotten entries use the same shape
  as /spending/recurring items.
- forecast.recurring and forecast.total are arrays parallel to months;
  forecast.variable_by_category is [{category, monthly_avg}] (a constant
  trailing-average contribution per month).
"""

from __future__ import annotations

import datetime as dt

from fastapi import APIRouter, Query
from sqlalchemy import select

from gol.analytics.recurring import (
    Occurrence,
    RecurringCharge,
    detect_recurring,
    normalize_payee,
)
from gol.api.common import Db, iso, parse_date
from gol.auth.deps import Authenticated
from gol.errors import ApiError
from gol.models import INVESTMENT_ACTIVITY_CATEGORY, Transaction

router = APIRouter(tags=["spending-analytics"])

TRANSFER_CATEGORY = "transfer"  # v1.1 fallback exclusion (see module docstring)
# #26: investment-activity rows (auto-set for investment-type accounts) are
# not spending — excluded alongside the transfer fallback.
_EXCLUDED_CATEGORIES = (TRANSFER_CATEGORY, INVESTMENT_ACTIVITY_CATEGORY)

# Tunables where the contract gives qualitative guidance; documented in the
# task log for the coordinator/QA:
SPIKE_MIN_DELTA_PCT = 20.0  # category_spikes: recent >= baseline * 1.2
SPIKE_MIN_BASELINE = 20.0  # ...and baseline >= $20/mo (noise floor)
PRICE_INCREASE_MIN_PCT = 5.0  # price_increases: hikes >= 5%
FORGOTTEN_MAX_VARIABILITY_PCT = 5.0  # possibly_forgotten: stdev/median <= 5%
FORGOTTEN_MIN_DAYS = 365  # ...running >= 12 months
FORGOTTEN_MAX_MONTHLY_EQ = 100.0  # ...and subscription-scale (ruling: no mortgages)
TOP_MERCHANTS = 10
FORECAST_LOOKBACK_MONTHS = 6  # trailing window for the variable average


def _month_start(date: dt.date) -> dt.date:
    return date.replace(day=1)


def _shift_months(date: dt.date, months: int) -> dt.date:
    total = date.year * 12 + (date.month - 1) + months
    return dt.date(total // 12, total % 12 + 1, 1)


def _month_label(date: dt.date) -> str:
    return f"{date.year:04d}-{date.month:02d}"


def _spending_rows(
    db, from_: dt.date | None = None, to: dt.date | None = None
) -> list[Transaction]:
    """Outflows that count as spending (excludes transfer pairs + fallback)."""
    query = (
        select(Transaction)
        .where(Transaction.amount < 0)
        .where(Transaction.transfer_pair_id.is_(None))
        .order_by(Transaction.date, Transaction.id)
    )
    if from_ is not None:
        query = query.where(Transaction.date >= from_)
    if to is not None:
        query = query.where(Transaction.date <= to)
    rows = db.execute(query).scalars().all()
    return [
        t for t in rows
        if (t.category or "").strip().lower() not in _EXCLUDED_CATEGORIES
    ]


def _category_key(txn: Transaction) -> str:
    return (txn.category or "").strip().lower() or "uncategorized"


# --- /spending/summary -------------------------------------------------------


@router.get("/spending/summary")
def spending_summary(
    db: Db,
    _: Authenticated,
    from_: str | None = Query(default=None, alias="from"),
    to: str | None = None,
    group_by: str = "month",
):
    """Per-category monthly totals. Defaults to the trailing 12 calendar
    months including the current (partial) month."""
    if group_by != "month":
        raise ApiError(422, "validation_error", "group_by must be 'month'")
    today = dt.date.today()
    to_date = parse_date(to, "to") if to else today
    from_date = (
        parse_date(from_, "from") if from_ else _shift_months(_month_start(today), -11)
    )
    if from_date > to_date:
        raise ApiError(422, "validation_error", "from must be on or before to")

    month_keys: list[str] = []
    cursor = _month_start(from_date)
    while cursor <= to_date:
        month_keys.append(_month_label(cursor))
        cursor = _shift_months(cursor, 1)
    index = {key: i for i, key in enumerate(month_keys)}

    totals: dict[str, list[float]] = {}
    for txn in _spending_rows(db, from_date, to_date):
        slot = index[_month_label(txn.date)]
        series = totals.setdefault(_category_key(txn), [0.0] * len(month_keys))
        series[slot] += -txn.amount

    categories = [
        {
            "category": category,
            "totals": [round(v, 2) for v in series],
            "total": round(sum(series), 2),
        }
        for category, series in totals.items()
    ]
    categories.sort(key=lambda c: (-c["total"], c["category"]))
    return {
        "months": month_keys,
        "categories": categories,
        "grand_total": round(sum(c["total"] for c in categories), 2),
    }


# --- /spending/recurring -----------------------------------------------------


def _detect(db, today: dt.date) -> list[RecurringCharge]:
    occurrences = [
        Occurrence(date=t.date, amount=-t.amount, payee=t.payee, category=t.category)
        for t in _spending_rows(db)
    ]
    return detect_recurring(occurrences, today)


def _serialize_charge(charge: RecurringCharge) -> dict:
    return {
        "payee": charge.payee,
        "category": charge.category,
        "cadence": charge.cadence,
        "typical_amount": charge.typical_amount,
        "last_amount": charge.last_amount,
        "price_change_pct": charge.price_change_pct,
        "last_date": iso(charge.last_date),
        "first_seen": iso(charge.first_seen),
        "occurrences": charge.occurrences,
        "active": charge.active,
        "monthly_equivalent": charge.monthly_equivalent,
        "amount_variability_pct": charge.amount_variability_pct,
    }


@router.get("/spending/recurring")
def spending_recurring(db: Db, _: Authenticated):
    return [_serialize_charge(c) for c in _detect(db, dt.date.today())]


# --- /spending/hotspots ------------------------------------------------------


@router.get("/spending/hotspots")
def spending_hotspots(db: Db, _: Authenticated, months: int = Query(default=6, ge=1, le=24)):
    today = dt.date.today()
    current_month = _month_start(today)  # partial month excluded from averages
    recent_start = _shift_months(current_month, -months)
    baseline_start = _shift_months(recent_start, -months)

    recent_totals: dict[str, float] = {}
    baseline_totals: dict[str, float] = {}
    merchants: dict[str, dict] = {}
    for txn in _spending_rows(db, baseline_start, current_month - dt.timedelta(days=1)):
        amount = -txn.amount
        category = _category_key(txn)
        if txn.date >= recent_start:
            recent_totals[category] = recent_totals.get(category, 0.0) + amount
            key = normalize_payee(txn.payee) or "(unknown)"
            merchant = merchants.setdefault(key, {"total": 0.0, "count": 0, "payees": []})
            merchant["total"] += amount
            merchant["count"] += 1
            merchant["payees"].append(txn.payee)
        else:
            baseline_totals[category] = baseline_totals.get(category, 0.0) + amount

    spikes = []
    for category, recent_total in recent_totals.items():
        recent_avg = recent_total / months
        baseline_avg = baseline_totals.get(category, 0.0) / months
        if baseline_avg < SPIKE_MIN_BASELINE:
            continue
        delta_pct = (recent_avg - baseline_avg) / baseline_avg * 100.0
        if delta_pct >= SPIKE_MIN_DELTA_PCT:
            spikes.append({
                "category": category,
                "recent_monthly_avg": round(recent_avg, 2),
                "baseline_monthly_avg": round(baseline_avg, 2),
                "delta_pct": round(delta_pct, 1),
            })
    spikes.sort(key=lambda s: (-s["delta_pct"], s["category"]))

    top_merchants = sorted(
        merchants.values(), key=lambda m: -m["total"]
    )[:TOP_MERCHANTS]
    top_merchants = [
        {
            "payee": max(set(m["payees"]), key=m["payees"].count),
            "monthly_avg": round(m["total"] / months, 2),
            "txn_count": m["count"],
        }
        for m in top_merchants
    ]

    charges = _detect(db, today)
    price_increases = [
        _serialize_charge(c) for c in charges
        if c.active and c.price_change_pct >= PRICE_INCREASE_MIN_PCT
    ]
    possibly_forgotten = [
        _serialize_charge(c) for c in charges
        if c.active
        and (today - c.first_seen).days >= FORGOTTEN_MIN_DAYS
        and c.amount_variability_pct <= FORGOTTEN_MAX_VARIABILITY_PCT
        and c.monthly_equivalent <= FORGOTTEN_MAX_MONTHLY_EQ
    ]
    return {
        "category_spikes": spikes,
        "top_merchants": top_merchants,
        "price_increases": price_increases,
        "possibly_forgotten": possibly_forgotten,
    }


# --- /spending/forecast ------------------------------------------------------


@router.get("/spending/forecast")
def spending_forecast(db: Db, _: Authenticated, months: int = Query(default=12, ge=1, le=36)):
    """Project the next N calendar months (starting next month): active
    recurring charges at cadence (weekly/monthly as their monthly
    equivalent, annual as a lump in their anniversary month) plus a
    trailing-6-month average of non-recurring spend per category."""
    today = dt.date.today()
    future = [_shift_months(_month_start(today), i + 1) for i in range(months)]
    month_keys = [_month_label(m) for m in future]

    charges = [c for c in _detect(db, today) if c.active]
    recurring_keys = {c.key for c in charges}
    recurring_series = [0.0] * months
    for charge in charges:
        if charge.cadence == "annual":
            due_month = charge.last_date.month
            for i, m in enumerate(future):
                if m.month == due_month:
                    recurring_series[i] += charge.last_amount
        else:
            for i in range(months):
                recurring_series[i] += charge.monthly_equivalent

    lookback_start = _shift_months(_month_start(today), -FORECAST_LOOKBACK_MONTHS)
    lookback_end = _month_start(today) - dt.timedelta(days=1)
    variable_totals: dict[str, float] = {}
    for txn in _spending_rows(db, lookback_start, lookback_end):
        if normalize_payee(txn.payee) in recurring_keys:
            continue
        category = _category_key(txn)
        variable_totals[category] = variable_totals.get(category, 0.0) - txn.amount

    variable_by_category = [
        {"category": category, "monthly_avg": round(total / FORECAST_LOOKBACK_MONTHS, 2)}
        for category, total in variable_totals.items()
    ]
    variable_by_category.sort(key=lambda v: (-v["monthly_avg"], v["category"]))
    variable_sum = sum(v["monthly_avg"] for v in variable_by_category)

    return {
        "months": month_keys,
        "recurring": [round(v, 2) for v in recurring_series],
        "variable_by_category": variable_by_category,
        "total": [round(r + variable_sum, 2) for r in recurring_series],
    }
