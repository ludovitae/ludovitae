"""GET/PUT /profile — singleton, household-level assumptions only (v1.1).

Person-level fields (birth_year, retirement_age, life_expectancy, social
security) live on household members; see gol/api/household.py.
"""

from __future__ import annotations

from fastapi import APIRouter
from pydantic import BaseModel, Field

from gol.api.common import Db
from gol.assembly import get_or_create_profile
from gol.auth.deps import Authenticated
from gol.models import Profile

router = APIRouter(tags=["profile"])


class ProfileBody(BaseModel):
    annual_retirement_spending: float = Field(ge=0)
    inflation_pct: float = Field(ge=-5, le=50)
    effective_tax_rate_pct: float = Field(ge=0, le=100)


def _serialize(profile: Profile) -> dict:
    return {
        "annual_retirement_spending": profile.annual_retirement_spending,
        "inflation_pct": profile.inflation_pct,
        "effective_tax_rate_pct": profile.effective_tax_rate_pct,
    }


@router.get("/profile")
def get_profile(db: Db, _: Authenticated):
    return _serialize(get_or_create_profile(db))


@router.put("/profile")
def put_profile(body: ProfileBody, db: Db, _: Authenticated):
    profile = get_or_create_profile(db)
    for key, value in body.model_dump().items():
        setattr(profile, key, value)
    db.flush()
    return _serialize(profile)
