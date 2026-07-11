"""POST /admin/reset (#27, coordinator-ruled) — start from scratch.

Takes a consistent pre-reset backup FIRST (gol.backup, pre-reset-<ts>.db,
keep 5), then wipes every financial table while PRESERVING the auth
credential, live sessions, settings, ai_settings, and the ai_usage ledger.
mode="demo" then runs the demo seeder in-process; mode="empty" leaves a
single fresh "You" self member (null retirement/SS fields) and a defaults
profile. Built-in import presets are re-seeded — they are app furniture,
not user data.
"""

from __future__ import annotations

from fastapi import APIRouter
from pydantic import BaseModel
from sqlalchemy import delete

from gol.api.common import Db
from gol.auth.deps import Authenticated
from gol.backup import pre_reset_backup
from gol.errors import ApiError
from gol.importers.builtin_presets import ensure_builtin_presets
from gol.models import (
    Account,
    BalanceSnapshot,
    CategoryRule,
    Flow,
    Goal,
    HouseholdMember,
    ImportPreset,
    Profile,
    Scenario,
    SimulationRun,
    SpendingCategory,
    Transaction,
    TransferPairTombstone,
)
from gol.seed import seed_demo

router = APIRouter(tags=["admin"])

RESET_PHRASE = "reset ludovitae"

# Wipe order respects FK dependencies (children first). Everything financial
# goes; auth/settings/AI tables are deliberately NOT in this list.
FINANCIAL_TABLES = (
    TransferPairTombstone,  # FK -> transactions
    Transaction,            # FK -> accounts
    BalanceSnapshot,        # FK -> accounts
    Flow,                   # FK -> accounts, household_members
    Account,                # FK -> household_members
    HouseholdMember,
    Goal,
    Scenario,
    SimulationRun,          # sim cache keys reference wiped inputs
    SpendingCategory,
    ImportPreset,
    CategoryRule,
    Profile,
)


class ResetBody(BaseModel):
    mode: str
    confirm: str


@router.post("/admin/reset")
def admin_reset(body: ResetBody, db: Db, _: Authenticated):
    if body.mode not in ("demo", "empty"):
        raise ApiError(422, "validation_error", "mode must be demo or empty")
    if body.confirm != RESET_PHRASE:
        raise ApiError(
            422, "confirm_required",
            f'confirm must be exactly "{RESET_PHRASE}"',
        )

    # Backup FIRST — before any destructive statement. No-op (null) only on
    # a truly fresh install where the DB file is absent/empty.
    backup = pre_reset_backup()

    for model in FINANCIAL_TABLES:
        db.execute(delete(model))
    ensure_builtin_presets(db)

    if body.mode == "demo":
        seed_demo(db)
    else:
        # A single fresh self member with nulls + a defaults profile — the
        # app's exactly-one-self and profile-singleton invariants hold from
        # the first request after reset.
        db.add(
            HouseholdMember(
                name="You", role="self", birth_year=1980, life_expectancy=92,
                retirement_age=None, ss_monthly_at_fra=None, ss_claim_age=None,
            )
        )
        db.add(Profile())
    db.flush()

    return {"backup": backup.name if backup else None, "mode": body.mode}
