# Decision log (ADRs, newest first)

## 2026-07-10 — Foundational decisions (owner + architect)

1. **Data ingestion is phased**: v1 manual + CSV/OFX, aggregator sync in v2
   behind `importers/base.SyncAdapter`. (Owner decision.)
2. **LAN access with password login**: argon2id, server-side sessions, CSRF,
   self-signed TLS, login throttling. Not internet-exposed. (Owner decision.)
3. **Stack**: Vite+React+TS / FastAPI+SQLite+numpy. Monte Carlo wants numpy;
   SQLite because single-user local-first. (Owner accepted recommendation.)
4. **Theming as A/B flag**: `fintech` default, `game` theme behind settings
   flag, token-swap not component fork. (Owner decision.)
5. **Money as Decimal/cents internally, float over JSON** — acceptable for a
   simulator (not a ledger of record); revisit if we ever do bookkeeping.
6. **Sync simulation endpoint** (no jobs/websockets) — 1000 paths of vectorized
   numpy is sub-second; complexity not warranted in v1.
7. **Branch-per-workstream, coordinator merges to main** — pre-Forgejo
   substitute for PRs; see coordination/PROTOCOL.md.
