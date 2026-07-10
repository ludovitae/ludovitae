# T-004 — Security review

Owner: security agent · Branch: `ws/security` · Status: todo (blocked on T-001 merge)

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
