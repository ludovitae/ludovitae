# T-001 — Backend foundation

Owner: backend-dev agent · Branch: `ws/backend` · Status: todo

## Scope

Everything in `server/` per docs/ARCHITECTURE.md, implementing docs/API.md
exactly:

1. uv-managed project (Python 3.12), FastAPI app factory, config, SQLite via
   SQLAlchemy 2.0 + Alembic (single initial migration is fine).
2. Auth: first-run setup, argon2id, server-side sessions, CSRF double-submit,
   login throttling, security headers middleware.
3. CRUD: profile, accounts (+balance snapshots), flows, goals, scenarios,
   settings, transactions, dashboard aggregate.
4. Simulation engine (`gol/sim/`): deterministic projection + vectorized Monte
   Carlo per ARCHITECTURE.md; `/simulate` and `/scenarios/compare`.
5. Import: CSV preview/commit with column mapping + dedupe; OFX parse
   (hand-rolled minimal SGML/XML tolerant parser or `ofxparse`).
6. Seed script (`uv run gol-seed`) creating a realistic demo dataset.
7. pytest suite: sim engine golden tests (pinned seeds), auth flow, CRUD
   smoke, import dedupe. ruff configured and clean.

## Acceptance criteria

- `uv sync && uv run pytest` green; `uv run uvicorn gol.main:app` serves the API.
- Every endpoint in docs/API.md responds with the documented shapes.
- 1000-path simulation < 1.5s; same seed → identical output.
- No plaintext password storage anywhere; sessions unusable after logout.

## Log

- 2026-07-10 (coordinator): task created.
