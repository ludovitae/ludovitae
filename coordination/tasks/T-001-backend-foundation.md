# T-001 — Backend foundation

Owner: backend-dev agent · Branch: `ws/backend` · Status: review

## Scope

Everything in `server/` per docs/ARCHITECTURE.md, implementing docs/API.md
exactly:

1. uv-managed project (Python 3.12), FastAPI app factory, config, SQLite via
   SQLAlchemy 2.0 + Alembic (single initial migration is fine).
2. Auth: first-run setup, argon2id, server-side sessions, CSRF double-submit,
   login throttling, security headers middleware.
3. CRUD: profile, accounts (+balance snapshots), flows, goals, scenarios,
   settings, transactions, dashboard aggregate.
4. Simulation engine (`gol/sim/`): deterministic projection + vectorized Monte
   Carlo per ARCHITECTURE.md; `/simulate` and `/scenarios/compare`.
5. Import: CSV preview/commit with column mapping + dedupe; OFX parse
   (hand-rolled minimal SGML/XML tolerant parser or `ofxparse`).
6. Seed script (`uv run gol-seed`) creating a realistic demo dataset.
7. pytest suite: sim engine golden tests (pinned seeds), auth flow, CRUD
   smoke, import dedupe. ruff configured and clean.

## Acceptance criteria

- `uv sync && uv run pytest` green; `uv run uvicorn gol.main:app` serves the API.
- Every endpoint in docs/API.md responds with the documented shapes.
- 1000-path simulation < 1.5s; same seed → identical output.
- No plaintext password storage anywhere; sessions unusable after logout.

## Log

- 2026-07-10 (coordinator): task created.
- 2026-07-10 (backend-dev): implementation complete on `ws/backend`; status → review.
  47 tests green, ruff clean, `uvicorn gol.main:app` boots and serves
  `/api/v1/auth/session`, 1000-path sim ≈0.5s. Decisions/deviations below.
- 2026-07-10 (backend-dev): money stored as integer cents in SQLite via a
  `Money` TypeDecorator; floats-of-dollars in JSON per the contract.
- 2026-07-10 (backend-dev): retirement transition semantics — ALL expense-kind
  flows stop at the retirement month (spending switches to
  `annual_retirement_spending`, inflated per path); income flows stop only when
  `ends_at_retirement`; contributions honor their own flag. Scenario recurring
  events do NOT auto-stop at retirement (e.g. golf at 55 continues), and are
  fixed-nominal; retirement spending + social security are inflation-linked.
- 2026-07-10 (backend-dev): `monthly_savings_delta` interpreted as redirected
  spending: expenses −delta and invested contributions +delta until retirement
  (negative delta = spend more, save less).
- 2026-07-10 (backend-dev): `return_override_pct` sets the mean return of all
  three asset classes (vols kept). Coarse but matches "return override".
- 2026-07-10 (backend-dev): CONTRACT AMBIGUITY (flagged, not diverged):
  API.md says "Positive `amount` = money in" for scenario events, but the
  example uses positive 350 for a `recurring_expense` (golf). Implemented:
  `recurring_expense` amount_monthly is an outflow, `recurring_income` an
  inflow, `one_time.amount` signed (positive = in). Coordinator may want to
  clarify the contract wording.
- 2026-07-10 (backend-dev): contract leaves unspecified: POST create status
  (used 201), CSV `sample_rows` shape (list of {column: value} objects),
  balance POST body ({date, amount}). `/auth/logout` requires the CSRF header
  (it is a mutating route). Flagging for the frontend agent.
- 2026-07-10 (backend-dev): `retirement_share` (drives coarse withdrawal tax)
  counts `retirement`-type balances only; HSA treated as tax-free on
  withdrawal. Sim cache hashes the assembled PlanInputs, so any data edit
  invalidates cached runs. Added `cryptography` dep for TLS autogen
  (task allowed choosing it over openssl subprocess). `gol-seed` never creates
  a password — first-run setup stays with the user.
