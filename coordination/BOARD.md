# Board

| ID | Task | Owner | Branch | Status |
|---|---|---|---|---|
| T-001 | Backend foundation: app, auth, schema, CRUD, sim engine, import | backend-dev agent | ws/backend | done (v1 M1–M3) |
| T-002 | Frontend foundation: scaffold, theme system, all v1 screens | frontend-dev agent | ws/frontend | done (v1 M1–M3) |
| T-003 | QA: integration/e2e coverage, edge cases, sim correctness | qa agent | ws/qa | done — server 47→104+, web 43→62; D-001/2/3 fixed, F-002 flagged |
| T-004 | Security review: auth, CSRF, import parsing, headers, TLS | security agent | ws/security | done — report in docs/SECURITY-REVIEW-v1.md; all findings resolved |
| T-005 | v1.1 backend: household members, spending profile, SS/RMD timing engine, milestones | backend-dev agent | ws/household-be | in-progress |
| T-006 | v1.1 frontend: household & spending pages, milestone markers, timing controls | frontend-dev agent | ws/household-fe | in-progress |
| T-007 | v1.2 backend: transfers/credit-card model, rules+heuristic categorization, freshness, analytics, AI budget | backend-dev agent | ws/spending-be | hold (after v1.1) |
| T-008 | v1.2 frontend: spending hub, review queues, freshness badges, AI admin panel | frontend-dev agent | ws/spending-fe | hold (after v1.1) |

## Backlog (unowned)

- F-002: `formatMoneyCompact` renders ~$999.5k–$999.9k as `$1000K` (cosmetic).
- Consider validating birth_year/life_expectancy consistency at `PUT /profile`
  time, not just at simulate time (QA suggestion).
- Game theme: full illustration pass (v1 shipped a credible token skin).
- v2 items live in docs/ROADMAP.md.

Milestone M1–M4 complete; M5 hardening done (QA + security). Coordinator: lead architect session.
