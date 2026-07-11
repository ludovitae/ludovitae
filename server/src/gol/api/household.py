"""Household members CRUD (v1.1). Exactly one `self` member exists — it is
created on first access and cannot be deleted; roles cannot move to/from
`self` after creation."""

from __future__ import annotations

from fastapi import APIRouter, Response
from pydantic import BaseModel, Field

from gol.api.common import Db, get_or_404
from gol.assembly import get_or_create_household
from gol.auth.deps import Authenticated
from gol.errors import ApiError
from gol.models import MEMBER_ROLES, HouseholdMember

router = APIRouter(tags=["household"])


class MemberCreate(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    role: str
    birth_year: int = Field(ge=1900, le=2100)
    life_expectancy: int = Field(ge=1, le=120)
    retirement_age: int | None = Field(default=None, ge=18, le=100)
    ss_monthly_at_fra: float | None = Field(default=None, ge=0)
    ss_claim_age: int | None = Field(default=None, ge=62, le=70)
    notes: str = ""


class MemberPatch(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    role: str | None = None
    birth_year: int | None = Field(default=None, ge=1900, le=2100)
    life_expectancy: int | None = Field(default=None, ge=1, le=120)
    retirement_age: int | None = Field(default=None, ge=18, le=100)
    ss_monthly_at_fra: float | None = Field(default=None, ge=0)
    ss_claim_age: int | None = Field(default=None, ge=62, le=70)
    notes: str | None = None


def serialize(m: HouseholdMember) -> dict:
    return {
        "id": m.id,
        "name": m.name,
        "role": m.role,
        "birth_year": m.birth_year,
        "life_expectancy": m.life_expectancy,
        "retirement_age": m.retirement_age,
        "ss_monthly_at_fra": m.ss_monthly_at_fra,
        "ss_claim_age": m.ss_claim_age,
        "notes": m.notes,
    }


def _validate_role(role: str) -> None:
    if role not in MEMBER_ROLES:
        raise ApiError(
            422, "validation_error", f"role must be one of {', '.join(MEMBER_ROLES)}"
        )


@router.get("/household")
def list_members(db: Db, _: Authenticated):
    return [serialize(m) for m in get_or_create_household(db)]


@router.post("/household", status_code=201)
def create_member(body: MemberCreate, db: Db, _: Authenticated):
    _validate_role(body.role)
    get_or_create_household(db)  # ensure the self member exists first
    if body.role == "self":
        raise ApiError(
            409, "self_member_exists", "exactly one self member may exist"
        )
    member = HouseholdMember(**body.model_dump())
    db.add(member)
    db.flush()
    return serialize(member)


@router.get("/household/{member_id}")
def get_member(member_id: int, db: Db, _: Authenticated):
    return serialize(get_or_404(db, HouseholdMember, member_id, "member_not_found"))


@router.patch("/household/{member_id}")
def patch_member(member_id: int, body: MemberPatch, db: Db, _: Authenticated):
    member = get_or_404(db, HouseholdMember, member_id, "member_not_found")
    data = body.model_dump(exclude_unset=True)
    if "role" in data and data["role"] != member.role:
        _validate_role(data["role"])
        if member.role == "self" or data["role"] == "self":
            raise ApiError(
                409, "self_role_immutable",
                "the self member's role cannot change, and no other member can become self",
            )
    for key, value in data.items():
        setattr(member, key, value)
    db.flush()
    return serialize(member)


@router.delete("/household/{member_id}", status_code=204)
def delete_member(member_id: int, db: Db, _: Authenticated):
    member = get_or_404(db, HouseholdMember, member_id, "member_not_found")
    if member.role == "self":
        raise ApiError(403, "self_member_undeletable", "the self member cannot be deleted")
    db.delete(member)
    db.flush()
    return Response(status_code=204)
