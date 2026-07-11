"""AI admin panel (v1.2): GET/PUT /settings/ai and GET /ai/usage.

The API key is write-only: stored in the local DB, returned only as
has_api_key + api_key_last4, and never logged (see gol/ai_budget.py)."""

from __future__ import annotations

from fastapi import APIRouter, Query
from pydantic import BaseModel, Field
from sqlalchemy import select

from gol.ai_budget import get_or_create_ai_settings, month_key, month_totals
from gol.api.common import Db
from gol.auth.deps import Authenticated
from gol.errors import ApiError
from gol.models import AiUsage

router = APIRouter(tags=["ai"])

class AiSettingsPut(BaseModel):
    # api_key: omitted = keep, null = delete, string = replace
    # (presence is detected via model_fields_set)
    api_key: str | None = None
    enabled: bool | None = None
    monthly_budget_usd: float | None = Field(default=None, ge=0)


def _serialize(db, settings) -> dict:
    input_tokens, output_tokens, spent = month_totals(db, month_key())
    return {
        "has_api_key": settings.api_key is not None,
        "api_key_last4": settings.api_key[-4:] if settings.api_key else None,
        "enabled": settings.enabled,
        "monthly_budget_usd": settings.monthly_budget_usd,
        "spend_this_month_usd": round(spent, 4),
        "tokens_this_month": {"input": input_tokens, "output": output_tokens},
    }


@router.get("/settings/ai")
def get_ai_settings(db: Db, _: Authenticated):
    return _serialize(db, get_or_create_ai_settings(db))


@router.put("/settings/ai")
def put_ai_settings(body: AiSettingsPut, db: Db, _: Authenticated):
    settings = get_or_create_ai_settings(db)
    if "api_key" in body.model_fields_set:
        if body.api_key is None:
            settings.api_key = None
        else:
            key = body.api_key.strip()
            if len(key) < 8:
                # never include the submitted value in the error
                raise ApiError(422, "validation_error", "api_key looks too short")
            settings.api_key = key
    if body.enabled is not None:
        settings.enabled = body.enabled
    if body.monthly_budget_usd is not None:
        settings.monthly_budget_usd = body.monthly_budget_usd
    db.flush()
    return _serialize(db, settings)


@router.get("/ai/usage")
def ai_usage(db: Db, _: Authenticated, months: int = Query(default=6, ge=1, le=60)):
    """Per-month aggregates (newest first), only months that have ledger rows,
    limited to the N most recent such months."""
    rows = db.execute(
        select(AiUsage).order_by(AiUsage.month.desc(), AiUsage.id)
    ).scalars().all()
    by_month: dict[str, dict] = {}
    for row in rows:
        month = by_month.setdefault(row.month, {
            "month": row.month, "input_tokens": 0, "output_tokens": 0,
            "est_cost_usd": 0.0, "by_purpose": {},
        })
        month["input_tokens"] += row.input_tokens
        month["output_tokens"] += row.output_tokens
        month["est_cost_usd"] += row.est_cost_usd
        purpose = month["by_purpose"].setdefault(row.purpose, {
            "input_tokens": 0, "output_tokens": 0, "est_cost_usd": 0.0,
        })
        purpose["input_tokens"] += row.input_tokens
        purpose["output_tokens"] += row.output_tokens
        purpose["est_cost_usd"] += row.est_cost_usd
    out = sorted(by_month.values(), key=lambda m: m["month"], reverse=True)[:months]
    for month in out:
        month["est_cost_usd"] = round(month["est_cost_usd"], 4)
        for purpose in month["by_purpose"].values():
            purpose["est_cost_usd"] = round(purpose["est_cost_usd"], 4)
    return out
