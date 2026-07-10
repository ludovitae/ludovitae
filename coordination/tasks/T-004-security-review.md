# T-004 — Security review

Owner: security agent · Branch: `ws/security` · Status: done

## Scope

Threat model: financial data on a home-LAN service; adversaries are anyone on
the LAN and malicious import files. Review and fix (small fixes directly on
`ws/security`; large ones flagged):

- Auth: argon2 params, session token entropy/rotation, cookie flags, logout
  invalidation, first-run setup race, login throttling bypasses.
- CSRF coverage of every mutating route; CORS config; security headers/CSP.
- Import parsing: OFX/CSV as attacker-controlled input (entity expansion,
  zip bombs via size limits, encoding tricks, path traversal in filenames).
- Injection: SQLAlchemy usage, any raw SQL, template/HTML injection via
  user-named entities (account names render in charts/tooltips).
- Secrets & data hygiene: nothing sensitive in logs, errors, or repo; TLS
  key permissions; DB file permissions.
- Dependency review: pin + audit (pip-audit / npm audit) with findings triaged.

## Acceptance criteria

- Written findings report at `docs/SECURITY-REVIEW-v1.md`: finding, severity,
  status (fixed/accepted/deferred + why).
- All high/critical findings fixed.

## Log

- 2026-07-10 (coordinator): task created.
- 2026-07-10 (coordinator): from T-001 acceptance review — CSRF token check in
  `server/src/gol/auth/middleware.py` compares with `!=`; use
  `secrets.compare_digest`. Verify argon2 params and session-fixation behavior
  (is a fresh session issued per login?) while in there.
- 2026-07-10 (security): review complete → status `review`. Report at
  `docs/SECURITY-REVIEW-v1.md` (11 findings + verified-safe section). Resolved
  all three coordinator items: CSRF now `secrets.compare_digest` (C1); argon2
  params pinned + verified against OWASP (C2); session fixation verified safe
  (server-generated tokens) and login now rotates the presented session (C3).
- 2026-07-10 (security): 1 High + 2 Medium fixed. High (S1) — malicious OFX
  `<TRNAMT>inf/nan` and Medium (S2) — oversized amounts crashed
  `/import/commit` with a 500; both now fail closed via `base.amount_ok`.
  Also fixed S7 (db file → 0600). Flagged S3 (frontend inline-script vs CSP),
  S6 (request-body size limit) to coordinator; S4/S5/S8 accepted-risk; S9
  deferred to v2. Authz proven by route-walk test over all 31 protected routes.
- 2026-07-10 (security): `uv run pytest` 66 passed, `ruff check` clean,
  `pip-audit` + `npm audit --omit=dev` = 0 vulnerabilities. 4 commits on
  `ws/security`. Note: edits were staged in the shared main working tree, then
  moved to the `ws/security` worktree via stash — nothing committed to `main`.
- 2026-07-10 (coordinator): merged to main; accepted after independent 66-test
  run and reading the auth/importer diffs. Resolved the two flagged items:
  S3 — theme bootstrap externalized to `web/public/theme-init.js` (CSP keeps
  script-src 'self', no first-paint flash); S6 — `BodyLimitMiddleware` rejects
  declared bodies > 8 MB with 413 (h11 drops lying clients at protocol layer);
  regression tests added (68 total). Status → done.
