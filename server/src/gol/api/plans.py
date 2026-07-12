"""Plan snapshots + plan-vs-actuals tracking (v1.3, #21).

A PlanSnapshot freezes a full /simulate response plus the inputs summary it
consumed. It is NEVER mutated after creation, so an engine upgrade cannot
move an old plan's numbers (docs/API.md "Plan snapshots & tracking").

Tracking overlays the frozen plan line against actuals computed from real
data, per metric:
  * net_worth — plan = frozen deterministic net_worth (year-end dates), with
    the p25/p75 percentile band as the "normal range"; actual = month-end net
    worth carried forward from balance snapshots.
  * spending  — plan = flat captured monthly rate; actual = monthly outflow
    sum (transfers + investment-activity excluded, same as /spending/*).
  * saving    — plan = flat captured monthly rate; actual = monthly positive
    transactions posted into investment-type accounts (contributions).

The polarity of "ahead/behind" differs by metric (spending up is bad); the
"within_normal_range" status keeps normal market variance from reading as
"behind" (model-honesty precedent from the assumptions strip).
"""

from __future__ import annotations

import datetime as dt
import secrets
from copy import deepcopy

from fastapi import APIRouter, Query, Response
from pydantic import BaseModel, Field
from sqlalchemy import func, select, update
from sqlalchemy.orm import Session as DbSession
from sqlalchemy.orm import selectinload

from gol.api.common import Db, get_or_404
from gol.api.scenarios import ScenarioParams, validate_event
from gol.api.simulate import MAX_PATHS, _resolve_params, _run_cached
from gol.api.spending_analytics import _spending_rows
from gol.assembly import build_plan_inputs
from gol.auth.deps import Authenticated
from gol.errors import ApiError
from gol.models import INVESTABLE_TYPES, LIABILITY_TYPES, Account, PlanSnapshot
from gol.sim.types import CONTRIB_INVESTED, EXPENSE

router = APIRouter(tags=["plans"])

METRICS = ("net_worth", "spending", "saving")


# --- month helpers -----------------------------------------------------------


def _month_start(date: dt.date) -> dt.date:
    return date.replace(day=1)


