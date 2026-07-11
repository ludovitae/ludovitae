# Decision log (ADRs, newest first)

## 2026-07-10 — v1.1: household, spending profile, retirement timing

1. **Person-level data moves to HouseholdMember** (exactly one `self`);
   Profile keeps household-level assumptions. Accounts/flows gain optional
   owners. Migration synthesizes the self member from v1 profile data and must
   be sim-identical for single-member households (regression-tested).
2. **US rules, coarse but real**: SS claiming factors 62→0.70 … 70→1.24
   around FRA 67; RMDs at 73/75 (SECURE 2.0) via Uniform Lifetime Table,
   taxed at the effective rate. Tax brackets remain v2.
3. **Spending categories coexist with expense flows** (both count; UI makes
   the combined total visible) rather than a breaking migration. Observed
   spending is computed from transactions on demand, never stored.
4. **Milestones are an engine output** (not derived in the UI) so chart
   markers always agree with what the simulation actually did.

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
