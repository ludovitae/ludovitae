# Game of Life — agent onboarding

Personal financial life simulator (LAN web app). You are likely one of several
coordinated agents. Read, in order:

1. `coordination/PROTOCOL.md` — how we work (branches, commits, task board).
2. `docs/ARCHITECTURE.md` — system design (binding).
3. `docs/API.md` — API contract (binding; server and web implement it exactly).
4. Your task file in `coordination/tasks/`.

Rules that override convenience:

- Work only on your workstream branch; never commit to `main`.
- Commit small, working increments: `type(scope): T-### summary`.
- Never commit financial data, secrets, `data/`, or build artifacts.
- Contract changes (API/architecture) are coordinator decisions — flag, don't drift.
- UI work: docs/DESIGN.md quality bar applies; invoke the dataviz skill before chart code.
- Backend: `cd server && uv sync && uv run pytest`. Frontend: `cd web && npm install && npm test`.
