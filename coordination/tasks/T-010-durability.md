# T-010 — v1.2b: durability (backup, snapshots, export)

Owner: backend-dev agent · Branch: `ws/durability` · Status: review

## Scope (PM review finding 5)

1. **Pre-migration auto-backup**: before Alembic runs at startup, copy the DB
   to `data/backups/pre-migration-<schema>-<ts>.db` (0600), keep last N=5.
2. **Scheduled snapshots**: `sqlite3 .backup`-equivalent (Python API) on
   server start + every 24h while running; `data/backups/daily-*.db`, keep 14.
   Document restore (one paragraph in README).
3. **Full-fidelity export**: `GET /export` → single JSON of every table
   (schema-versioned envelope); `POST /import/restore` deferred — document
   that restore = replace the DB file (with the exact steps).
4. Backups excluded from git (data/ already ignored); assert 0600 perms.
5. Tests: backup created before a migration runs, rotation caps respected,
   export round-trips through a fresh DB comparison (import via SQL, compare
   dumps), export requires auth + excludes ai_settings.api_key.

## Log

- 2026-07-11 (coordinator): created per accepted PM-review resequencing.
- 2026-07-11 (backend-dev): implemented on `ws/durability`; 279 → 291 server
  tests, ruff clean. Decisions and deviations:
  - **Backup mechanism**: stdlib `sqlite3` `Connection.backup()` for both
    pre-migration backups and daily snapshots (not file copy). It yields a
    consistent point-in-time copy even if another connection is open, so
    correctness doesn't hinge on startup ordering — though at the
    pre-migration call site (top of `run_migrations()`, before Alembic and
    before the app engine ever connects) no connection exists anyway. Backups
    write to a `.tmp` sibling then `os.replace`, so a crash mid-backup can't
    leave a truncated `.db`.
  - **Pre-migration skip rules**: no DB file / zero-byte file (fresh install)
    and DB already stamped at alembic head both skip. A non-empty DB with no
    `alembic_version` table is backed up as `pre-migration-unstamped-<ts>.db`.
    Rotation by mtime, newest 5 kept (daily: newest 14).
  - **Snapshot loop**: asyncio task started in the lifespan after
    `run_migrations()`; runs `safe_daily_snapshot` (catches *all* exceptions,
    logs a warning naming only the exception — no financial data, and backup
    paths contain none) once at startup, then every 24h; cancelled cleanly at
    shutdown. Same-UTC-date snapshot already present → skip.
  - **Export via ORM, not raw SQL**: rows are read through the mappers so
    `Money` columns serialize as dollars-floats per the API convention (raw
    SQL would have leaked integer cents). Tables sorted by name, rows by
    primary key. `ai_settings.api_key` is exported as the *column present,
    value null* (shape-stable for a future importer; test asserts the secret
    never appears anywhere in the response body).
  - **Streaming**: response is a `StreamingResponse` encoded table-by-table,
    but rows are materialized inside the route — FastAPI ≥0.106 closes
    yield-dependencies (the DB session) before the stream body is consumed.
  - **Additive header** (flagging, not drifting): export sets
    `Content-Disposition: attachment; filename="gol-export-<date>.json"` so a
    browser hit saves a file. Coordinator: drop it if unwanted; it's one line.
  - `POST /import/restore` deferred per scope; restore documented in README
    ("Backups & restore") as stop server → replace `data/gol.db` → restart.
  - Item 4 verified rather than changed: `.gitignore` already ignores `data/`
    and `*.db`; tests assert 0600 on backup files and 0700 on `data/backups/`.
  - **Test deviation (item 5)**: the export test verifies completeness as
    every-ORM-table-present + per-table row counts matching a seeded DB +
    value spot-checks (money in dollars, dates ISO), per the launch brief —
    not the task file's "import via SQL, compare dumps" round-trip. A dump
    diff belongs with the deferred `POST /import/restore`; flagging so the
    coordinator can require it now if wanted.

### Export shape (for docs/API.md codification — coordinator)

`GET /export` (auth required; 401 unauthenticated as everywhere) →
`200 application/json`, header
`Content-Disposition: attachment; filename="gol-export-<YYYY-MM-DD>.json"`:

```json
{
  "format": "gol-export",
  "schema_version": "0004",
  "exported_at": "2026-07-11T21:04:05Z",
  "tables": {
    "<table_name>": [ { "<column>": <value>, ... }, ... ],
    ...
  }
}
```

- `schema_version` is the alembic head revision the server is running.
- `tables` holds **every** ORM table (17 as of 0004), sorted by name, rows
  ordered by primary key; `alembic_version` internals excluded.
- Values follow API conventions: money = dollars (float), dates
  `YYYY-MM-DD`, datetimes ISO-8601 (naive UTC), JSON columns inline.
- `ai_settings[].api_key` is always `null` — the key never leaves the server.
