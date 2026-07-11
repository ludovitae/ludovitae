# T-007 — Real spending, transfers, freshness, AI budget (backend)

Owner: backend-dev agent · Branch: `ws/spending-be` · Status: todo (HOLD —
fire after T-005/T-006 merge; branches from main including v1.1)

## Scope

Implement every v1.2 section of docs/API.md (binding) per the 2026-07-11
DECISIONS entries:

1. Migration: transaction `transfer_pair_id` + `category_source`, account
   freshness fields (`last_import_at`, `staleness_days`, `track_freshness`
   with type-based defaults), `category_rules`, `ai_settings` (key stored
   locally, never logged), `ai_usage` ledger.
2. Transfer auto-pairing on import (exact amount, opposite sign, ±4 days,
   cross-account) + candidates endpoint (scored near-misses: amount within
   1%, or window ±7 days) + pair/unpair endpoints. Pairing must be idempotent
   across re-imports (dedupe already prevents dup rows; pairing must not
   double-link).
3. Category rules CRUD + apply-on-import + retroactive apply (never
   overwrites manual). Heuristic categorizer (payee keyword map — ship a
   sensible built-in table incl. interest/fee detection for card accounts).
   `/categorize/suggest` heuristics-only per contract (AI stub).
4. Freshness computation per contract; dashboard `stale_accounts`.
5. Analytics: `/spending/summary`, `/spending/recurring` (cadence detection
   per contract tolerances), `/spending/hotspots`, `/spending/forecast`.
   All exclude transfer pairs. Pure-function core (no ORM) so QA can
   property-test detection.
6. AI budget admin: `/settings/ai` (write-only key, masked read),
   `/ai/usage`, ledger write helper + budget hard-stop helper that any future
   AI caller must use (raise 403 `ai_budget_exhausted`). Unit-test the helper
   even though no AI caller exists yet.
7. Seed: extend with a credit card + checking with realistic transactions —
   recurring subscriptions (one with a price increase), card payments that
   should auto-pair, an interest charge, stale vs fresh import dates.
8. Tests: pairing (auto/candidates/idempotent re-import), rules precedence,
   recurring detection (cadences, price change, active flag), hotspots math,
   freshness states, AI budget hard-stop, contract shapes. Keep 1000-path sim
   perf and all prior suites green.

## Acceptance criteria

- `uv run pytest` green, ruff clean; every v1.2 endpoint matches docs/API.md.
- Re-importing the same OFX twice: zero new rows, zero new pairs, stable ids.
- Seeded household: /spending/recurring finds the subscriptions,
  /transfers/candidates is empty (all card payments auto-paired), hotspots
  flags the price increase.

## Log

- 2026-07-11 (coordinator): task created; on hold until v1.1 merges.
