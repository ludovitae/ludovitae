# T-007 — Real spending, transfers, freshness, AI budget (backend)

Owner: backend-dev agent · Branch: `ws/spending-be` · Status: review

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
- 2026-07-11 (backend-dev): implementation complete on `ws/spending-be`;
  status → review. 214 server tests green (162 baseline preserved — only
  test_api_contract moved, by contract ADDITION: account/transaction/
  dashboard specs gained the v1.2 fields and the walk now covers every v1.2
  endpoint), ruff clean, server boots; seeded DB smoke-checked over HTTP
  (candidates empty, Netflix hike flagged, savings stale). Decisions below.
- 2026-07-11 (backend-dev): pairing design — auto-pair is greedy
  oldest-first over (date, id) among UNPAIRED rows only, exact integer-cents
  amount, opposite sign, cross-account, ±4 days; closest-by-date (then
  lowest id) counterpart wins, so results are order-independent. Pair id =
  the smaller transaction id (stable across re-imports because dedupe keeps
  ids stable). Pairing runs after every import commit over the whole
  unpaired set, so legs arriving in separate imports still pair.
  Idempotency pinned by test (re-import: 0 rows, 0 pairs, identical ids).
  KNOWN LIMITATION: manual unpair of a confident match will re-pair on the
  next import — the contract has no "never pair" tombstone; flagging rather
  than inventing one.
- 2026-07-11 (backend-dev): candidates — near-miss = cross-account,
  opposite sign, amount within 1% AND within ±7 days (both auto-pair bounds
  relaxed; the contract's "within 1% OR ±7 days" read as naming the two
  relaxations). Score (documented in gol/analytics/transfers.py) =
  0.6·amount-closeness + 0.4·date-closeness, each linear to the tolerance
  edge; each transaction appears in at most one candidate (greedy by score).
- 2026-07-11 (backend-dev): categorization — file-supplied CSV categories
  are stored as category_source="manual" (the user chose the mapping;
  rules must never clobber them); migration 0003 backfills existing
  categorized rows the same way. /rules/apply touches only sources
  none/rule/heuristic and never clears a category when a rule was deleted.
  Heuristic table matches on word boundaries ("coffee" never trips "fee",
  "pinterest" never trips "interest"); on credit_card imports the bare
  words interest/fee(s) auto-categorize as interest-fees per DECISIONS #1.
- 2026-07-11 (backend-dev): /spending/observed now excludes transfer-paired
  rows; the v1.1 category=="transfer" heuristic REMAINS as a fallback for
  one-sided transfers whose counterpart account was never imported (e.g. the
  seeded "Transfer to Vanguard" — brokerage has no transaction feed). All
  v1.2 analytics apply both exclusions. No observed-spending test
  expectations changed.
- 2026-07-11 (backend-dev): freshness — reference date is last_import_at,
  falling back to newest transaction date (manually-seeded data isn't
  "never"); aging when 3·days ≥ 2·threshold, stale strictly past threshold.
  track_freshness/staleness_days are PATCHable; changing an account's type
  later does not flip an explicit track_freshness choice (type default is
  creation-time only). "never" accounts stay out of dashboard
  stale_accounts (aging+stale only, oldest first).
- 2026-07-11 (backend-dev): analytics tunables where the contract is
  qualitative (constants at top of gol/api/spending_analytics.py):
  category_spikes = recent ≥ baseline+20% with baseline ≥ $20/mo (equal
  windows of N full months, current partial month excluded);
  price_increases = active recurring with hike ≥ 5%; possibly_forgotten =
  active, relative stdev ≤ 5%, running ≥ 365 days; top_merchants = top 10 by
  monthly avg (payees grouped after store-number normalization).
  /spending/summary defaults to trailing 12 months incl. current; only
  group_by=month exists (422 otherwise).
- 2026-07-11 (backend-dev): forecast shape pinned (contract says "[...]"):
  months = next N calendar months; recurring + total are arrays parallel to
  months; variable_by_category = [{category, monthly_avg}] from a 6-full-
  month lookback excluding detected-recurring payees; weekly/monthly
  charges project at their monthly equivalent, annual as a lump in the
  anniversary month. T-008 must read this entry (or the module docstring)
  for the exact fields.
- 2026-07-11 (backend-dev): AI budget — key stored plaintext in the local
  chmod-0600 DB (encryption-at-rest deemed overkill for a LAN single-user
  DB; per task guidance), never logged, never echoed (contract walk asserts
  the raw key is absent from the PUT response). Guard raises 403
  ai_budget_exhausted when spend_this_month + projected > budget (a call
  landing exactly on budget is allowed). /ai/usage returns the N most
  recent months that have ledger rows, newest first. /categorize/suggest
  is heuristics-only and writes no ledger rows.
- 2026-07-11 (backend-dev): CONTRACT CHOICES where docs/API.md is silent
  (flagging for ruling/T-008 alignment, happy to change any):
  (1) POST /transfers/pair returns 200 with the two updated legs (read the
  endpoint as an update of existing rows, not a create — the "POST creates
  → 201" convention wasn't applied); errors: 404 transaction_not_found,
  409 already_paired, 404 pair_not_found on unpair, 422 for same-account /
  same-sign / duplicate ids. Manual pairing does NOT require exact amounts
  (it exists to confirm near-misses).
  (2) POST /transactions/categorize → {updated: n}; unknown ids → 404
  transaction_not_found (nothing applied).
  (3) /categorize/suggest returns an entry per requested payee, category
  null + confidence 0.0 when nothing matches (keeps the response positional).
  (4) Recurring detection is by-the-letter, so a steady weekly grocery
  habit IS reported as recurring (seed's Green Basket, weekly, ~$900/mo
  equivalent). Contract-conformant; UI may want to group cadences.
- 2026-07-11 (backend-dev): tests — 214 total (was 162): +20 pure analytics
  (gol/analytics importable without app/DB for QA property tests), +14
  transfers, +14 rules/layering, +4 freshness, +4 AI budget/ledger, +5
  analytics endpoints, +5 seed acceptance; contract walk + 401 sweep
  extended in place. Sim/golden/migration suites untouched and green.
