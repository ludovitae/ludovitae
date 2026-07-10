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

## Profile (singleton)

`GET /profile` / `PUT /profile`

```json
{
  "birth_year": 1980, "retirement_age": 65, "life_expectancy": 92,
  "annual_retirement_spending": 80000, "social_security_monthly": 2200,
  "social_security_start_age": 67, "inflation_pct": 2.5,
  "effective_tax_rate_pct": 18
}
```

## Accounts

`GET/POST /accounts`, `GET/PATCH/DELETE /accounts/{id}`

```json
{
  "id": 1, "name": "Vanguard Brokerage", "type": "brokerage",
  "institution": "Vanguard", "balance": 250000.0,
  "growth_rate_pct": null, "asset_class": "stocks",
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
  "account_id": null, "category": "salary",
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
    "monthly_savings_delta": 500.0,
    "annual_retirement_spending": 70000.0,
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
  "ending_net_worth": {"p10": 120000, "p50": 1400000, "p90": 4100000}
}
```

Arrays are annual (one value per age, year-end). Synchronous; target < 1.5s at
1000 paths.

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
