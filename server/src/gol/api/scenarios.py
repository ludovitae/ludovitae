"""Scenarios CRUD. A synthetic read-only baseline (id 0) always exists."""

from __future__ import annotations

from fastapi import APIRouter, Response
from pydantic import BaseModel, ConfigDict, Field

from gol.api.common import Db, get_or_404
from gol.auth.deps import Authenticated
from gol.errors import ApiError
from gol.models import Scenario

router = APIRouter(tags=["scenarios"])

BASELINE = {
    "id": 0,
    "name": "Current trajectory",
    "description": "Baseline built from your real profile, accounts, and flows.",
    "is_baseline": True,
    "params": {},
}


class ScenarioEvent(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = ""
    kind: str  # one_time | recurring_expense | recurring_income
    amount: float | None = None
    amount_monthly: float | None = None
    age: int | None = None
    start_age: int | None = None
    end_age: int | None = None


class MemberOverride(BaseModel):
    model_config = ConfigDict(extra="forbid")

    retirement_age: int | None = Field(default=None, ge=18, le=100)
    ss_claim_age: int | None = Field(default=None, ge=62, le=70)


class ScenarioParams(BaseModel):
    model_config = ConfigDict(extra="forbid")

    # kept for compatibility: sugar for the self member's retirement override
    retirement_age: int | None = Field(default=None, ge=18, le=100)
    member_overrides: dict[str, MemberOverride] | None = None
    monthly_savings_delta: float | None = None
    annual_retirement_spending: float | None = Field(default=None, ge=0)
    spending_delta_pct: float | None = Field(default=None, ge=-100, le=500)
    return_override_pct: float | None = Field(default=None, ge=-20, le=50)
    inflation_override_pct: float | None = Field(default=None, ge=-5, le=50)
    events: list[ScenarioEvent] | None = None


class ScenarioCreate(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    description: str = ""
    params: ScenarioParams = Field(default_factory=ScenarioParams)


class ScenarioPatch(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    description: str | None = None
    params: ScenarioParams | None = None


def validate_event(ev: ScenarioEvent) -> None:
    if ev.kind == "one_time":
        if ev.amount is None or ev.age is None:
            raise ApiError(422, "validation_error", "one_time events need amount and age")
    elif ev.kind in ("recurring_expense", "recurring_income"):
        if ev.amount_monthly is None:
            raise ApiError(422, "validation_error", f"{ev.kind} events need amount_monthly")
    else:
        raise ApiError(
            422, "validation_error",
            "event.kind must be one_time, recurring_expense, or recurring_income",
        )


def _clean_params(params: ScenarioParams) -> dict:
    for ev in params.events or []:
        validate_event(ev)
    for key in params.member_overrides or {}:
        if not key.isdigit():
            raise ApiError(
                422, "validation_error",
                "member_overrides keys must be member ids as strings",
            )
    return params.model_dump(exclude_none=True)


def serialize(scn: Scenario) -> dict:
    return {
        "id": scn.id,
        "name": scn.name,
        "description": scn.description,
        "is_baseline": scn.is_baseline,
        "params": scn.params or {},
    }


@router.get("/scenarios")
def list_scenarios(db: Db, _: Authenticated):
    return [BASELINE] + [serialize(s) for s in db.query(Scenario).order_by(Scenario.id).all()]


@router.post("/scenarios", status_code=201)
def create_scenario(body: ScenarioCreate, db: Db, _: Authenticated):
    scn = Scenario(
        name=body.name, description=body.description,
        is_baseline=False, params=_clean_params(body.params),
    )
    db.add(scn)
    db.flush()
    return serialize(scn)


@router.get("/scenarios/{scenario_id}")
def get_scenario(scenario_id: int, db: Db, _: Authenticated):
    if scenario_id == 0:
        return BASELINE
    return serialize(get_or_404(db, Scenario, scenario_id, "scenario_not_found"))


@router.patch("/scenarios/{scenario_id}")
def patch_scenario(scenario_id: int, body: ScenarioPatch, db: Db, _: Authenticated):
    if scenario_id == 0:
        raise ApiError(403, "baseline_readonly", "the baseline scenario cannot be modified")
    scn = get_or_404(db, Scenario, scenario_id, "scenario_not_found")
    data = body.model_dump(exclude_unset=True)
    if body.params is not None:
        data["params"] = _clean_params(body.params)
    for key, value in data.items():
        setattr(scn, key, value)
    db.flush()
    return serialize(scn)


@router.delete("/scenarios/{scenario_id}", status_code=204)
def delete_scenario(scenario_id: int, db: Db, _: Authenticated):
    if scenario_id == 0:
        raise ApiError(403, "baseline_readonly", "the baseline scenario cannot be deleted")
    scn = get_or_404(db, Scenario, scenario_id, "scenario_not_found")
    db.delete(scn)
    db.flush()
    return Response(status_code=204)
