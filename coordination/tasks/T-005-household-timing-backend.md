# T-005 — Household, spending profile & timing engine (backend)

Owner: backend-dev agent · Branch: `ws/household-be` · Status: todo

## Scope

Implement the v1.1 contract additions in docs/API.md (sections marked v1.1)
and the engine changes in docs/ARCHITECTURE.md §Simulation engine item 4:

1. Models + Alembic migration: `household_members`, `spending_categories`,
   household `monthly_savings_target` (settings or profile table), nullable
   `member_id` on accounts and flows. **Data migration**: create member 1
   ("You", role self) from existing profile columns, then drop person-level
   profile columns. Existing DBs must upgrade losslessly.
2. `/household` CRUD (exactly-one-self invariant, self undeletable, claim age
   62–70 validation), slimmed `/profile`, `/spending` GET/PUT,
   `/spending/observed` (trailing-N-month outflow averages by category from
   transactions; parameter bounds per contract).
3. Engine v1.1: per-member tax-deferred buckets, per-member income stop, SS
   claim-age actuarial factors (62:0.70, 63:0.75, 64:0.80, 65:0.8667,
   66:0.9333, 67:1.0, 68:1.08, 69:1.16, 70:1.24), RMD start 73/75 by birth
   year with Uniform Lifetime Table divisors (ship the table as data),
   household spending transition at last retirement, horizon to latest life
   expectancy, milestone emission. Stay vectorized over paths.
4. Scenario `member_overrides` + `spending_delta_pct`; top-level
   retirement_age = sugar for self. Baseline scenario unchanged in id/shape.
5. Seed update: two-adult household (staggered ages), a child, owned accounts
   and salaries, spending categories, transactions rich enough that
   /spending/observed returns something interesting.
6. Tests: SS factor math, RMD table lookups and forced-distribution flow, two
   staggered retirements (income steps down twice), milestone correctness
   (incl. beyond-horizon omission), migration from a v1 database file, all new
   endpoints (shape + validation envelopes). Golden pinned-seed test updated —
   document WHY numbers moved in the commit message.

## Acceptance criteria

- `uv run pytest` green (existing 125 must not regress except intentional
  golden updates), ruff clean, 1000-path sim still < 1.5s.
- A v1 database upgraded in place simulates identically when the household is
  just the migrated self member with the same parameters (tolerance: exact,
  same seed) — regression-proof migration.
- Every v1.1 endpoint matches docs/API.md exactly.

## Log

- 2026-07-10 (coordinator): task created. Contract already updated in
  docs/API.md + ARCHITECTURE.md — do not diverge; flag concerns in this log.
