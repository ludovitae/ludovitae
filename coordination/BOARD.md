# Board

| ID | Task | Owner | Branch | Status |
|---|---|---|---|---|
| T-001 | Backend foundation: app, auth, schema, CRUD, sim engine, import | backend-dev agent | ws/backend | done (v1 M1–M3) |
| T-002 | Frontend foundation: scaffold, theme system, all v1 screens | frontend-dev agent | ws/frontend | done (v1 M1–M3) |
| T-003 | QA: integration/e2e coverage, edge cases, sim correctness | qa agent | ws/qa | done — server 47→104+, web 43→62; D-001/2/3 fixed, F-002 flagged |
| T-004 | Security review: auth, CSRF, import parsing, headers, TLS | security agent | ws/security | done — report in docs/SECURITY-REVIEW-v1.md; all findings resolved |
| T-005 | v1.1 backend: household members, spending profile, SS/RMD timing engine, milestones | backend-dev agent | ws/household-be | done — 162 tests, migration sim-identity exact, merged to main |
| T-006 | v1.1 frontend: household & spending pages, milestone markers, timing controls | frontend-dev agent | ws/household-fe | done — web 62→97 tests, merged to main |
| T-007 | v1.2 backend: transfers/credit-card model, rules+heuristic categorization, freshness, analytics, AI budget | backend-dev agent | ws/spending-be | done — merged (219 tests, tombstones + rulings applied) |
| T-008 | v1.2 frontend: spending hub, review queues, freshness badges, AI admin panel | frontend-dev agent | ws/spending-fe | done — merged in v1.2.0 (136 tests after reconciliation) |
| T-009 | v1.2a first real baseline: flow form, importer presets/sign detection vs owner's real exports, browser QA | fe+be agents | ws/first-mile | ready — needs owner exports in data/first-mile/ |
| T-010 | v1.2b durability: pre-migration backup, scheduled snapshots, export endpoint | backend-dev agent | ws/durability | done — PR #1 merged by owner (291 tests) |
| T-011 | Model honesty: 85% SS cap + assumptions in API (011a); assumptions strip + 5% rounding in UI (011b) | be + fe agents | ws/honesty-be/-fe | 011a done — merged; 011b PR #3 open — awaiting owner merge |
| T-012 | Bracket-aware tax phase 1: standalone gol/tax module + design doc | backend-dev agent | ws/tax-brackets | done — merged; phase 2 integration next |

## Backlog (unowned, actionable only — versioned plans live in docs/ROADMAP.md)

- F-002: `formatMoneyCompact` renders ~$999.5k–$999.9k as `$1000K` (cosmetic).
- Validate birth_year/life_expectancy consistency at `PUT /profile` time, not
  just at simulate time (QA suggestion).
- Consider mock /simulate consuming real-engine golden fixtures instead of
  reimplementing dynamics (PM review finding 6, mock-drift liability).

v1 + v1.1 shipped; v1.2 in review/flight; post-review wave (T-009…T-012)
sequenced per DECISIONS 2026-07-11. Design sketches for v1.3 candidates
(income inference, equity grants) and vFuture (sell-side, advisory-only)
moved to docs/ROADMAP.md. Coordinator: lead architect session.