def _shift_months(date: dt.date, months: int) -> dt.date:
    total = date.year * 12 + (date.month - 1) + months
    return dt.date(total // 12, total % 12 + 1, 1)


def _month_end(month_start: dt.date) -> dt.date:
    return _shift_months(month_start, 1) - dt.timedelta(days=1)


def _complete_months(start: dt.date, today: dt.date) -> list[tuple[dt.date, dt.date]]:
    """(month_start, month_end) for every month fully in the past — the current
    (partial) month is excluded so a half-finished month never reads as a dip
    in spending/saving actuals."""
    out: list[tuple[dt.date, dt.date]] = []
    current = _month_start(today)
    cursor = _month_start(start)
    while cursor < current:
        out.append((cursor, _month_end(cursor)))
        cursor = _shift_months(cursor, 1)
    return out


# --- capture helpers ---------------------------------------------------------


def _current_net_worth(db: DbSession) -> float:
    total = 0.0
    for acc in (
        db.execute(select(Account).options(selectinload(Account.balances)))
        .scalars()
        .all()
    ):
        if not acc.include_in_net_worth:
            continue
        bal = acc.balance
        total += -bal if acc.type in LIABILITY_TYPES else bal
    return round(total, 2)


def _plan_rates(inputs) -> tuple[float, float]:
    """Month-0 monthly spending and saving rates from the resolved PlanInputs
    (scenario overrides included). Spending = active EXPENSE flows/categories;
    saving = active invested contributions."""
    spending = saving = 0.0
    for f in inputs.flows:
        active = f.start_month <= 0 and (f.end_month is None or f.end_month > 0)
        if not active:
            continue
        if f.kind == EXPENSE:
            spending += f.amount_monthly
        elif f.kind == CONTRIB_INVESTED:
            saving += f.amount_monthly
    return round(spending, 2), round(saving, 2)


# --- serialization -----------------------------------------------------------


def _horizon_end_year(response: dict) -> int | None:
    ages = response.get("ages") or []
    start_year = response.get("start_year")
    if start_year is None:
        return None
    return start_year + len(ages) - 1 if ages else start_year


def _serialize_meta(snap: PlanSnapshot) -> dict:
    return {
        "id": snap.id,
        "name": snap.name,
        "created_at": snap.created_at.isoformat(),
        "engine_version": snap.engine_version,
        "is_benchmark": snap.is_benchmark,
        "scenario_id": snap.scenario_id,
        "captured_net_worth": snap.captured_net_worth,
        "monthly_spending": snap.monthly_spending,
        "monthly_saving": snap.monthly_saving,
        "start_year": snap.response.get("start_year"),
        "horizon_end_year": _horizon_end_year(snap.response),
    }


def _serialize_full(snap: PlanSnapshot) -> dict:
    return {
        **_serialize_meta(snap),
        "response": snap.response,
        "inputs_summary": snap.inputs_summary,
    }


# --- endpoints: CRUD ---------------------------------------------------------


class SnapshotBody(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    scenario_id: int | None = None
    params: ScenarioParams | None = None
    n_paths: int = Field(default=1000, ge=1, le=MAX_PATHS)
    seed: int | None = Field(default=None, ge=0)


class PlanPatch(BaseModel):
    is_benchmark: bool


@router.get("/plans")
def list_plans(db: Db, _: Authenticated):
    snaps = db.execute(
        select(PlanSnapshot).order_by(PlanSnapshot.id.desc())
    ).scalars().all()
    return [_serialize_meta(s) for s in snaps]


@router.post("/plans/snapshot", status_code=201)
def create_snapshot(body: SnapshotBody, db: Db, _: Authenticated):
    if body.scenario_id is not None and body.params is not None:
        raise ApiError(400, "bad_request", "provide either scenario_id or params, not both")
    if body.params is not None:
        for ev in body.params.events or []:
            validate_event(ev)
        params = body.params.model_dump(exclude_none=True)
        scenario_id: int | None = None
    elif body.scenario_id is not None:
        params = _resolve_params(db, body.scenario_id)
        scenario_id = body.scenario_id or None  # id 0 (baseline) stored as null
    else:
        params, scenario_id = {}, None  # neither -> capture the baseline

    seed = body.seed if body.seed is not None else secrets.randbits(32)
    # deepcopy so the frozen snapshot never aliases the shared sim cache row.
    response = deepcopy(_run_cached(db, params, body.n_paths, seed))
    inputs = build_plan_inputs(db, params)
    spending, saving = _plan_rates(inputs)
    net_worth = _current_net_worth(db)
    inputs_summary = {
        "net_worth": net_worth,
        "monthly_spending": spending,
        "monthly_saving": saving,
        "annual_retirement_spending": inputs.annual_retirement_spending,
        "inflation_pct": inputs.inflation_mean_pct,
        "scenario_id": scenario_id,
        "params": params,
    }
    # the very first snapshot becomes the active benchmark automatically.
    is_first = db.execute(select(func.count(PlanSnapshot.id))).scalar_one() == 0
    snap = PlanSnapshot(
        name=body.name,
        engine_version=response["engine_version"],
        scenario_id=scenario_id,
        is_benchmark=is_first,
        captured_net_worth=net_worth,
        monthly_spending=spending,
        monthly_saving=saving,
        response=response,
        inputs_summary=inputs_summary,
    )
    db.add(snap)
    db.flush()
    return _serialize_full(snap)


@router.get("/plans/{plan_id}")
def get_plan(plan_id: int, db: Db, _: Authenticated):
    return _serialize_full(get_or_404(db, PlanSnapshot, plan_id, "plan_not_found"))


@router.patch("/plans/{plan_id}")
def patch_plan(plan_id: int, body: PlanPatch, db: Db, _: Authenticated):
    snap = get_or_404(db, PlanSnapshot, plan_id, "plan_not_found")
    if body.is_benchmark:
        # zero-or-one invariant: promoting one demotes every other snapshot.
        db.execute(
            update(PlanSnapshot)
            .where(PlanSnapshot.id != plan_id)
            .values(is_benchmark=False)
        )
        snap.is_benchmark = True
    else:
        snap.is_benchmark = False
    db.flush()
    return _serialize_full(snap)


@router.delete("/plans/{plan_id}", status_code=204)
def delete_plan(plan_id: int, db: Db, _: Authenticated):
    snap = get_or_404(db, PlanSnapshot, plan_id, "plan_not_found")
    db.delete(snap)
    db.flush()
    return Response(status_code=204)


# --- tracking math -----------------------------------------------------------


def _year_end_series(values: list[float], start_year: int) -> list[dict]:
    """Annual (year-end December) values -> dated points."""
    return [
        {"date": dt.date(start_year + k, 12, 31).isoformat(), "value": v}
        for k, v in enumerate(values)
    ]


def _plan_net_worth(snap: PlanSnapshot) -> tuple[list[dict], dict | None]:
    """Plan line + normal-range band, both anchored at the capture date.

    The frozen deterministic array samples year-ends (Dec of start_year+k), so
    on its own it does not reach back to the capture moment. We prepend an
    anchor point at ``created_at`` = the captured net worth (where the band has
    no spread yet), so a mid-year "now" compares against the plan as it stood
    then, not against a year-end value it has not reached."""
    response = snap.response
    start_year = response["start_year"]
    created = snap.created_at.date().isoformat()
    nw0 = snap.captured_net_worth
    anchor = [{"date": created, "value": nw0}]
    det = response["deterministic"]["net_worth"]
    plan = anchor + _year_end_series(det, start_year)
    band: dict | None = None
    pct = response.get("percentiles") or {}
    if "p25" in pct and "p75" in pct:
        band = {
            "p25": anchor + _year_end_series(pct["p25"], start_year),
            "p75": anchor + _year_end_series(pct["p75"], start_year),
        }
    return plan, band


def _plan_flat(rate: float, start: dt.date, today: dt.date) -> list[dict]:
    """A flat monthly rate emitted once per complete tracked month."""
    return [
        {"date": m_end.isoformat(), "value": round(rate, 2)}
        for _, m_end in _complete_months(start, today)
    ]


def _actual_net_worth(db: DbSession, start: dt.date, today: dt.date) -> list[dict]:
    accounts = [
        a
        for a in db.execute(
            select(Account).options(selectinload(Account.balances))
        ).scalars().all()
        if a.include_in_net_worth
    ]
    points: list[dict] = []
    cursor = _month_start(start)
    current = _month_start(today)
    while cursor <= current:
        asof = min(_month_end(cursor), today)
        total = 0.0
        seen = False
        for acc in accounts:
            past = [b for b in acc.balances if b.date <= asof]
            if not past:
                continue
            seen = True
            amount = max(past, key=lambda b: b.date).amount
            total += -amount if acc.type in LIABILITY_TYPES else amount
        if seen:
            points.append({"date": asof.isoformat(), "value": round(total, 2)})
        cursor = _shift_months(cursor, 1)
    return points


def _actual_spending(db: DbSession, start: dt.date, today: dt.date) -> list[dict]:
    points: list[dict] = []
    for m_start, m_end in _complete_months(start, today):
        total = sum(-t.amount for t in _spending_rows(db, m_start, m_end))
        points.append({"date": m_end.isoformat(), "value": round(total, 2)})
    return points


def _actual_saving(db: DbSession, start: dt.date, today: dt.date) -> list[dict]:
    inv_ids = {
        a.id
        for a in db.execute(select(Account)).scalars().all()
        if a.type in INVESTABLE_TYPES
    }
    from gol.models import Transaction  # local import: avoids a heavy top-level

    points: list[dict] = []
    for m_start, m_end in _complete_months(start, today):
        if not inv_ids:
            points.append({"date": m_end.isoformat(), "value": 0.0})
            continue
        total = db.execute(
            select(func.coalesce(func.sum(Transaction.amount), 0))
            .where(Transaction.account_id.in_(inv_ids))
            .where(Transaction.amount > 0)
            .where(Transaction.date >= m_start)
            .where(Transaction.date <= m_end)
        ).scalar_one()
        points.append({"date": m_end.isoformat(), "value": round(float(total), 2)})
    return points


def _interp(series: list[dict], target: dt.date) -> float | None:
    if not series:
        return None
    pts = sorted((dt.date.fromisoformat(p["date"]), p["value"]) for p in series)
    if target <= pts[0][0]:
        return pts[0][1]
    if target >= pts[-1][0]:
        return pts[-1][1]
    for i in range(1, len(pts)):
        d1, v1 = pts[i]
        if target <= d1:
            d0, v0 = pts[i - 1]
            span = (d1 - d0).days or 1
            return v0 + (v1 - v0) * ((target - d0).days / span)
    return pts[-1][1]


def _threshold_status(delta: float, plan_now: float, higher_better: bool) -> str:
    tol = max(abs(plan_now) * 0.02, 1.0)
    if abs(delta) <= tol:
        return "on_track"
    ahead = delta > 0 if higher_better else delta < 0
    return "ahead" if ahead else "behind"


def _classify(
    metric: str, plan: list[dict], actual: list[dict], band: dict | None
) -> tuple[float | None, str | None]:
    if not actual:
        return None, None
    now = dt.date.fromisoformat(actual[-1]["date"])
    actual_now = actual[-1]["value"]
    plan_now = _interp(plan, now)
    if plan_now is None:
        return None, None
    delta = round(actual_now - plan_now, 2)
    if metric == "net_worth":
        if actual_now >= plan_now:
            status = "ahead"
        else:
            p25_now = _interp(band["p25"], now) if band else None
            status = (
                "within_normal_range"
                if p25_now is not None and actual_now >= p25_now
                else "behind"
            )
    elif metric == "saving":
        status = _threshold_status(delta, plan_now, higher_better=True)
    else:  # spending — higher is worse
        status = _threshold_status(delta, plan_now, higher_better=False)
    return delta, status


def _tracking(db: DbSession, snap: PlanSnapshot, metric: str, today: dt.date) -> dict:
    start = snap.created_at.date()
    if metric == "net_worth":
        plan, band = _plan_net_worth(snap)
        actual = _actual_net_worth(db, start, today)
    elif metric == "spending":
        plan, band = _plan_flat(snap.monthly_spending, start, today), None
        actual = _actual_spending(db, start, today)
    else:  # saving
        plan, band = _plan_flat(snap.monthly_saving, start, today), None
        actual = _actual_saving(db, start, today)
    delta_now, status = _classify(metric, plan, actual, band)
    return {
        "metric": metric,
        "plan": plan,
        "actual": actual,
        "band": band,
        "delta_now": delta_now,
        "status": status,
    }


def benchmark_summary(db: DbSession) -> dict | None:
    """The active benchmark's net-worth delta for the dashboard stat (#21).
    None when no snapshot is flagged. One surface, no badge (attention rules)."""
    snap = db.execute(
        select(PlanSnapshot).where(PlanSnapshot.is_benchmark.is_(True))
    ).scalar_one_or_none()
    if snap is None:
        return None
    tr = _tracking(db, snap, "net_worth", dt.date.today())
    return {
        "plan_id": snap.id,
        "name": snap.name,
        "metric": "net_worth",
        "delta_now": tr["delta_now"],
        "status": tr["status"],
    }


@router.get("/plans/{plan_id}/tracking")
def plan_tracking(
    plan_id: int,
    db: Db,
    _: Authenticated,
    metric: str = Query(default="net_worth"),
):
    if metric not in METRICS:
        raise ApiError(422, "validation_error", "metric must be net_worth|spending|saving")
    snap = get_or_404(db, PlanSnapshot, plan_id, "plan_not_found")
    return _tracking(db, snap, metric, dt.date.today())
