# Roadmap

## v1 — playable life (current)

- M1 Foundations: repo, docs, contracts, scaffolds, auth, schema. ← we are here
- M2 Core loop: accounts/flows/goals CRUD, dashboard, deterministic projection.
- M3 The game: scenario studio, Monte Carlo engine, compare mode, fan charts.
- M4 Data in: CSV/OFX import with preview + dedupe.
- M5 Hardening: QA pass, security review, TLS/LAN packaging, game theme skin.

## v2

- Live account sync (SimpleFIN first, Plaid evaluated) via SyncAdapter.
- Tax-aware modeling: brackets, withdrawal ordering, RMDs, capital gains.
- Historical-bootstrap return sampling; correlated asset classes.
- Forgejo migration: PR workflow, CI (pytest + vitest + playwright), releases.
- Spending analytics from imported transactions; goal auto-funding suggestions.
