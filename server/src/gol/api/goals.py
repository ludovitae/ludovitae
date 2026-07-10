"""Goals CRUD."""

from __future__ import annotations

from fastapi import APIRouter, Response
from pydantic import BaseModel, Field

from gol.api.common import Db, get_or_404, iso, parse_date
from gol.auth.deps import Authenticated
from gol.models import Goal

router = APIRouter(tags=["goals"])


class GoalCreate(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    emoji: str | None = None
    target_amount: float = Field(ge=0)
    target_date: str | None = None
    priority: int = Field(default=3, ge=1, le=5)
    funded_amount: float = Field(default=0.0, ge=0)
    notes: str = ""


class GoalPatch(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    emoji: str | None = None
    target_amount: float | None = Field(default=None, ge=0)
    target_date: str | None = None
    priority: int | None = Field(default=None, ge=1, le=5)
    funded_amount: float | None = Field(default=None, ge=0)
    notes: str | None = None


def _serialize(goal: Goal) -> dict:
    return {
        "id": goal.id,
        "name": goal.name,
        "emoji": goal.emoji,
        "target_amount": goal.target_amount,
        "target_date": iso(goal.target_date),
        "priority": goal.priority,
        "funded_amount": goal.funded_amount,
        "notes": goal.notes,
    }


@router.get("/goals")
def list_goals(db: Db, _: Authenticated):
    return [_serialize(g) for g in db.query(Goal).order_by(Goal.priority, Goal.id).all()]


@router.post("/goals", status_code=201)
def create_goal(body: GoalCreate, db: Db, _: Authenticated):
    goal = Goal(
        name=body.name,
        emoji=body.emoji,
        target_amount=body.target_amount,
        target_date=parse_date(body.target_date, "target_date") if body.target_date else None,
        priority=body.priority,
        funded_amount=body.funded_amount,
        notes=body.notes,
    )
    db.add(goal)
    db.flush()
    return _serialize(goal)


@router.patch("/goals/{goal_id}")
def patch_goal(goal_id: int, body: GoalPatch, db: Db, _: Authenticated):
    goal = get_or_404(db, Goal, goal_id, "goal_not_found")
    data = body.model_dump(exclude_unset=True)
    if data.get("target_date") is not None:
        data["target_date"] = parse_date(data["target_date"], "target_date")
    for key, value in data.items():
        setattr(goal, key, value)
    db.flush()
    return _serialize(goal)


@router.delete("/goals/{goal_id}", status_code=204)
def delete_goal(goal_id: int, db: Db, _: Authenticated):
    goal = get_or_404(db, Goal, goal_id, "goal_not_found")
    db.delete(goal)
    db.flush()
    return Response(status_code=204)
