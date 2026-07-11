"""T-005 acceptance: a v1 database upgraded in place must simulate EXACTLY
like v1 did, when the household is just the migrated self member with the
same parameters (no RMD-eligible balances, claim age == old SS start age).

The golden JSON was recorded by running the same fixture data through the v1
engine (see tests/v1_fixture.py). A second fixture variant turns the
brokerage into a retirement account, where RMDs legitimately (and newly)
fire — covered as new behavior, not identity.
"""

from __future__ import annotations

import json
import pathlib
from dataclasses import replace

import pytest
from alembic import command
from alembic.config import Config as AlembicConfig
from sqlalchemy import select, text

from v1_fixture import N_PATHS, SEED, TODAY, V1_FIXTURE_SQL, apply_v1_fixture_sql

from gol import config
from gol.assembly import build_plan_inputs
from gol.db import get_engine, reset_engine, session_factory
from gol.models import HouseholdMember, SpendingCategory
from gol.sim import run_simulation

GOLDEN = json.loads(
    (pathlib.Path(__file__).parent / "fixtures" / "v1_identity_golden.json").read_text()
)


def _upgrade(revision: str) -> None:
    cfg = AlembicConfig()
    cfg.set_main_option("script_location", "gol:migrations")
    cfg.set_main_option("sqlalchemy.url", config.db_url())
    command.upgrade(cfg, revision)


@pytest.fixture()
def v1_data_dir(tmp_path, monkeypatch):
    monkeypatch.setenv("GOL_DATA_DIR", str(tmp_path / "data"))
    reset_engine()
    yield
    reset_engine()


@pytest.fixture()
def migrated_db(v1_data_dir):
    _upgrade("0001")  # the actual v1 schema
    apply_v1_fixture_sql(get_engine())
    _upgrade("head")  # the migration under test
    db = session_factory()()
    yield db
    db.close()


def test_migration_synthesizes_self_member(migrated_db):
    members = migrated_db.execute(select(HouseholdMember)).scalars().all()
    assert len(members) == 1
    m = members[0]
    assert (m.name, m.role) == ("You", "self")
    assert m.birth_year == 1979
    assert m.life_expectancy == 90
    assert m.retirement_age == 65
    assert m.ss_monthly_at_fra == 2_400.0  # claim age 67 -> factor 1.0, exact
    assert m.ss_claim_age == 67
    # person-level columns are gone from profile; the new target defaulted
    cols = {
        row[1]
        for row in migrated_db.execute(text("PRAGMA table_info(profile)")).all()
    }
    assert cols == {
        "id", "annual_retirement_spending", "inflation_pct",
        "effective_tax_rate_pct", "monthly_savings_target",
    }
    # ownership columns exist and are NULL for migrated rows
    owner = migrated_db.execute(text("SELECT member_id FROM accounts LIMIT 1")).scalar()
    assert owner is None


def test_migration_seeds_zero_amount_starter_category(migrated_db):
    cats = migrated_db.execute(select(SpendingCategory)).scalars().all()
    assert [(c.name, c.monthly_amount) for c in cats] == [("Everything else", 0.0)]


def test_migrated_db_simulates_identically_to_v1(migrated_db):
    """Exact tolerance: every number the v1 engine produced, reproduced."""
    inputs = build_plan_inputs(migrated_db, params=None, today=TODAY)
    result = run_simulation(inputs, n_paths=N_PATHS, seed=SEED)
    milestones = result.pop("milestones")  # additive in v1.1
    assert result == GOLDEN
    # milestones reflect the migrated member; no RMDs (no tax-deferred money)
    assert [(m["kind"], m["age"], m["member_id"]) for m in milestones] == [
        ("retirement", 65, 1),
        ("ss_start", 67, 1),
    ]
    assert milestones[0]["label"] == "You retires"
    assert milestones[1]["label"] == "You claims Social Security (100% of FRA)"


def test_migrated_db_with_retirement_account_newly_fires_rmds(v1_data_dir):
    """Same v1 database, but the invested balance sits in a retirement-type
    account: RMDs (born 1979 -> 1960+, start 75) are NEW v1.1 behavior.
    Numbers legitimately move; assert the forced distributions happen."""
    _upgrade("0001")
    engine = get_engine()
    with engine.begin() as conn:
        for stmt in V1_FIXTURE_SQL:
            conn.execute(text(stmt.replace("'brokerage'", "'retirement'")))
    _upgrade("head")
    db = session_factory()()
    try:
        inputs = build_plan_inputs(db, params=None, today=TODAY)
        assert inputs.members[0].tax_deferred0 == 300_000.0
        result = run_simulation(inputs, n_paths=N_PATHS, seed=SEED)
    finally:
        db.close()
    rmd = [m for m in result["milestones"] if m["kind"] == "rmd_start"]
    assert rmd == [{
        "age": 75, "year": 2054, "kind": "rmd_start",
        "label": "RMDs begin for You", "member_id": 1,
    }]
    # RMD drag: with the same plan but no tax-deferred balance (RMDs cannot
    # fire; the withdrawal-tax knob is unchanged), ending net worth must be
    # at least as high — forced taxed distributions only cost money.
    no_td_inputs = replace(
        inputs, members=(replace(inputs.members[0], tax_deferred0=0.0),)
    )
    no_td = run_simulation(no_td_inputs, n_paths=N_PATHS, seed=SEED)
    assert (result["deterministic"]["net_worth"][-1]
            < no_td["deterministic"]["net_worth"][-1])
    # the comparison plan still RMDs the balance built by its retirement
    # contributions — tax-deferral follows the money, not just t0 balances
    assert any(m["kind"] == "rmd_start" for m in no_td["milestones"])
