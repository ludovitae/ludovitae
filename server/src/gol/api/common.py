"""Shared router plumbing: DB dependency, auth marker, serializers."""

from __future__ import annotations

import datetime as dt
from typing import Annotated

from fastapi import Depends
from sqlalchemy.orm import Session as DbSession

from gol.db import get_db
from gol.errors import ApiError

Db = Annotated[DbSession, Depends(get_db)]


def iso(value: dt.date | None) -> str | None:
    return value.isoformat() if value else None


def parse_date(value: str, field: str = "date") -> dt.date:
    try:
        return dt.date.fromisoformat(value)
    except ValueError as exc:
        raise ApiError(422, "validation_error", f"{field}: expected YYYY-MM-DD") from exc


def get_or_404(db: DbSession, model, item_id: int, code: str):
    obj = db.get(model, item_id)
    if obj is None:
        raise ApiError(404, code, f"{model.__name__} {item_id} not found")
    return obj
