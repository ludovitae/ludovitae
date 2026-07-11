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
  "effective_tax_rate_pct": 18
}
```

Person-level fields (birth_year, retirement_age, life_expectancy, social
security) moved to household members in v1.1. Migration creates member 1
("You", role `self`) from the old profile columns.

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
Exactly one `self` member must exist; it cannot be deleted.
The simulation horizon runs to the latest life expectancy in the household.
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
  "member_id": 1,
  "include_in_net_worth": true, "notes": "", "created_at": "2026-07-10"
}
```

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
assumption. Sim semantics: categories are expense streams (they stop at the
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
| POST | `/transfers/pair` | `{transaction_ids: [a, b]}` → both legs updated |
| DELETE | `/transfers/pair/{pair_id}` | unlink |

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
Returns `{columns: [...], sample_rows: [...], suggested_mapping: {...}}` for CSV;
for OFX returns `{accounts_found: [...], transaction_count, balance}`.

`POST /import/commit` — multipart `file` + JSON fields `kind`, `account_id`,
`mapping` (CSV: `{date: "col", amount: "col", payee: "col", category?: "col"}`),
`update_balance: bool` → `{imported: n, skipped_duplicates: n}`.
Duplicate detection: (account, date, amount, payee) hash.

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
  "engine_version": "1", "n_paths": 1000, "seed": 42,
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
