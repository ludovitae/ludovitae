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

## GitHub workflow (adopted 2026-07-11, supersedes local-merge below)

Remote: github.com/ludovitae/ludovitae. Owner decision: **the owner merges.**

- Agents still commit to `ws/*` branches (unchanged).
- After coordinator acceptance review, the coordinator pushes the branch and
  opens a **PR**; the PR body is the acceptance review (what was verified
  independently, what was read, rulings, test counts). CI must be green.
- The owner reviews and merges. The coordinator never merges to main.
  Release tagging still follows the Releases section, on the merged commit.
- Owner-initiated work may arrive as **GitHub issues**; the coordinator
  triages issues into tasks here (issue link in the task file). Known queued:
  owner will file the `gol`→`ludovitae` package-rename issue after the
  current PRs merge — do not start the rename before that issue exists.

## Git workflow (pre-GitHub, historical)

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

## Releases (adopted 2026-07-11, owner ask)

A version "ships" when the coordinator completes integrated verification on
main (both suites green + end-to-end walk). At that moment, in one commit +
tag:

1. Write `docs/releases/vX.Y.Z.md` — features in owner language, quality
   numbers (test counts, findings), migration notes, known gaps, golden
   movements if engine behavior changed.
2. `git tag -a vX.Y.Z -m "<one-line summary>"` on the verified commit.
3. Update ROADMAP.md (Shipped section) in the same commit.

Semver-ish: minor = feature wave (v1.2.0), patch = fixes to a shipped
version (v1.0.1). Tags survive the Forgejo migration and become releases
there.

## Definition of done (all tasks)

- Acceptance criteria in the task file met.
- Tests exist and pass (`uv run pytest` / `npm test`) for logic you added.
- Lint clean (`uv run ruff check` / `npm run lint`).
- BOARD.md status updated; task log has a closing entry.
