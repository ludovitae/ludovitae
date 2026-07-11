# T-009 — v1.2a: first real baseline

Owner: frontend+backend agents · Branch: `ws/first-mile` · Status: open
(dev work done; owner validation against real exports + browser QA pending)

Exit criterion (from the PM review): **Brian's actual baseline fan chart
renders through the UI and looks right.**

## Scope

1. Minimal flow form (web): add/edit/delete modal from the accounts-form
   pattern — name, kind, amount_monthly, annual_growth_pct, owner,
   ends_at_retirement, linked account for contributions. Lives on the
   Spending hub's recurring-flows table.
2. Importer first-mile hardening (server+web): mapping presets per
   institution (saved column mappings keyed by CSV header fingerprint),
   sign-convention detection (charges-positive card CSVs; split debit/credit
   columns) with an explicit preview-step confirmation ("47 of 50 rows look
   like charges — flip signs?"). Validated against the owner's REAL exports
   in `data/first-mile/` (gitignored; owner supplies one export per
   institution — NEVER commit these).
3. Real-browser QA pass (owner-assisted): both themes, milestone chips,
   scenario studio, import wizard on real files.

## OWNER INPUT NEEDED

Drop one recent export per institution (CSV or OFX/QFX) into
`data/first-mile/`. Redact if desired — only column structure, date formats,
and sign conventions matter.

## Log

- 2026-07-11 (coordinator): created per accepted PM-review resequencing.
- 2026-07-11 (dev agent, ws/first-mile): scope 1–2 implemented minus
  owner-dependent parts (real-export validation, browser QA — untouched).
  - **Contract** (docs/API.md, "Import presets & sign conventions — v1.2.2,
    T-009", coordinator-ruled): `GET /import/presets`,
    `DELETE /import/presets/{id}`; preview gains `matched_preset` +
    `sign_hint`; commit gains `flip_signs` + `save_preset` (upsert by header
    fingerprint = sha256 of lowercased, sorted, comma-joined headers);
    mapping accepts `{debit, credit}` in place of `amount`.
  - **Server**: `ImportPreset` model + migration 0005; sign heuristic
    (credit_card/loan/mortgage + >80% positive → looks_flipped, plain-language
    reason); split debit/credit parsing (debit = outflow); trailing summary
    rows skipped only as a contiguous tail — mid-file bad rows stay hard
    parse errors. Durability tests' hardcoded head revision moved 0004→0005.
  - **Fixtures**: `server/tests/fixtures/institutions/` — 5 synthetic CSVs
    (charges-positive card w/ MM/DD/YYYY; split Debit/Credit; quoted payees
    with commas; UTF-8 BOM; trailing summary footers), each driven through
    preview → sign hint → commit+preset → dedupe → preset rematch. These
    stand in until real exports land in `data/first-mile/`.
  - **Web**: flow add/edit/delete modal on the Spending hub's recurring-flows
    table (name, kind, amount, growth, owner, ends-at-retirement, linked
    account for contributions, start/end dates; contribution requires an
    account before submit enables). Import wizard: "Using your X preset"
    banner with detach, sign-hint confirm step (checkbox pre-checked per
    hint/preset), save-preset name field on commit, debit/credit mapping UI
    with a split toggle. Mock API extended to the same contract.
  - **Gates**: server 315 passed (291 baseline + 24 new), ruff clean; web
    build+lint clean, 153 vitest tests passed (148 baseline + 5 new
    real-control interaction tests across flow-form and import-wizard
    suites). Security suite caught a fail-open in the first cut of trailing
    tolerance (an oversized amount on a dated trailing row was skipped);
    tightened so only date-less footer rows are ever skipped.
  - Status stays open: exit criterion (owner's real fan chart) needs owner
    exports + browser QA. Not pushed — coordinator does acceptance review.
