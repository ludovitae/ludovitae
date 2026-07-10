# Agent coordination protocol

This repo is built by a team: a human owner (Brian), a **coordinator/lead
architect** session, and specialist agents (developer, QA, security, design).
Until we migrate to Forgejo, this directory *is* the project management tool.

## Source of truth

- `coordination/BOARD.md` — task index with live status. Update it when your
  task's status changes.
- `coordination/tasks/T-###-slug.md` — one file per task: scope, acceptance
  criteria, and a **Log** section. Agents append dated log entries for
  decisions made, deviations from spec, and handoff notes. Never rewrite
  another agent's log entries.
- `docs/API.md` and `docs/ARCHITECTURE.md` are binding contracts. If your work
  requires changing them, stop and flag it in your task log + final report
  instead of silently diverging.

## Git workflow (pre-Forgejo)

- Each workstream gets a branch: `ws/backend`, `ws/frontend`, `ws/qa`,
  `ws/security`. Agents commit **only** on their branch; the coordinator
  merges to `main` and resolves conflicts.
- Commit small and often — every coherent unit of work, always with a working
  tree that at least imports/builds. History quality matters; it survives the
  Forgejo migration.
- Message format: `type(scope): T-### summary` — e.g.
  `feat(sim): T-001 monte carlo percentile bands`. Types: feat, fix, test,
  docs, chore, refactor, style, security.
- Never commit: `data/`, databases, real financial data, secrets, TLS keys,
  `node_modules/`, build output.

## Task lifecycle

`todo → in-progress → review → done` (or `blocked` with a reason in the log).
Agents mark `review` when done; the coordinator (with QA/security input)
promotes to `done`.

## Definition of done (all tasks)

- Acceptance criteria in the task file met.
- Tests exist and pass (`uv run pytest` / `npm test`) for logic you added.
- Lint clean (`uv run ruff check` / `npm run lint`).
- BOARD.md status updated; task log has a closing entry.
