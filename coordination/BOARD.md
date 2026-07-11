# Board

| ID | Task | Owner | Branch | Status |
|---|---|---|---|---|
| T-001 | Backend foundation: app, auth, schema, CRUD, sim engine, import | backend-dev agent | ws/backend | done (v1 M1–M3) |
| T-002 | Frontend foundation: scaffold, theme system, all v1 screens | frontend-dev agent | ws/frontend | done (v1 M1–M3) |
| T-003 | QA: integration/e2e coverage, edge cases, sim correctness | qa agent | ws/qa | done — server 47→104+, web 43→62; D-001/2/3 fixed, F-002 flagged |
| T-004 | Security review: auth, CSRF, import parsing, headers, TLS | security agent | ws/security | done — report in docs/SECURITY-REVIEW-v1.md; all findings resolved |
| T-005 | v1.1 backend: household members, spending profile, SS/RMD timing engine, milestones | backend-dev agent | ws/household-be | done — 162 tests, migration sim-identity exact, merged to main |
| T-006 | v1.1 frontend: household & spending pages, milestone markers, timing controls | frontend-dev agent | ws/household-fe | done — web 62→97 tests, merged to main |
| T-007 | v1.2 backend: transfers/credit-card model, rules+heuristic categorization, freshness, analytics, AI budget | backend-dev agent | ws/spending-be | todo |
| T-008 | v1.2 frontend: spending hub, review queues, freshness badges, AI admin panel | frontend-dev agent | ws/spending-fe | todo |

## Backlog (unowned)

- F-002: `formatMoneyCompact` renders ~$999.5k–$999.9k as `$1000K` (cosmetic).
- Consider validating birth_year/life_expectancy consistency at `PUT /profile`
  time, not just at simulate time (QA suggestion).
- Flow CRUD forms — ON HOLD by owner decision (2026-07-11): the workflow is
  transactions-first (frequent CSV dumps + occasional balance snapshots), so
  income/spending reality should come from imports, not hand-edited flows.
  Revisit only if a real gap appears after v1.3 income inference.
- v1.3 candidate — **observed income / income inference**: detect recurring
  and lumpy inflows (salary cadence, bonuses, RSU vests, ESPP) from imported
  transactions, mirror of the v1.2 spending detectors; show observed vs
  assumed income and flag drift against the baseline income flows; optional
  settings "hint" fields (e.g. base salary $) as calibration anchors, not
  simulation inputs. Owner's comp is complicated (base + bonus + RSU + ESPP)
  — design for lumpy, multi-source income from the start.
- Visual QA pass of milestone chips in both themes on a real browser (T-006
  residual risk; no browser on the build host).
- Game theme: full illustration pass (v1 shipped a credible token skin).
- v2 items live in docs/ROADMAP.md.

v1 (M1–M5) and v1.1 complete. v1.2 (T-007/T-008) is next. Coordinator: lead architect session.
