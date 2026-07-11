# T-005 — Household, spending profile & timing engine (backend)

Owner: backend-dev agent · Branch: `ws/household-be` · Status: review

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
- 2026-07-11 (backend-dev): implementation complete on `ws/household-be`;
  status → review. 159 server tests green (125 baseline preserved except the
  intentional golden re-pin), ruff clean, server boots; seeded-household
  1000-path sim (81-year horizon) ≈0.43s over HTTP. Decisions below.
- 2026-07-11 (backend-dev): engine identity strategy — per-member
  tax-deferred balances are SUB-BUCKETS of the single invested bucket; they
  grow with the same blended factor, shrink pro-rata on shortfall
  withdrawals, and move money only when RMDs fire. The shortfall-withdrawal
  tax gross-up keeps v1's FIXED retirement_share knob. Retirement stops are
  resolved into flow end_months by assembly. Net effect: v1-equivalent
  households reproduce v1 outputs bit-for-bit (regression-tested end-to-end
  through the 0001→0002 migration against a recorded v1 golden, and again at
  engine level).
- 2026-07-11 (backend-dev): migration back-computes ss_monthly_at_fra =
  old_monthly / claim_factor (claim age = old social_security_start_age
  clamped to 62–70) so the simulated benefit is preserved — exact at claim 67,
  within a cent otherwise (Money stores cents). v1 allowed start ages outside
  62–70; those get clamped (timing shifts) — unavoidable under the v1.1
  contract. The starter "Everything else" category is seeded with amount 0 so
  migrated simulations stay identical (assembly skips zero-amount categories).
- 2026-07-11 (backend-dev): RMD semantics — annual, on the plan-year grid
  (ages are birth-year based), from the member's RMD start (73/75 by birth
  year, IRS Pub 590-B 2022+ ULT divisors shipped as data in gol/sim/tables.py,
  clamped at the 120+ row) to the member's life end; survivor/inherited-IRA
  rules out of scope. Unowned retirement accounts use the self member for RMD
  timing (per contract). RMD milestone is emitted only when the deterministic
  path has a positive balance at the start month.
- 2026-07-11 (backend-dev): member SS streams stop at the member's life end;
  user-entered income flows are NOT auto-clipped at their owner's death (flows
  keep their explicit windows — documented limitation). ends_at_retirement on
  owned CONTRIBUTIONS follows the flow's member (contract only specifies
  income); tax-deferred contribution routing follows the ACCOUNT owner.
  Owned income whose owner has no retirement_age falls back to the household
  last-retirement stop, same as unowned.
- 2026-07-11 (backend-dev): scenario semantics — explicit
  member_overrides[self] wins over the top-level retirement_age sugar;
  overrides for unknown/deleted member ids are ignored at simulate time
  (scenarios may outlive members); spending_delta_pct scales baseline expense
  flows + spending categories only (not scenario events, not the
  monthly_savings_delta redirect, not annual_retirement_spending).
- 2026-07-11 (backend-dev): /spending/observed — window is full calendar
  months ending at the current month start; transfers excluded by category ==
  "transfer" (case-insensitive, documented in gol/api/spending.py); inflows
  (amount ≥ 0) excluded; by_category sorted by monthly_avg desc. PUT /spending
  preserves ids for categories passed with an existing id, creates/deletes the
  rest.
- 2026-07-11 (backend-dev): golden movement — the golden household (born
  1980, 60% of 600k tax-deferred + ongoing 401(k) contributions) now RMDs from
  75: det ending net worth 4,499,929.33 → 4,237,007.25, ending p50
  2,641,539.39 → 2,517,061.28, success 0.739 → 0.737; year-0 values unchanged.
  engine_version stays "1" per the contract example; milestones are additive.
- 2026-07-11 (backend-dev): CONTRACT CONCERN (implemented as written, flagging
  for a ruling): "horizon runs to the latest life expectancy in the household"
  includes child members — the seeded household (child Riley, le 92) simulates
  to self age ~127 (81-year horizon; still 0.43s at 1000 paths, and charts
  keep working). If unintended, suggest horizon = latest life expectancy among
  role in {self, partner, other}, or a nullable child life_expectancy. Also:
  error codes chosen where the contract is silent — 409 self_member_exists /
  self_role_immutable, 403 self_member_undeletable, 404 member_not_found.
- 2026-07-11 (backend-dev): coordinator rulings (docs/API.md 18277a4) applied.
  (1) Horizon is now the latest life expectancy among ADULT members
  (self/partner/other); child members never extend it and carry no
  retirement/SS/RMD schedules even if those fields are set (assembly ignores
  them; a child's life_end is clamped to the adult horizon so it cannot leak
  into any schedule). Pinned by test_child_never_extends_horizon and
  test_child_role_creates_no_schedules_or_milestones; seeded household horizon
  shrank 81y → 52y (self ages 46–97, capped by Dana le 94); migration
  sim-identity and golden tests unaffected (adult-only fixtures).
  (2) PUT /spending verified to match the id convention; tightened one
  unspecified edge: a category id that does not exist now 404s
  (category_not_found) instead of silently creating with a fresh id.
  (3) Dashboard monthly_surplus now subtracts spending categories alongside
  expense flows (test in test_crud.test_dashboard_aggregate). 162 server
  tests green, ruff clean, seeded 1000-path sim 0.31s.
