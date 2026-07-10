# T-003 — QA hardening

Owner: qa agent · Branch: `ws/qa` · Status: done

## Scope

- Run both suites; fix flakes; raise coverage on sim engine edge cases:
  retirement age already passed, negative net worth, zero income, debt payoff,
  events beyond life expectancy, empty database, absurd inputs (validation).
- API contract test: walk docs/API.md and assert real responses match shapes.
- Frontend: vitest component tests for money formatting, scenario param
  serialization, chart data transforms; smoke e2e (Playwright) for
  setup→login→add account→simulate happy path.
- File defects as log entries here with repro; fix directly on `ws/qa` when
  low-risk, otherwise flag for the owning workstream.

## Acceptance criteria

- Full suites green and meaningfully stronger than at merge time.
- Defect list (including won't-fix rationale) recorded in the log.

## Log

- 2026-07-10 (coordinator): task created.
- 2026-07-10 (qa): baseline green before any changes — server 47 passed
  (`uv run pytest`), web 43 passed (`vitest run`), `npm run build` + `npm run
  lint` clean.
- 2026-07-10 (qa) DEFECT D-001 [severity: medium, FIXED on ws/qa]: a plan whose
  `start_age > life_expectancy` crashed the numpy engine with
  `ValueError: negative dimensions are not allowed`, surfacing as **HTTP 500**
  (violates "validation errors use the envelope, not 500s"). Reachable via a
  plausible user error — birth_year older than the `life_expectancy` setting
  (e.g. birth_year 1950 / life_expectancy 70), or an old/typo birth_year — and
  also via a future birth_year (negative age → nonsense negative-age output).
  Repro: PUT /profile {birth_year:1900, life_expectancy:92} then POST /simulate
  {scenario_id:0}. Fix: `build_plan_inputs` (the single ORM→engine bridge, used
  by /simulate and /scenarios/compare) now raises 422 `invalid_plan_horizon` in
  the documented envelope. New error code is envelope-consistent; docs/API.md
  does not enumerate error codes, so no contract change. Covered by
  tests/test_validation_edges.py.
- 2026-07-10 (qa) DEFECT D-002 [severity: low, FIXED on ws/qa]: web
  `api/types.ts` typed `Goal.emoji: string`, but the backend model stores it
  nullable and the API returns `null` for goals created without an emoji
  (GoalSummary was already `string | null` — inconsistent). Render fallout: the
  dashboard `GoalRow` rendered `<span className="mr-1.5">{emoji}</span>`, leaving
  an empty span + margin gap for a null emoji. Fix: `Goal.emoji: string | null`;
  dashboard row falls back to 🎯 (matching the goals grid); emoji input reads
  `?? ''`. Regression test: web/src/test/goals-emoji.smoke.test.tsx. No
  contract/API.md change — this aligned web to the already-correct backend.
- 2026-07-10 (qa) DEFECT D-003 [severity: low-med, FIXED on ws/qa]: with the
  SPA mounted (production), an unknown `/api/v1/...` GET fell through the
  `/{path:path}` catch-all and returned `index.html` (200) instead of a JSON
  404 — a client would parse HTML as an API response. Fix: the catch-all raises
  404 `not_found` for any `api`-prefixed path (real API routes still match
  first; no legit client route starts with `/api/`). Covered by
  tests/test_static_serving.py. Behavior-only; not a docs/API.md change.
- 2026-07-10 (qa) FINDING F-002 [severity: cosmetic, FLAGGED not fixed]:
  `formatMoneyCompact` renders values in ~[999_500, 999_999] as `$1000K` rather
  than `$1M` (trim() rounds 999.999 → 1000 before the M threshold check). Only
  affects chart tick/hero labels at a narrow band. Locked as current behavior in
  format.test.ts; deferred to the frontend workstream — a fix would nudge chart
  label output and should go through DESIGN review.
- 2026-07-10 (qa) NOTE: no flaky/order-dependent tests observed; the two new
  jsdom tests (emoji, scenario-studio) mutate/spy only within their own file and
  vitest isolates module state per file. Path-traversal (10 raw/encoded
  payloads), 401/403 envelopes, and the full contract walk are green.
- 2026-07-10 (qa): CLOSING — status → review. Suites: server 47→104 passed
  (ruff clean), web 43→62 passed (lint + build clean). New backend files:
  test_sim_edge_cases, test_validation_edges, test_api_contract,
  test_static_serving. New/extended web tests: format, scenarioParams,
  goals-emoji smoke, scenario-studio smoke. Fixes D-001/D-002/D-003 applied on
  ws/qa; F-002 flagged. No docs/API.md or ARCHITECTURE.md changes. For the
  coordinator: D-001's `invalid_plan_horizon` and D-003's api-404 are new server
  behaviors (not contract-doc changes) worth a glance at merge; consider whether
  profile PUT should reject a birth_year/life_expectancy combo up front
  (currently only guarded at simulate time).
- 2026-07-10 (coordinator): promoted to done — QA (T-003) and security
  (T-004) passed over the merged app; integrated main is green (125 server /
  62 web tests) and end-to-end verified.
