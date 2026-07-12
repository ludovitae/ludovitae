# API contract — /api/v1

This is the binding contract between `server/` and `web/`. Both sides implement
it exactly; changes go through the coordinator and are recorded here first.

Conventions: JSON everywhere; dates are `YYYY-MM-DD`; money is a decimal number
of dollars (float in JSON, Decimal/cents internally); ids are integers.
Errors: `{"error": {"code": "string_code", "message": "human text"}}` with an
appropriate HTTP status. Unauthenticated → 401. Missing CSRF on mutation → 403
`csrf_required`. All list endpoints return plain JSON arrays (no envelope).
POST creates return **201**. Every mutating route requires `X-CSRF-Token`,
**including `/auth/logout`** (only `/auth/setup` and `/auth/login` are exempt —
no session exists yet). `POST /accounts/{id}/balances` body: `{date, amount}`.
CSV preview `sample_rows`: list of `{column: value}` objects.

## Auth

| Method | Path | Body → Response |
|---|---|---|
| GET | `/auth/session` | → `{authenticated: bool, setup_required: bool}` (no auth needed) |
| POST | `/auth/setup` | `{password}` → 204. Only when no password exists yet. Min 10 chars. |
| POST | `/auth/login` | `{password}` → `{csrf_token}`; sets session cookie. 429 + `Retry-After` when throttled. |
| POST | `/auth/logout` | → 204 |

After login, the CSRF token is also readable via `GET /auth/session` →
`{..., csrf_token}` when authenticated. Send it as `X-CSRF-Token` on every
POST/PATCH/PUT/DELETE.

## Profile (singleton — household-level assumptions only, v1.1)

`GET /profile` / `PUT /profile`

```json
{
  "annual_retirement_spending": 80000, "inflation_pct": 2.5,
  "effective_tax_rate_pct": null
}
```

Person-level fields (birth_year, retirement_age, life_expectancy, social
security) moved to household members in v1.1. Migration creates member 1
("You", role `self`) from the old profile columns.

v1.2.2 (T-012 phase 2): `effective_tax_rate_pct` is a **nullable flat-rate
override** (`null | 0..100`). A value runs the flat-rate tax engine exactly
as before; `null` (also the PUT default when omitted) runs the bracket-aware
federal model. Fresh profiles default to `null`; migration keeps existing
profiles' stored value so upgraded databases simulate identically until the
owner clears the override.

## Household members (v1.1)

`GET/POST /household`, `GET/PATCH/DELETE /household/{id}`

```json
{
  "id": 1, "name": "Brian", "role": "self",
  "birth_year": 1980, "life_expectancy": 92,
  "retirement_age": 65,
  "ss_monthly_at_fra": 2200, "ss_claim_age": 67,
  "notes": ""
}
```

`role`: `self|partner|child|other`. `retirement_age`, `ss_monthly_at_fra`,
`ss_claim_age` nullable (children/non-earners). `ss_claim_age` 62–70; the
benefit is adjusted from the FRA amount with standard actuarial factors
(62→0.70 … 67→1.00 … 70→1.24, per-year linear steps; FRA fixed at 67).
Exactly one `self` member must exist; it cannot be deleted (403
`self_member_undeletable`; duplicate self → 409 `self_member_exists`; role
change off self → 409 `self_role_immutable`).
The simulation horizon runs to the latest life expectancy among **adult
members** (roles `self|partner|other`); `child` members never extend the
horizon (coordinator ruling 2026-07-11, flagged by both dev agents).
Retirement-spending transition: household `annual_retirement_spending` takes
over (and generic expenses stop) when the LAST member with a retirement_age
retires; each member's own income stops at their own retirement age.
RMDs: members with tax-deferred (`retirement`-type) accounts take forced
annual distributions starting at 73 (born before 1960) or 75 (born 1960+),
amount = balance / Uniform-Lifetime-Table divisor, taxed at the effective rate.

Ownership: `Account` and `Flow` gain nullable `member_id`. An income flow with
`ends_at_retirement` stops at its owner's retirement age (unowned income uses
the last-retirement age). Retirement-type accounts should be owned; unowned
tax-deferred balances use the `self` member for RMD timing.

