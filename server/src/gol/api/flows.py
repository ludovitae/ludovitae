"""Flows CRUD (recurring income/expenses/contributions)."""

from __future__ import annotations

from fastapi import APIRouter, Response
from pydantic import BaseModel, Field

from gol.api.common import Db, get_or_404, iso, parse_date
from gol.auth.deps import Authenticated
from gol.errors import ApiError
from gol.models import FLOW_KINDS, Account, Flow

router = APIRouter(tags=["flows"])


class FlowCreate(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    kind: str
    amount_monthly: float
    annual_growth_pct: float = 0.0
    start_date: str | None = None
    end_date: str | None = None
    account_id: int | None = None
    category: str | None = None
    ends_at_retirement: bool = False


class FlowPatch(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    kind: str | None = None
    amount_monthly: float | None = None
    annual_growth_pct: float | None = None
    start_date: str | None = None
    end_date: str | None = None
    account_id: int | None = None
    category: str | None = None
    ends_at_retirement: bool | None = None


def _serialize(flow: Flow) -> dict:
    return {
        "id": flow.id,
        "name": flow.name,
        "kind": flow.kind,
        "amount_monthly": flow.amount_monthly,
        "annual_growth_pct": flow.annual_growth_pct,
        "start_date": iso(flow.start_date),
        "end_date": iso(flow.end_date),
        "account_id": flow.account_id,
        "category": flow.category,
        "ends_at_retirement": flow.ends_at_retirement,
    }


def _validate(db, kind: str, account_id: int | None) -> None:
    if kind not in FLOW_KINDS:
        raise ApiError(422, "validation_error", f"kind must be one of {', '.join(FLOW_KINDS)}")
    if kind == "contribution" and account_id is None:
        raise ApiError(
            400, "contribution_requires_account", "contribution flows require account_id"
        )
    if account_id is not None:
        get_or_404(db, Account, account_id, "account_not_found")


@router.get("/flows")
def list_flows(db: Db, _: Authenticated):
    return [_serialize(f) for f in db.query(Flow).order_by(Flow.id).all()]


@router.post("/flows", status_code=201)
def create_flow(body: FlowCreate, db: Db, _: Authenticated):
    _validate(db, body.kind, body.account_id)
    flow = Flow(
        name=body.name,
        kind=body.kind,
        amount_monthly=body.amount_monthly,
        annual_growth_pct=body.annual_growth_pct,
        start_date=parse_date(body.start_date, "start_date") if body.start_date else None,
        end_date=parse_date(body.end_date, "end_date") if body.end_date else None,
        account_id=body.account_id,
        category=body.category,
        ends_at_retirement=body.ends_at_retirement,
    )
    db.add(flow)
    db.flush()
    return _serialize(flow)


@router.patch("/flows/{flow_id}")
def patch_flow(flow_id: int, body: FlowPatch, db: Db, _: Authenticated):
    flow = get_or_404(db, Flow, flow_id, "flow_not_found")
    data = body.model_dump(exclude_unset=True)
    for field in ("start_date", "end_date"):
        if field in data and data[field] is not None:
            data[field] = parse_date(data[field], field)
    kind = data.get("kind", flow.kind)
    account_id = data.get("account_id", flow.account_id)
    _validate(db, kind, account_id)
    for key, value in data.items():
        setattr(flow, key, value)
    db.flush()
    return _serialize(flow)


@router.delete("/flows/{flow_id}", status_code=204)
def delete_flow(flow_id: int, db: Db, _: Authenticated):
    flow = get_or_404(db, Flow, flow_id, "flow_not_found")
    db.delete(flow)
    db.flush()
    return Response(status_code=204)
