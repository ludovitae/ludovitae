"""POST /simulate and POST /scenarios/compare."""

from __future__ import annotations

import hashlib
import json
import secrets

from fastapi import APIRouter
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session as DbSession

from gol import ENGINE_NOTES, ENGINE_VERSION
from gol.api.common import Db, get_or_404
from gol.api.scenarios import BASELINE, ScenarioParams, validate_event
from gol.assembly import build_plan_inputs
from gol.auth.deps import Authenticated
from gol.errors import ApiError
from gol.models import Scenario, SimulationRun
from gol.sim import SS_TAXABLE_SHARE, PlanInputs, run_simulation

router = APIRouter(tags=["simulate"])

MAX_PATHS = 10_000


class SimulateBody(BaseModel):
    scenario_id: int | None = None
    params: ScenarioParams | None = None
    n_paths: int = Field(default=1000, ge=1, le=MAX_PATHS)
    seed: int | None = Field(default=None, ge=0)


class CompareBody(BaseModel):
    scenario_ids: list[int] = Field(min_length=1, max_length=10)
    n_paths: int = Field(default=1000, ge=1, le=MAX_PATHS)
    seed: int | None = Field(default=None, ge=0)


def _resolve_params(db: DbSession, scenario_id: int) -> dict:
    if scenario_id == 0:
        return {}
    return get_or_404(db, Scenario, scenario_id, "scenario_not_found").params or {}


def _assumptions(inputs: PlanInputs) -> dict:
    """Model assumptions the simulation actually ran with (from the resolved
    PlanInputs — scenario overrides included — never re-read from the DB)."""
    m = inputs.market
    return {
        "market": {
            "stocks_mean_pct": m.stocks_mean_pct, "stocks_vol_pct": m.stocks_vol_pct,
            "bonds_mean_pct": m.bonds_mean_pct, "bonds_vol_pct": m.bonds_vol_pct,
            "cash_mean_pct": m.cash_mean_pct, "cash_vol_pct": m.cash_vol_pct,
        },
        "inflation_pct": inputs.inflation_mean_pct,
        "effective_tax_rate_pct": inputs.effective_tax_rate_pct,
        "ss_taxable_share": SS_TAXABLE_SHARE,
        "engine_version": ENGINE_VERSION,
    }


def _run_cached(db: DbSession, params: dict, n_paths: int, seed: int) -> dict:
    inputs = build_plan_inputs(db, params)
    key_material = json.dumps(
        {"inputs": inputs.to_dict(), "n_paths": n_paths, "seed": seed, "v": ENGINE_VERSION},
        sort_keys=True, default=str,
    )
    cache_key = hashlib.sha256(key_material.encode()).hexdigest()
    cached = db.execute(
        select(SimulationRun).where(SimulationRun.cache_key == cache_key)
    ).scalar_one_or_none()
    if cached is not None:
        return cached.result
    result = {
        "engine_version": ENGINE_VERSION,
        "engine_notes": list(ENGINE_NOTES),
        "assumptions": _assumptions(inputs),
        **run_simulation(inputs, n_paths, seed),
    }
    db.add(
        SimulationRun(
            cache_key=cache_key, engine_version=ENGINE_VERSION,
            seed=seed, n_paths=n_paths, result=result,
        )
    )
    db.flush()
    return result


@router.post("/simulate")
def simulate(body: SimulateBody, db: Db, _: Authenticated):
    if body.scenario_id is not None and body.params is not None:
        raise ApiError(400, "bad_request", "provide either scenario_id or params, not both")
    if body.params is not None:
        for ev in body.params.events or []:
            validate_event(ev)
        params = body.params.model_dump(exclude_none=True)
    else:
        params = _resolve_params(db, body.scenario_id if body.scenario_id is not None else 0)
    seed = body.seed if body.seed is not None else secrets.randbits(32)
    return _run_cached(db, params, body.n_paths, seed)


@router.post("/scenarios/compare")
def compare(body: CompareBody, db: Db, _: Authenticated):
    seed = body.seed if body.seed is not None else secrets.randbits(32)
    results = []
    for scenario_id in body.scenario_ids:
        if scenario_id == 0:
            name, params = BASELINE["name"], {}
        else:
            scn = get_or_404(db, Scenario, scenario_id, "scenario_not_found")
            name, params = scn.name, scn.params or {}
        result = _run_cached(db, params, body.n_paths, seed)
        results.append({"scenario_id": scenario_id, "name": name, **result})
    return {"results": results}
