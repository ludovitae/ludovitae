"""T-010 durability: pre-migration backups, daily snapshots, GET /export.

Backup tests drive the real run_migrations() path against a v1-schema DB
(reusing the T-005 fixture); snapshot tests call the snapshot function with an
injected date instead of a clock. Export tests assert completeness against a
seeded DB and that the AI API key never leaves the server.
"""

from __future__ import annotations

import datetime as dt
import os
import sqlite3
import stat
import time

import pytest
from alembic import command
from alembic.config import Config as AlembicConfig
from sqlalchemy import func, select

from gol import config
from gol.backup import (
    DAILY_KEEP,
    PRE_MIGRATION_KEEP,
    backups_dir,
    daily_snapshot,
    pre_migration_backup,
    safe_daily_snapshot,
)
from gol.db import Base, reset_engine, run_migrations, session_factory
from gol.models import AiSettings
from gol.seed import seed
from v1_fixture import apply_v1_fixture_sql


def _upgrade(revision: str) -> None:
    cfg = AlembicConfig()
    cfg.set_main_option("script_location", "gol:migrations")
    cfg.set_main_option("sqlalchemy.url", config.db_url())
    command.upgrade(cfg, revision)


def _mode(path) -> int:
    return stat.S_IMODE(path.stat().st_mode)


def _fake_backup(name: str, mtime: float) -> None:
    path = backups_dir() / name
    path.write_bytes(b"fake")
    os.utime(path, (mtime, mtime))


@pytest.fixture()
def data_dir(tmp_path, monkeypatch):
    monkeypatch.setenv("GOL_DATA_DIR", str(tmp_path / "data"))
    reset_engine()
    yield tmp_path / "data"
    reset_engine()


@pytest.fixture()
def v1_db(data_dir):
    """A non-empty database at the v1 schema (revision 0001)."""
    _upgrade("0001")
    from gol.db import get_engine

    apply_v1_fixture_sql(get_engine())
    reset_engine()  # no app connection open when the backup runs
    return data_dir


# --- pre-migration backup ----------------------------------------------------


def test_pre_migration_backup_created_by_run_migrations(v1_db):
    run_migrations()

    backups = list(backups_dir().glob("pre-migration-0001-*.db"))
    assert len(backups) == 1
    backup = backups[0]
    assert _mode(backup) == 0o600
    assert _mode(backups_dir()) == 0o700

    # the backup is the PRE-upgrade database: stamped 0001, with the fixture
    # data and the old profile columns the v1.1 migration drops
    with sqlite3.connect(backup) as conn:
        assert conn.execute("SELECT version_num FROM alembic_version").fetchone() == ("0001",)
        assert conn.execute("SELECT count(*) FROM accounts").fetchone()[0] > 0
        profile_cols = {r[1] for r in conn.execute("PRAGMA table_info(profile)")}
        assert "birth_year" in profile_cols
    # while the live DB moved to head
    with sqlite3.connect(config.db_path()) as conn:
        assert conn.execute("SELECT version_num FROM alembic_version").fetchone() == ("0004",)


def test_pre_migration_backup_skips_fresh_and_at_head_dbs(data_dir):
    # fresh (no DB file yet): nothing to back up
    run_migrations()
    assert list(backups_dir().glob("pre-migration-*.db")) == []
    # already at head: upgrade would no-op, so no backup either
    run_migrations()
    assert list(backups_dir().glob("pre-migration-*.db")) == []


def test_pre_migration_backup_rotation_keeps_newest_five(v1_db):
    now = time.time()
    for i in range(PRE_MIGRATION_KEEP):
        _fake_backup(f"pre-migration-0000-old{i}.db", now - 1000 + i)

    assert pre_migration_backup() is not None

    remaining = sorted(p.name for p in backups_dir().glob("pre-migration-*.db"))
    assert len(remaining) == PRE_MIGRATION_KEEP
    assert "pre-migration-0000-old0.db" not in remaining  # oldest rotated out
    assert any(name.startswith("pre-migration-0001-") for name in remaining)


def test_pre_migration_backup_never_leaves_tmp_files(v1_db):
    pre_migration_backup()
    assert list(backups_dir().glob("*.tmp")) == []


# --- daily snapshots ---------------------------------------------------------


