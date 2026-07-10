# Board

| ID | Task | Owner | Branch | Status |
|---|---|---|---|---|
| T-001 | Backend foundation: app, auth, schema, CRUD, sim engine, import | backend-dev agent | ws/backend | review — merged to main |
| T-002 | Frontend foundation: scaffold, theme system, all v1 screens | frontend-dev agent | ws/frontend | review — merged to main |
| T-003 | QA: integration/e2e coverage, edge cases, sim correctness | qa agent | ws/qa | review — server 104 / web 62 green; 3 defects fixed (D-001/2/3), F-002 flagged |
| T-004 | Security review: auth, CSRF, import parsing, headers, TLS | security agent | ws/security | todo |

T-001/T-002 promote to done after T-003/T-004 pass over the merged app.
Milestone: M1–M3 (see docs/ROADMAP.md). Coordinator: lead architect session.
