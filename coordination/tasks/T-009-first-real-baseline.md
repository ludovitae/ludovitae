# T-009 — v1.2a: first real baseline

Owner: frontend+backend agents · Branch: `ws/first-mile` · Status: todo
(HOLD until T-008 merges; needs owner input — see below)

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
