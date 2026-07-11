# Decision log (ADRs, newest first)

## 2026-07-11 — PM nemesis review accepted (owner rulings)

Review: docs/reviews/2026-07-11-pm-nemesis.md. Owner rulings:
1. **Flow-CRUD hold reversed** (supersedes the transactions-first hold, not
   the philosophy): a minimal flow form ships in v1.2a — cold start needs
   income entered once; v1.3 inference calibrates against it.
2. **Resequencing accepted**: v1.2a (first real baseline: flow form, real
   institution exports vs importers, real-browser QA) then v1.2b (durability:
   pre-migration auto-backup, scheduled snapshots, export endpoint) before
   any v1.3 work. v1.2 analytics merges as built.
3. **Tax**: honesty pass now (taxable SS capped at 85%, chart assumptions
   strip, success probability to nearest 5%, in-app "what moved" notes) AND
   a bracket-aware tax workstream starts in parallel (standalone gol/tax
   module first; engine integration after the honesty pass lands). RSU
   withholding-gap dollars stay gated on brackets.
4. Game theme frozen as-is; no further AI-stub investment until a key exists.

## 2026-07-11 — Product principle: decision support, never decision making

Owner ruling, standing for all future features: the app must never make (or
appear to make) financial decisions for the owner — it surfaces options,
trade-offs, and dollar-quantified comparisons; the human decides. First
application: future sell-side optimization (see board) may highlight, on vest
day, that selling long-held company lots (LTCG) instead of freshly vested
shares (ordinary/STCG) could save $X — presented as a comparison, never a
recommendation queue, never an action button that executes anything. Wording
in UI should be "you could…" framing with assumptions shown, not "you should".

## 2026-07-11 — Transactions-first data philosophy (owner)

The ongoing data feed is frequent CSV/OFX transaction dumps plus occasional
balance snapshots — NOT hand-maintained flows. Consequences:
1. Flow-CRUD UI stays on hold; flows are slow-moving assumptions (set rarely),
   while transactions carry reality (salary changes, bonuses, RSU vests, ESPP).
2. Future direction (v1.3): income inference from transaction inflows —
   the mirror of v1.2's spending detectors — surfacing observed vs assumed
   income and flagging drift. Settings may carry informational "hints"
   (e.g. base salary) as calibration anchors, never as sim inputs.
3. Import UX priority rises: freshness warnings (v1.2) are load-bearing.

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
