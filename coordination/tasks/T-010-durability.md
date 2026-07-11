# T-010 — v1.2b: durability (backup, snapshots, export)

Owner: backend-dev agent · Branch: `ws/durability` · Status: todo
(HOLD until T-007 merges)

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
