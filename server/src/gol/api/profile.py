"""GET/PUT /profile — singleton."""

from __future__ import annotations

from fastapi import APIRouter
from pydantic import BaseModel, Field

from gol.api.common import Db
from gol.assembly import get_or_create_profile
from gol.auth.deps import Authenticated
from gol.models import Profile

router = APIRouter(tags=["profile"])


class ProfileBody(BaseModel):
    birth_year: int = Field(ge=1900, le=2100)
    retirement_age: int = Field(ge=18, le=100)
    life_expectancy: int = Field(ge=18, le=120)
    annual_retirement_spending: float = Field(ge=0)
    social_security_monthly: float = Field(ge=0)
    social_security_start_age: int = Field(ge=18, le=100)
    inflation_pct: float = Field(ge=-5, le=50)
    effective_tax_rate_pct: float = Field(ge=0, le=100)


def _serialize(profile: Profile) -> dict:
    return {
        "birth_year": profile.birth_year,
        "retirement_age": profile.retirement_age,
        "life_expectancy": profile.life_expectancy,
        "annual_retirement_spending": profile.annual_retirement_spending,
        "social_security_monthly": profile.social_security_monthly,
        "social_security_start_age": profile.social_security_start_age,
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
