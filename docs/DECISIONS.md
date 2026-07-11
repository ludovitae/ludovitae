# Decision log (ADRs, newest first)

## 2026-07-11 — v1.2: real spending, credit cards, freshness, AI budget

1. **Credit cards without double-entry pain** (owner-approved): spending
   counts at the card swipe; checking→card payments auto-pair as transfers
   and vanish from analytics; interest/fees are real spending; grace periods
   are a cash-flow-timing concern already covered by balance snapshots — no
   statement-cycle modeling.
2. **Transfer pairing**: confident matches (exact amount, opposite sign,
   ±4 days) link silently; near-misses go to a review queue. (Owner chose
   auto-pair over review-everything.)
3. **Categorization is layered**: manual > rules > heuristics > AI. AI is
   **stubbed** in v1.2 (owner decision — nothing leaves the machine yet), but
   the endpoint shape, review flow, and the AI **budget ledger + admin panel**
   ship now so a Claude API key can be added later with spend caps already
   enforced (hard-stop 403 at monthly budget).
4. Staleness warnings are in-app only (badges + dashboard strip), threshold
   35 days default, per-account override, off for non-transactional types.

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
