"""AI budget ledger + hard-stop guard (v1.2 — ships before any AI calls).

Every future AI caller MUST:
  1. call `check_ai_budget(db, projected_cost_usd)` before the API call —
     raises 403 `ai_budget_exhausted` when the month's spend would exceed
     the monthly budget;
  2. call `record_ai_usage(...)` after the call with actual token counts.

The API key lives in the ai_settings row of the local chmod-0600 database.
It must NEVER be logged, echoed in a response, or embedded in an error
message — only `api_key_last4` leaves this module.
"""

from __future__ import annotations

import datetime as dt

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from gol.errors import ApiError
from gol.models import AiSettings, AiUsage, utcnow


def get_or_create_ai_settings(db: Session) -> AiSettings:
    settings = db.execute(select(AiSettings)).scalar_one_or_none()
    if settings is None:
        settings = AiSettings()
        db.add(settings)
        db.flush()
    return settings


def month_key(moment: dt.datetime | None = None) -> str:
    moment = moment or utcnow()
    return f"{moment.year:04d}-{moment.month:02d}"


def month_totals(db: Session, month: str) -> tuple[int, int, float]:
    """(input_tokens, output_tokens, est_cost_usd) for one calendar month."""
    row = db.execute(
        select(
            func.coalesce(func.sum(AiUsage.input_tokens), 0),
            func.coalesce(func.sum(AiUsage.output_tokens), 0),
            func.coalesce(func.sum(AiUsage.est_cost_usd), 0.0),
        ).where(AiUsage.month == month)
    ).one()
    return int(row[0]), int(row[1]), float(row[2])


def check_ai_budget(db: Session, projected_cost_usd: float = 0.0) -> None:
    """Hard stop: 403 ai_budget_exhausted when this month's spend plus the
    projected call cost would exceed the monthly budget."""
    settings = get_or_create_ai_settings(db)
    _, _, spent = month_totals(db, month_key())
    if spent + projected_cost_usd > settings.monthly_budget_usd:
        raise ApiError(
            403,
            "ai_budget_exhausted",
            f"monthly AI budget of ${settings.monthly_budget_usd:.2f} is exhausted "
            f"(${spent:.4f} spent this month)",
        )


def record_ai_usage(
    db: Session, purpose: str, input_tokens: int, output_tokens: int, est_cost_usd: float
) -> AiUsage:
    row = AiUsage(
        month=month_key(),
        purpose=purpose,
        input_tokens=input_tokens,
        output_tokens=output_tokens,
        est_cost_usd=est_cost_usd,
    )
    db.add(row)
    db.flush()
    return row