def test_daily_snapshot_creates_then_skips_same_day(data_dir):
    run_migrations()
    day = dt.date(2026, 7, 11)

    created = daily_snapshot(today=day)
    assert created == backups_dir() / "daily-2026-07-11.db"
    assert _mode(created) == 0o600
    first_mtime = created.stat().st_mtime_ns

    # same day again: skipped, existing file untouched
    assert daily_snapshot(today=day) is None
    assert created.stat().st_mtime_ns == first_mtime

    # next day: a second snapshot
    assert daily_snapshot(today=dt.date(2026, 7, 12)) is not None
    assert len(list(backups_dir().glob("daily-*.db"))) == 2


def test_daily_snapshot_skips_missing_db(data_dir):
    assert daily_snapshot(today=dt.date(2026, 7, 11)) is None
    assert list(backups_dir().glob("daily-*.db")) == []


def test_daily_snapshot_rotation_keeps_newest_fourteen(data_dir):
    run_migrations()
    now = time.time()
    for i in range(DAILY_KEEP):
        _fake_backup(f"daily-2026-06-{i + 1:02d}.db", now - 1000 + i)

    daily_snapshot(today=dt.date(2026, 7, 11))

    remaining = sorted(p.name for p in backups_dir().glob("daily-*.db"))
    assert len(remaining) == DAILY_KEEP
    assert "daily-2026-06-01.db" not in remaining
    assert "daily-2026-07-11.db" in remaining


def test_safe_daily_snapshot_never_raises(data_dir, monkeypatch, caplog):
    def boom() -> None:
        raise RuntimeError("disk full")

    monkeypatch.setattr("gol.backup.daily_snapshot", boom)
    safe_daily_snapshot()  # must not raise
    assert any(
        "daily snapshot failed" in rec.message and rec.levelname == "WARNING"
        for rec in caplog.records
    )


def test_startup_snapshot_runs_via_lifespan(client):
    """The lifespan's background task snapshots the freshly-migrated DB."""
    deadline = time.time() + 5
    while time.time() < deadline:
        if list((config.data_dir() / "backups").glob("daily-*.db")):
            break
        time.sleep(0.05)
    snapshots = list((config.data_dir() / "backups").glob("daily-*.db"))
    assert len(snapshots) == 1
    assert snapshots[0].name == f"daily-{dt.datetime.now(dt.UTC).date().isoformat()}.db"


# --- GET /export -------------------------------------------------------------


def test_export_contains_every_table_with_matching_row_counts(authed):
    seed(force=True)
    db = session_factory()()
    try:
        resp = authed.get("/api/v1/export")
        assert resp.status_code == 200
        doc = resp.json()

        assert doc["format"] == "gol-export"
        assert doc["schema_version"] == "0004"
        assert doc["exported_at"].endswith("Z")

        assert set(doc["tables"]) == set(Base.metadata.tables)
        assert "alembic_version" not in doc["tables"]
        for name in Base.metadata.tables:
            count = db.execute(
                select(func.count()).select_from(Base.metadata.tables[name])
            ).scalar()
            assert len(doc["tables"][name]) == count, name
        # the seed left real data behind — this is not an empty-export pass
        assert len(doc["tables"]["transactions"]) > 0
        assert len(doc["tables"]["accounts"]) > 0
    finally:
        db.close()


def test_export_money_is_dollars_and_download_headers_set(authed):
    acc = authed.post("/api/v1/accounts", json={"name": "Chk", "type": "checking"}).json()
    authed.post(
        f"/api/v1/accounts/{acc['id']}/balances",
        json={"date": "2026-07-01", "amount": 1234.56},
    )
    resp = authed.get("/api/v1/export")
    assert resp.headers["content-type"].startswith("application/json")
    assert 'attachment; filename="gol-export-' in resp.headers["content-disposition"]
    snapshots = resp.json()["tables"]["balance_snapshots"]
    # account creation writes an initial 0.0 snapshot; ours is the second
    posted = [s for s in snapshots if s["date"] == "2026-07-01"]
    assert [s["amount"] for s in posted] == [1234.56]  # cents in DB, dollars out


def test_export_never_contains_the_ai_api_key(authed):
    secret = "sk-secret-abcdef123456"
    resp = authed.put("/api/v1/settings/ai", json={"api_key": secret, "enabled": True})
    assert resp.status_code == 200 and resp.json()["has_api_key"] is True

    resp = authed.get("/api/v1/export")
    assert resp.status_code == 200
    assert secret not in resp.text
    (row,) = resp.json()["tables"]["ai_settings"]
    assert row["api_key"] is None  # column present in the shape, value redacted
    assert row["enabled"] is True

    # and the redaction is export-only: the DB still holds the key
    db = session_factory()()
    try:
        assert db.execute(select(AiSettings)).scalar_one().api_key == secret
    finally:
        db.close()
