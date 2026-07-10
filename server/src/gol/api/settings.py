"""GET/PATCH /settings — feature flags (theme A/B, reduce motion)."""

from __future__ import annotations

from fastapi import APIRouter
from pydantic import BaseModel

from gol.api.common import Db
from gol.assembly import get_or_create_settings
from gol.auth.deps import Authenticated
from gol.errors import ApiError

router = APIRouter(tags=["settings"])

THEMES = ("fintech", "game")


class SettingsPatch(BaseModel):
    theme: str | None = None
    reduce_motion: bool | None = None


def _serialize(setting) -> dict:
    return {"theme": setting.theme, "reduce_motion": setting.reduce_motion}


@router.get("/settings")
def get_settings(db: Db, _: Authenticated):
    return _serialize(get_or_create_settings(db))


@router.patch("/settings")
def patch_settings(body: SettingsPatch, db: Db, _: Authenticated):
    setting = get_or_create_settings(db)
    data = body.model_dump(exclude_unset=True)
    if "theme" in data and data["theme"] not in THEMES:
        raise ApiError(422, "validation_error", f"theme must be one of {', '.join(THEMES)}")
    for key, value in data.items():
        setattr(setting, key, value)
    db.flush()
    return _serialize(setting)
