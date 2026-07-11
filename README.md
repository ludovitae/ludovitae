# Ludovitae

*ludus* (game) + *vitae* (lives) — a personal financial life simulator you run
at home. Feed it your accounts, goals, dreams, and possessions; play out
alternate lives: *What if I saved $500 more a month? What if I retire at 55?
What if I take up golf?* Monte Carlo simulation gives honest probability bands
instead of a single rosy line.

MIT licensed (see [LICENSE](LICENSE)).

## Status

v1.2.0 shipped — see [docs/ROADMAP.md](docs/ROADMAP.md) and
[docs/releases/](docs/releases/). Started life as "game of life"; the Python
package is still `gol` pending the post-v1.2 rename.

## Stack

- **Frontend** — `web/`: Vite + React + TypeScript + Tailwind. Premium fintech
  dashboard by default; a `game` theme flag switches to a board-game aesthetic.
- **Backend** — `server/`: FastAPI + SQLAlchemy + SQLite, numpy-powered simulation
  engine. Single-user, password-protected, designed to be reachable on your home LAN.
- **Data** — local-first. Manual entry + CSV/OFX import in v1; live aggregator sync
  (SimpleFIN/Plaid) is a v2 milestone behind a sync-adapter interface.

## Backups & restore

Everything lives in one SQLite file, `data/gol.db`. The server protects it
automatically (all backups in `data/backups/`, file mode 0600, never in git):

- **Pre-migration backups** — before a schema migration touches a non-empty
  database, a copy is saved as `pre-migration-<schema>-<timestamp>.db`
  (newest 5 kept).
- **Daily snapshots** — on server start and every 24 hours while running,
  a consistent snapshot is saved as `daily-<date>.db` (newest 14 kept).
- **Export** — `GET /api/v1/export` (authenticated) downloads the whole
  database as one JSON document; the AI API key is never included.

**To restore:** stop the server, replace `data/gol.db` with the backup of
your choice (`cp data/backups/daily-2026-07-10.db data/gol.db`), and start
the server again. Migrations bring an older backup forward automatically.
There is no restore endpoint; restore is deliberately a file operation.

Backups live on the same disk as the database — copy `data/backups/`
somewhere off-machine periodically if the data matters to you.

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

## Building a distributable wheel (with the UI inside)

`pip install ludovitae` should ship the whole app — server *and* built UI — so
`gol-serve` works with no separate frontend step. Build the SPA, stage it into
the package as `gol/_webdist/` (gitignored; hatchling force-includes it into the
wheel), then build:

```sh
# build wheel with UI
cd web && npm run build && cp -r dist ../server/src/gol/_webdist && cd ../server && uv build
```

Or run the wrapper (installs web deps, stages, builds) from the repo root:

```sh
scripts/build-wheel.sh
```

At runtime the server finds the UI in this order: `GOL_WEB_DIST` (explicit
override — used exclusively when set), the repo's `web/dist` (source checkout),
then the packaged `gol/_webdist/`. With none present it runs in API-only mode.
