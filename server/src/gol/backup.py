"""T-010 durability: local backups of the SQLite database.

Two producers write into ``data/backups/`` (dir 0700, files 0600):

- **Pre-migration backups** (``pre-migration-<schema>-<utc-ts>.db``): taken by
  :func:`pre_migration_backup` immediately before Alembic upgrades a non-empty
  database that is not already at head. Keep newest 5.
- **Daily snapshots** (``daily-<utc-date>.db``): taken by
  :func:`safe_daily_snapshot` on app startup and every 24h while the server
  runs (see gol.main lifespan). Skipped when today's snapshot already exists.
  Keep newest 14. Snapshot failures must never crash the app — they log a
  warning that carries no financial data.

Both use the stdlib ``sqlite3`` ``Connection.backup()`` API rather than a raw
file copy: it produces a consistent snapshot even if another connection is
mid-transaction, so we don't have to rely on startup ordering for correctness
(although at the pre-migration call site the app engine has not connected
yet). The backup is written to a temp file in the same directory and
``os.replace``d into place, so a crash mid-backup never leaves a truncated
``.db`` behind.

Restore is intentionally manual in this phase: stop the server, replace
``data/gol.db`` with the chosen backup, restart (see README "Backups &
restore").
"""

from __future__ import annotations

import datetime as dt
import logging
import os
import sqlite3
from pathlib import Path

from gol import config

log = logging.getLogger(__name__)

PRE_MIGRATION_KEEP = 5
DAILY_KEEP = 14


def backups_dir() -> Path:
    path = config.data_dir() / "backups"
    path.mkdir(mode=0o700, exist_ok=True)
    return path


def _sqlite_backup(src: Path, dest: Path) -> None:
    """Consistent point-in-time copy of ``src`` into ``dest`` (0600, atomic)."""
    tmp = dest.with_name(dest.name + ".tmp")
    try:
        with sqlite3.connect(src) as source, sqlite3.connect(tmp) as target:
            os.chmod(tmp, 0o600)  # before any data lands in the file
            source.backup(target)
        os.replace(tmp, dest)
    finally:
        tmp.unlink(missing_ok=True)


def _rotate(prefix: str, keep: int) -> None:
    """Delete all but the ``keep`` most-recently-modified ``<prefix>*.db``."""
    matches = sorted(
        backups_dir().glob(f"{prefix}*.db"),
        key=lambda p: p.stat().st_mtime,
        reverse=True,
    )
    for stale in matches[keep:]:
        stale.unlink(missing_ok=True)


def _current_schema_revision(db_file: Path) -> str | None:
    """The alembic revision stamped in the DB, or None when unstamped."""
    with sqlite3.connect(db_file) as conn:
        row = conn.execute(
            "SELECT name FROM sqlite_master"
            " WHERE type = 'table' AND name = 'alembic_version'"
        ).fetchone()
        if row is None:
            return None
        version = conn.execute("SELECT version_num FROM alembic_version").fetchone()
        return version[0] if version else None


def _head_revision() -> str:
    from alembic.config import Config as AlembicConfig
    from alembic.script import ScriptDirectory

    cfg = AlembicConfig()
    cfg.set_main_option("script_location", "gol:migrations")
    return ScriptDirectory.from_config(cfg).get_current_head() or ""


def pre_migration_backup() -> Path | None:
    """Back up the DB if Alembic is about to change it. Returns the backup path.

    Skips (returns None) when the DB file is absent or empty (a fresh install:
    nothing to lose) and when it is already stamped at head (upgrade will
    no-op). An unstamped-but-non-empty DB is backed up as ``unstamped``.
    """
    db_file = config.db_path()
    if not db_file.exists() or db_file.stat().st_size == 0:
        return None
    current = _current_schema_revision(db_file)
    if current == _head_revision():
        return None
    stamp = dt.datetime.now(dt.UTC).strftime("%Y%m%dT%H%M%SZ")
    dest = backups_dir() / f"pre-migration-{current or 'unstamped'}-{stamp}.db"
    _sqlite_backup(db_file, dest)
    _rotate("pre-migration-", PRE_MIGRATION_KEEP)
    return dest


def daily_snapshot(today: dt.date | None = None) -> Path | None:
    """Snapshot the DB to ``daily-<utc-date>.db`` unless today's exists."""
    db_file = config.db_path()
    if not db_file.exists() or db_file.stat().st_size == 0:
        return None
    date = today or dt.datetime.now(dt.UTC).date()
    dest = backups_dir() / f"daily-{date.isoformat()}.db"
    if dest.exists():
        return None
    _sqlite_backup(db_file, dest)
    _rotate("daily-", DAILY_KEEP)
    return dest


def safe_daily_snapshot() -> None:
    """`daily_snapshot` for the background loop: log-and-continue on failure.

    The warning deliberately names only the exception type/args — never file
    contents — and backup paths contain no financial data.
    """
    try:
        daily_snapshot()
    except Exception as exc:  # noqa: BLE001 — durability must not kill the app
        log.warning("daily snapshot failed: %s", exc)
