# T-003 — QA hardening

Owner: qa agent · Branch: `ws/qa` · Status: todo (blocked on T-001/T-002 merge)

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
