# Game of Life

A personal financial life simulator you run at home. Feed it your accounts, goals,
dreams, and possessions; play out alternate lives: *What if I saved $500 more a month?
What if I retire at 55? What if I take up golf?* Monte Carlo simulation gives honest
probability bands instead of a single rosy line.

## Status

v1 in active development. See [docs/ROADMAP.md](docs/ROADMAP.md).

## Stack

- **Frontend** — `web/`: Vite + React + TypeScript + Tailwind. Premium fintech
  dashboard by default; a `game` theme flag switches to a board-game aesthetic.
- **Backend** — `server/`: FastAPI + SQLAlchemy + SQLite, numpy-powered simulation
  engine. Single-user, password-protected, designed to be reachable on your home LAN.
- **Data** — local-first. Manual entry + CSV/OFX import in v1; live aggregator sync
  (SimpleFIN/Plaid) is a v2 milestone behind a sync-adapter interface.

## Development

This repo is built by a coordinated team of AI agents with a human owner.
Start with [coordination/PROTOCOL.md](coordination/PROTOCOL.md) and
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

```sh
# backend
cd server && uv sync && uv run uvicorn gol.main:app --reload

# frontend
cd web && npm install && npm run dev
```