## Accounts

`GET/POST /accounts`, `GET/PATCH/DELETE /accounts/{id}`

```json
{
  "id": 1, "name": "Vanguard Brokerage", "type": "brokerage",
  "institution": "Vanguard", "balance": 250000.0,
  "growth_rate_pct": null, "asset_class": "stocks",
  "member_id": 1, "tax_treatment": null,
  "include_in_net_worth": true, "notes": "", "created_at": "2026-07-10",
  "external_account_masked": "···1234"
}
```

`tax_treatment` (v1.3, #25): how the account is taxed in the simulation —
`tax_deferred | roth | taxable | hsa`, or `null` to derive the treatment from
`type` (`retirement`→tax_deferred, `hsa`→hsa, everything else→taxable). This
is a nullable **override**: `null` reproduces pre-#25 behavior exactly, so
migrated data (migration 0009 adds the column `null` for every row) simulates
bit-for-bit identically. `roth` is reachable only by setting it explicitly
(there is no roth account `type`). A `roth` account grows tax-free, is
excluded from RMDs, and its withdrawals are untaxed — fixing the phantom RMDs
and phantom withdrawal tax that real Roth accounts previously suffered. The
sim routes each investable account's balance and contributions to the owner's
tax-deferred or Roth sub-bucket by the resolved treatment. (Substrate for
Roth conversions and equity grants; conversions/withdrawal-ordering are #23,
out of scope here.)

`external_account_masked` (v1.2.2, #30 — coordinator-ruled): **read-only**
display form of the hashed external-account link — `"···"` + last 4 of the
raw provider id, captured at link time alongside the hash (migration 0008).
`null` = never linked. Accounts linked before 0008 have hash-but-no-mask and
serve the bare `"···"` (linked, digits unknown); their mask self-heals on the
next import commit that matches them. Never accepted on POST/PATCH.

`type`: `checking|savings|brokerage|retirement|hsa|property|vehicle|other_asset|mortgage|loan|credit_card|other_liability`.
`asset_class` (investable accounts): `stocks|bonds|cash|mixed` — drives Monte
Carlo return distribution. `balance` is the latest snapshot; writing `balance`
creates a snapshot dated today.

`GET/POST /accounts/{id}/balances` → `[{"date": "2026-07-01", "amount": 250000.0}]`
`DELETE /accounts/{id}/balances/{date}`

## Flows (recurring income/expenses/contributions)

`GET/POST /flows`, `PATCH/DELETE /flows/{id}`

```json
{
  "id": 1, "name": "Salary", "kind": "income", "amount_monthly": 9500.0,
  "annual_growth_pct": 3.0, "start_date": null, "end_date": null,
  "account_id": null, "category": "salary", "member_id": 1,
  "ends_at_retirement": true
}
```

`kind`: `income|expense|contribution`. `contribution` requires `account_id`.

## Goals

`GET/POST /goals`, `PATCH/DELETE /goals/{id}`

```json
{
  "id": 1, "name": "Sailboat", "emoji": "⛵", "target_amount": 60000.0,
  "target_date": "2032-06-01", "priority": 2, "funded_amount": 5000.0,
  "notes": "the dream"
}
```

## Spending profile (v1.1)

`GET /spending` / `PUT /spending` (full replace)

```json
{
  "categories": [
    {"id": 1, "name": "Housing", "monthly_amount": 2500.0,
     "kind": "essential", "annual_growth_pct": null},
    {"id": 2, "name": "Dining out", "monthly_amount": 600.0,
     "kind": "discretionary", "annual_growth_pct": null}
  ],
  "monthly_savings_target": 1500.0
}
```

`kind`: `essential|discretionary`. `annual_growth_pct` null → inflation
assumption. On `PUT`, new categories omit `id` (server assigns); categories
with ids are updated in place; omitted existing ids are deleted. Spending
categories count as outflows in dashboard `monthly_surplus` (rulings
2026-07-11). Sim semantics: categories are expense streams (they stop at the
household retirement transition like other expenses); `monthly_savings_target`
is informational for the UI (actual saving comes from contribution flows).
**Double-count rule**: spending categories and `expense`-kind flows both count
in the sim; the UI must steer users toward categories and show a combined
total so double entry is visible. Migration seeds one "Everything else"
category from nothing (empty categories list is valid).

`GET /spending/observed?months=12` — computed from imported transactions
(outflows only), trailing N months (default 12, max 60):

```json
{
  "months": 12, "from": "2025-07-01", "to": "2026-07-01",
  "total_monthly_avg": 5240.0,
  "by_category": [
    {"category": "groceries", "monthly_avg": 820.0, "txn_count": 96}
  ]
}
```

Uncategorized transactions group under `"uncategorized"`. The UI offers
"use observed" to copy an observed average into a spending category.

## Transactions, transfers & categorization (v1.2)

Transaction gains: `"transfer_pair_id": null | int` (both legs of a paired
transfer share one id), `"category_source": "manual|rule|heuristic|ai|none"`.
Paired transactions are **excluded from all spending analytics**. Credit-card
model (coordinator ruling, owner-approved): spending is counted at the card
transaction; checking→card payments are transfers; interest/fees are real
spending (auto-category `interest-fees`). No statement-cycle modeling.

Transfer pairing on import: exact-amount, opposite-sign matches across
accounts within ±4 days auto-pair silently; near-misses become candidates.

| Method | Path | Notes |
|---|---|---|
| GET | `/transfers/candidates` | `[{score, txns: [Transaction, Transaction]}]`, score 0–1 |
| POST | `/transfers/pair` | `{transaction_ids: [a, b]}` → **200** with both updated legs `[Transaction, Transaction]` (link op, not resource creation) |
| DELETE | `/transfers/pair/{pair_id}` | unlink **and tombstone**: that transaction pair is never auto-paired again (manual re-pair via POST still allowed and clears the tombstone). Ruling 2026-07-11. |

`POST /transactions/categorize` returns `{"updated": n}`.
`/categorize/suggest` includes unmatched payees with `"category": null`.
`/spending/recurring` entries also carry `"amount_variability_pct"` (stddev/median of
occurrence amounts × 100) so the UI can segment true subscriptions (low
variability) from spending habits like groceries (rulings 2026-07-11).

Further rulings (2026-07-11, from T-008 flags):
`POST /transfers/candidates/dismiss` `{transaction_ids: [a, b]}` → 204 —
persists a dismissal tombstone (same mechanism as unpair tombstones) so the
candidate never resurfaces; manual pairing of the two txns still allowed.
`GET /transactions?uncategorized=1` excludes transfer-paired rows.
`api_key_last4` is `null` when no key is set. `by_purpose` entries are
`{input_tokens, output_tokens, est_cost_usd}`. `possibly_forgotten` is capped
at `monthly_equivalent ≤ 100` (subscription-scale heuristic — a mortgage is
recurring but not forgettable).

Category rules (applied on import, priority asc, first match wins):

`GET/POST /rules`, `PATCH/DELETE /rules/{id}` —
`{id, pattern, match: "contains|exact", field: "payee", category, priority}`
`POST /rules/apply` → `{recategorized: n}` (retroactive over uncategorized +
rule/heuristic-sourced transactions; never overwrites manual).

Bulk categorize: `POST /transactions/categorize` `{ids: [...], category}`
(sets `category_source: "manual"`). `GET /transactions` gains
`?uncategorized=1` filter.

AI categorization is **stubbed in v1.2**: `POST /categorize/suggest`
`{payees: [...]}` runs heuristics only and returns
`{suggestions: [{payee, category, confidence}], source: "heuristic"}`;
the Claude-backed implementation lands behind the same endpoint later and
must respect the AI budget (below).

## Import freshness (v1.2)

Account gains: `"last_import_at": null | datetime`,
`"newest_transaction_date": null | date`, `"staleness_days": null | int`
(per-account override; default threshold 35 days),
`"freshness": "fresh|aging|stale|never"` (computed: aging at 2/3 threshold,
stale past it; `never` = no imports and no transactions; accounts with
`track_freshness: false` — default false for property/vehicle/other types,
true for cash/card/investment types — report `"freshness": "off"`).
`GET /dashboard` gains `"stale_accounts": [{id, name, freshness,
days_since_import}]` (aging + stale only).

## Spending analytics (v1.2)

All exclude transfer-paired transactions.

`GET /spending/summary?from=&to=&group_by=month` →
`{"months": ["2026-01", ...], "categories": [{"category": "groceries",
"totals": [820.0, ...], "total": 9840.0}], "grand_total": 62000.0}`

`GET /spending/recurring` → detected recurring charges:
`[{"payee": "Netflix", "category": "subscriptions", "cadence":
"monthly|weekly|annual", "typical_amount": 15.49, "last_amount": 17.99,
"price_change_pct": 16.1, "last_date": "2026-06-28", "first_seen":
"2024-01-28", "occurrences": 30, "active": true, "monthly_equivalent": 17.99}]`
Detection: same normalized payee, ≥3 occurrences, regular cadence (±5 days
tolerance), amount within ±20% (price changes flagged, not disqualifying).
`active`: seen within 1.5× cadence.

`GET /spending/hotspots?months=6` →
`{"category_spikes": [{"category", "recent_monthly_avg",
"baseline_monthly_avg", "delta_pct"}], "top_merchants": [{"payee",
"monthly_avg", "txn_count"}], "price_increases": [recurring subset],
"possibly_forgotten": [recurring subset — active, low-variance, running
≥ 12 months]}`

`GET /spending/forecast?months=12` → `{"months": [...], "recurring": [...],
"variable_by_category": [...], "total": [...]}` — recurring charges projected
at cadence + trailing-average for non-recurring per category.

## AI budget & admin (v1.2 — ships before any AI calls exist)

`GET /settings/ai` → `{"has_api_key": true, "api_key_last4": "x7Q2",
"enabled": false, "monthly_budget_usd": 5.0, "spend_this_month_usd": 0.0,
"tokens_this_month": {"input": 0, "output": 0}}`
`PUT /settings/ai` — `{api_key?, enabled?, monthly_budget_usd?}`; the key is
write-only (never echoed), stored in the local DB, `api_key: null` deletes it.
`GET /ai/usage?months=6` → `[{"month": "2026-07", "input_tokens": n,
"output_tokens": n, "est_cost_usd": x, "by_purpose": {"categorize": {...}}}]`
Every future AI call must write an `ai_usage` ledger row and hard-stop with
403 `ai_budget_exhausted` when the month's spend would exceed the budget.

## Transactions & import

`GET /transactions?account_id=&from=&to=&limit=` →
`[{"id", "account_id", "date", "amount", "payee", "category"}]`

`POST /import/preview` — multipart: `file`, `kind` (`csv|ofx`), `account_id`.
Returns `{columns: [...], sample_rows: [...], suggested_mapping: {...},
matched_preset: ..., sign_hint: ...}` for CSV;
for OFX returns `{accounts_found: [...], transaction_count, balance}`.

`POST /import/commit` — multipart `file` + JSON fields `kind`, `account_id`,
`mapping` (CSV: `{date: "col", amount: "col", payee: "col", category?: "col"}`),
`update_balance: bool` → `{imported: n, skipped_duplicates: n}`.
Duplicate detection: (account, date, amount, payee) hash.

### Import presets & sign conventions (v1.2.2, T-009 — coordinator-ruled)

Mapping presets remember a saved column mapping per institution, keyed by the
CSV **header fingerprint**: `sha256` of the lowercased, sorted, comma-joined
CSV header list.

| Method | Path | Body → Response |
|---|---|---|
| GET | `/import/presets` | → `[{id, name, header_fingerprint, mapping, flip_signs, created_at}]` |
| DELETE | `/import/presets/{id}` | → 204 |

CSV `mapping` accepts an optional `{debit: "col", credit: "col"}` **in place
of** `amount` for split debit/credit exports (`debit` = outflow → negative,
`credit` = inflow → positive); `preview.suggested_mapping` detects such
headers and suggests `debit`/`credit` instead of `amount`.

`POST /import/preview` (CSV) response gains:

- `matched_preset: {id, name, mapping, flip_signs} | null` — the stored
  preset whose `header_fingerprint` matches the uploaded file, if any.
- `sign_hint: {looks_flipped: bool, reason: str} | null` — sign-convention
  heuristic: when the target account is a liability type
  (`credit_card|loan|mortgage`) and
  more than 80% of the parsed amounts are positive, `looks_flipped` is true
  with a plain-language reason ("47 of 50 rows look like charges …"). Null
  when the heuristic has nothing to say.

`POST /import/commit` (CSV) gains optional multipart fields:

- `flip_signs: bool` (default false) — negate every parsed amount before
  storing (for charges-positive card exports).
- `save_preset: str` (absent = don't save) — save the commit's mapping +
  flip_signs under this name, **upserting by header fingerprint** (one preset
  per institution header shape; a re-save updates name/mapping/flip_signs).

Rows with no parseable date that form a contiguous *trailing* block (bank
summary/total footers) are skipped by CSV parsing; a date-less row anywhere
else is still a hard `parse_error`, and a row **with** a valid date always
fails closed on any amount problem (oversized, garbage, missing) — never
skipped.

### Import account matching & creation (v1.2.2, #26 — coordinator-ruled)

Accounts gain a stored **hashed external-account link**: nullable
`external_account_id` = sha256 of the raw provider account id (OFX `ACCTID`
or a CSV account-number cell) — the raw id is never stored. Set on import
commit for the target account (upsert; last-write-wins — a collision moves
the link and logs a server warning). The hash itself is not exposed on the
Account resource; v1.2.2 #30 exposes the read-only display mask
`external_account_masked` (see Accounts), which the importer captures
wherever it sets the hash (a collision move clears both on the loser).
Migration 0007.

`POST /import/preview`: `account_id` becomes **optional** (the create-new
flow has no account yet); when absent the CSV `sign_hint` is `null`.

OFX preview response gains:

- `account_match: {"account_id": int | null, "acctid_masked": "···1234" | null}`
  — matched by the hashed first `ACCTID`; unknown id → `account_id` null;
  no `ACCTID` in the file → both null.

CSV preview response gains:

- `account_groups: null | [{key, number_masked, name, rows, account_id}]` —
  present when the **effective mapping** (matched preset, else suggestion)
  carries `account_id_column`: one entry per distinct account-number value,
  in file order. `key` is the sha256 of the raw number (the handle commit's
  `account_map` is keyed by — the raw number never round-trips),
  `name` comes from `account_column` (null without one), `account_id` is the
  hashed-id match (null when unseen).
- optional multipart `mapping` field: overrides the effective mapping used
  for `sign_hint`/`account_groups` (the wizard re-previews after remapping).

CSV `mapping` gains optional `account_column` (display names) and
`account_id_column` (routing identity — required if `account_column` is
set). Suggested when an account-ish header's values repeat across rows with
distinct count > 1. When `account_id_column` is present the commit routes
rows **per account** (multi-account mode).

CSV `mapping` also gains optional `status_column` (#26 Citi ruling): rows
whose status cell is `Pending` (case-insensitive) are skipped entirely —
pending amounts mutate when they post and would break dedupe; any other
status imports normally. Preview gains `pending_rows: int | null` (null
when no status column is mapped); commit responses gain
`skipped_pending: int` (0 when unmapped, OFX included). A column named
exactly `Status` is auto-suggested. **Split debit/credit sign ruling**:
each side parses as an absolute value and direction comes from the column
role (debit → outflow/negative, credit → inflow/positive) — some exports
(Citi) list credits already negative, and reading the cell's sign would
double-count payments as spending.

`POST /import/commit` accepts **either** `account_id` **or** `new_account`
(multipart JSON: `{name, type, institution?, asset_class?, member_id?}`) —
exactly one, else 422. `new_account` creates the account (type-appropriate
freshness defaults), links the external id (OFX), and the response carries
the full Account resource: `{imported, skipped_duplicates, account: {...}}`
(`account` only when created). Validation errors use the envelope.

Multi-account mode (CSV with `account_id_column`): `account_id`/`new_account`
must be absent (422). Optional multipart JSON `account_map` keyed by group
`key`: `{"<key>": {"account_id": n} | {"new_account": {...}}}`. Resolution
per group: explicit entry → hashed-id match → else 422 `unknown_account`
(masked numbers listed). Created accounts are linked (`external_account_id`
= group key). Response: `{imported, skipped_duplicates, accounts:
[{account_id, name, created, imported, skipped_duplicates}]}`.

Import presets gain `last_account_id: int | null` (also on preview's
`matched_preset`; null when the account no longer exists): single-target CSV
commits that save or match a preset record the target account as the
wizard's picker default. A built-in preset **"Fidelity — Accounts History"**
ships via migration 0007 (multi-account mapping for Fidelity's
`Accounts_History.csv` header shape).

CSV parsing hardening (#26): leading non-CSV/blank preamble lines before the
header are skipped (header = first row with ≥ 2 non-empty cells); the
trailing date-less block tolerance handles footers of any length (dated rows
with bad amounts still fail closed); quoted empty strings and quoted
negative amounts parse; **multiline quoted fields** (embedded newlines, e.g.
Amex `Extended Details`) parse as single records — nothing may split the
stream on physical lines; a column named exactly `Action` is preferred for
`payee` (falls back to `Description`). Payees are whitespace-normalized on
import (consecutive runs collapse to one space — fixed-width padded exports
would fragment merchant analytics and dedupe).

**Ruling change (#26, supersedes T-007):** CSV-file-supplied categories
import as `category_source: "heuristic"` (was `"manual"`) — merchant-derived
categories (e.g. Amex's) stay overridable by user rules, which now beat the
file column at import time too. Bulk categorize remains the only `"manual"`
source. No backfill; affects new imports only.

Built-in presets shipped by migration 0007 (fingerprint-upserted, user
deletable): **"Fidelity — Accounts History"** (multi-account mapping,
`payee: Action`), **"American Express — Activity"** (`flip_signs: true`,
`payee: Description`, `category: Category`, `account_id_column: Account #`)
**"Citi — Credit Card"** (split debit/credit, `status_column: Status`,
`payee: Description`) and **"Commerce Bank — Checking"** (classic
all-positive split debit/credit, `payee: Description`).

Further #26 parsing rulings: dates accept non-zero-padded `M/D/YYYY`;
fully-quoted exports (header included) parse; `suggested_mapping` never
proposes a fully-empty column for any role.

**Investment semantics (coordinator ruling):** transactions imported into
investment-type accounts (`brokerage|retirement|hsa`) are auto-categorized
`investment-activity` (source `heuristic`, overriding file/rules) and are
**excluded from all spending analytics** — same exclusion family as
transfer pairs and the `transfer` category fallback (a −0.51 dividend
reinvestment is not spending).

### Admin reset (v1.2.2, #27 — coordinator-ruled)

`POST /admin/reset` `{mode: "demo" | "empty", confirm: string}` — auth +
CSRF. `confirm` must exactly equal `"reset ludovitae"`, else 422
`confirm_required`; bad mode → 422 `validation_error`.

Takes a backup FIRST via the backup module (`pre-reset-<utc-ts>.db`, same
rotation family as pre-migration, keep 5; no-op → `null` when the DB file is
absent/empty), then wipes all financial tables — accounts, balance
snapshots, transactions, transfer tombstones, flows, goals, scenarios, sim
cache, spending categories, import presets, category rules, household (reset
to a single fresh "You" self member with null retirement/SS fields), profile
to defaults — while **preserving** `auth_credential`, `auth_sessions`,
`settings`, `ai_settings`, `ai_usage`. `mode: "demo"` then runs the demo
seeder in-process. Response: `{"backup": "<filename>" | null, "mode": ...}`.

Web: Settings → Danger zone (restrained until expanded; typed-phrase confirm
modal; full query invalidation + navigate to dashboard on success).
First-run: after password setup, an interstitial offers "Explore with demo
data" (reset mode=demo) vs "Start empty" (proceeds).

## Scenarios

`GET/POST /scenarios`, `GET/PATCH/DELETE /scenarios/{id}`

```json
{
  "id": 3, "name": "Retire at 55", "description": "", "is_baseline": false,
  "params": {
    "retirement_age": 55,
    "member_overrides": {
      "1": {"retirement_age": 55, "ss_claim_age": 62},
      "2": {"retirement_age": 60}
    },
    "monthly_savings_delta": 500.0,
    "annual_retirement_spending": 70000.0,
    "spending_delta_pct": -10.0,
    "return_override_pct": null, "inflation_override_pct": null,
    "events": [
      {"name": "Take up golf", "kind": "recurring_expense",
       "amount_monthly": 350.0, "start_age": 47, "end_age": null},
      {"name": "Sell the boat", "kind": "one_time",
       "amount": 25000.0, "age": 60}
    ]
  }
}
```

All `params` keys optional — a scenario is a diff against the baseline built
from real profile/accounts/flows. `event.kind`:
`one_time|recurring_expense|recurring_income`. Sign semantics (coordinator
ruling 2026-07-10): `recurring_expense`/`recurring_income` take a **positive
magnitude** in `amount_monthly` — direction is implied by the kind; recurring
events do not auto-stop at retirement and are fixed-nominal. `one_time.amount`
is **signed** (positive = money in). `monthly_savings_delta` is redirected
spending (expenses −delta, invested contributions +delta, until retirement).
A synthetic read-only baseline scenario (`id: 0`, `is_baseline: true`,
name "Current trajectory") always exists.

v1.1: top-level `retirement_age` is sugar for the `self` member's override
(kept for compatibility). `member_overrides` keys are member ids as strings
(JSON object keys); allowed per-member keys: `retirement_age`, `ss_claim_age`.
`spending_delta_pct` scales all spending categories + expense flows.

## Simulation

`POST /simulate` — `{"scenario_id": 3}` or `{"params": {...}}`, plus optional
`n_paths` (default 1000, max 10000) and `seed`.

```json
{
  "engine_version": "4",
  "engine_notes": ["<tax-treatment / Roth-bucket summary>",
                   "<bracket-mode change summary>", "<flat-mode note>"],
  "assumptions": {
    "market": {"stocks_mean_pct": 7.0, "stocks_vol_pct": 15.0,
               "bonds_mean_pct": 3.5, "bonds_vol_pct": 7.0,
               "cash_mean_pct": 1.5, "cash_vol_pct": 0.5},
    "inflation_pct": 2.5,
    "tax_model": "brackets", "filing_status": "single",
    "engine_version": "4"
  },
  "n_paths": 1000, "seed": 42,
  "start_year": 2026, "ages": [46, 47, ...],
  "deterministic": {"net_worth": [...], "invested": [...], "cash": [...],
                     "property": [...], "debt": [...]},
  "percentiles": {"p10": [...], "p25": [...], "p50": [...], "p75": [...], "p90": [...]},
  "success_probability": 0.87,
  "median_ruin_age": null,
  "ending_net_worth": {"p10": 120000, "p50": 1400000, "p90": 4100000},
  "milestones": [
    {"age": 55, "year": 2035, "kind": "retirement",
     "label": "Brian retires", "member_id": 1},
    {"age": 62, "year": 2042, "kind": "ss_start",
     "label": "Brian claims Social Security (70% of FRA)", "member_id": 1},
    {"age": 75, "year": 2055, "kind": "rmd_start",
     "label": "RMDs begin for Brian", "member_id": 1}
  ]
}
```

Arrays are annual (one value per age, year-end). Synchronous; target < 1.5s at
1000 paths.

v1.1.1 (engine v2, T-011a): `engine_notes` lists human-readable behavior
changes since the prior engine version; `assumptions` reflects the resolved
PlanInputs the run actually used (scenario overrides included), never
re-read from the DB; the sim result cache is keyed by engine version.

v1.2.2 (engine v3, T-012 phase 2): `assumptions.tax_model` names the tax
path the run used — `"flat" | "brackets"`, driven by the profile's nullable
`effective_tax_rate_pct`. Flat mode carries `effective_tax_rate_pct` and
`ss_taxable_share` exactly as in v1.1.1 and is numerically unchanged from
engine v2. Bracket mode carries `assumptions.filing_status`
(`"single" | "mfj"`; mfj iff the household has ≥ 2 members with role in
{`self`, `partner`} — `other` adults and children never affect it) and
drops the two flat-mode fields. Bracket mode: 2026 federal brackets and
standard deduction (indexed by the sim's per-path price level), Social
Security taxed via provisional income (thresholds nominal per IRC §86(c)),
RMDs and tax-deferred withdrawal shares taxed as ordinary income with an
annual December settlement — see docs/TAX-DESIGN.md.

v1.3 (engine v4, #25): accounts carry a `tax_treatment` (see Accounts). The
engine grows a per-member **Roth sub-bucket** alongside the tax-deferred one:
Roth balances are excluded from the RMD base and their withdrawals are
untaxed (they never gross up), while the tax-deferred `retirement_share`
that drives the withdrawal gross-up now excludes Roth. A household whose
retirement money is entirely tax-deferred is numerically unchanged from
engine v3; a household with any Roth (or taxable/tax-deferred split that
previously mis-taxed Roth) sees lower withdrawal tax and no forced Roth
distributions — the version bump reflects this capability change even though
pure-tax_deferred plans are identical. `assumptions` is unchanged.

v1.1: `ages` is the `self` member's age axis. `milestones` (sorted by age)
carries every member's retirement / SS-claim / RMD-start events under the
scenario's overrides, expressed on the self-age axis, for chart annotation.
`kind`: `retirement|ss_start|rmd_start`. Milestones beyond the horizon are
omitted.

`POST /scenarios/compare` — `{"scenario_ids": [0, 3, 4], "n_paths": 1000, "seed": 42}`
→ `{"results": [{"scenario_id": 0, "name": "...", <simulate response>}, ...]}`

## Dashboard & settings

`GET /dashboard` → `{"net_worth": 812000.0, "assets": ..., "liabilities": ...,
"history": [{"date", "net_worth"}], "by_type": {"brokerage": 250000, ...},
"goals_summary": [...], "monthly_surplus": 2100.0}`

`goals_summary` (coordinator ruling 2026-07-10): a Goal **subset** —
`{id, name, emoji, target_amount, funded_amount, target_date, priority,
pct_funded}` — where `pct_funded` is server-computed (0 when target is 0);
`notes` is not included.

`GET /settings` / `PATCH /settings` → `{"theme": "fintech", "reduce_motion": false}`
(`theme`: `fintech|game` — the A/B feature flag.)

## Export & backups (v1.2b, T-010)

`GET /export` (auth required) → 200 `application/json` with
`Content-Disposition: attachment; filename="gol-export-<date>.json"`:
`{"format": "gol-export", "schema_version": "<alembic head>",
"exported_at": "<ISO-8601Z>", "tables": {<table>: [rows...]}}` — every ORM
table (sorted; rows by PK), `alembic_version` excluded, money as dollars.
Secret/credential columns are always exported as null (the column key stays,
the value is redacted): `ai_settings[].api_key`,
`auth_credential[].password_hash`, `auth_sessions[].token_hash`, and
`auth_sessions[].csrf_token` (SECURITY-REVIEW-v1.2 V1 — restore is file-level,
so these carry no export value and only widen a leaked export's blast radius).
Restore is manual in this phase (README
"Backups & restore"); `POST /import/restore` is deferred with the round-trip
test that belongs to it. Backups: pre-migration (keep 5) + daily snapshots
(keep 14) in `data/backups/`, 0600.

Write-time person validation (v1.2.2, #7): `POST /household` and
`PATCH /household/{id}` reject a future `birth_year` or a `life_expectancy`
below current age with 422 `invalid_person_data` (mirrors the simulate-time
`invalid_plan_horizon` conditions; that guard remains as defense in depth).
`retirement_age` is clamped, never rejected, in both places.
