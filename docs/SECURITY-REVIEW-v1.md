# Security Review v1 — Game of Life (T-004)

Reviewer: security agent · Branch: `ws/security` · Date: 2026-07-10

Scope: defensive review of our own code, authorized by the owner. Threat model
is a single-user personal-finance service on a home LAN behind a password;
adversaries are (a) anyone else on the LAN and (b) malicious import files the
owner is tricked into importing. Reviewed the full auth stack, import parsers,
SPA static serving, TLS/serve, db/config/errors, every `/api/v1` router, the
React XSS surface, login throttling, and dependency audits.

**Bottom line:** no critical/RCE/data-disclosure findings. The one high finding
(malicious import files crashing the request with a 500) and all medium findings
are fixed on `ws/security` with regression tests. `uv run pytest` = 66 passed,
`ruff check` clean, `pip-audit` and `npm audit --omit=dev` = 0 vulnerabilities.

## Findings

| ID | Area | Severity | Description | Exploit scenario | Status |
|---|---|---|---|---|---|
| C1 | Auth / CSRF | Medium | CSRF token compared with `!=` (non-constant-time) in `auth/middleware.py`. | LAN attacker times responses to recover a valid CSRF token byte-by-byte, then forges a state-changing request. | **fixed-in-ws-security** — now `secrets.compare_digest`. |
| C2 | Auth / hashing | Info | argon2id parameters left to library defaults. | Not exploitable today (defaults are strong), but a future argon2-cffi default change could silently weaken hashing. | **fixed-in-ws-security** — pinned t=3 / 64 MiB / p=4 (meets OWASP), verified in test. |
| C3 | Auth / sessions | Info | Verify a fresh session is issued per login (session fixation). | Fixation needs a client-settable session id; here tokens are server-generated 256-bit random, HttpOnly, stored SHA-256-hashed — not fixable. | **verified-safe + hardened** — login now also destroys any session named by the inbound cookie (rotation). |
| S1 | Import parsing | High | OFX `<TRNAMT>inf`/`nan` reached the Decimal→int64 cents column and crashed with a 500 (OverflowError / "cannot convert float NaN to integer"). | Owner imports a malicious OFX file; every commit of it 500s instead of returning the error envelope — parser fails open, not closed. | **fixed-in-ws-security** — non-finite amounts dropped as malformed (OFX) via `base.amount_ok`; regression test asserts 200/0-imported. |
| S2 | Import parsing | Medium | CSV/OFX amount wider than int64 cents (≥ ~19 digits) overflowed the SQLite INTEGER bind → 500. | Malicious CSV cell `9…9` (25 digits) crashes `/import/commit`. | **fixed-in-ws-security** — amounts bounded to \|v\| ≤ 1e13; CSV raises `parse_error`, OFX skips. Regression tested. |
| S3 | Headers / CSP | Low | CSP sets no `script-src`, so it falls back to `default-src 'self'`, which blocks the inline theme-bootstrap `<script>` in `web/index.html`. | Not a vuln; the built app degrades to a theme flash on first paint. Loosening `script-src` to `'unsafe-inline'` would be the wrong fix. | **flagged-to-coordinator** — frontend should externalize the bootstrap script (or add its sha256 to `script-src`). CSP kept restrictive. |
| S4 | Auth / throttling | Low | Login throttle check-then-act is not atomic; N parallel requests can each pass `retry_after` before any records a failure. | An on-LAN attacker fires bursts to get a few extra guesses per backoff window. | **accepted-risk** — single process, argon2 verify cost (~tens of ms) + 10-char minimum make the extra guesses negligible; single-user LAN. |
| S5 | Auth / throttling | Low | Throttle state is in-memory; a process restart clears all backoff. | Attacker who can restart the service (already needs host access) resets lockout. | **accepted-risk** — documented; restart requires host access, and argon2+min-length make online guessing infeasible regardless. |
| S6 | Import / DoS | Low | Starlette spools the full multipart upload to a temp file before the handler enforces the 5 MB `_read_limited` cap. | Authenticated owner (or anyone with the session) POSTs a multi-GB body to fill disk. | **deferred-to-v2 / flagged** — set a uvicorn/reverse-proxy request-body limit. Auth-gated and single-user (the only session holder is the owner), so low priority. |
| S7 | Data at rest | Low | SQLite `gol.db` created with umask default (often 0644) inside the 0700 data dir. | Only reachable by another local user, who is already blocked by the 0700 dir. | **fixed-in-ws-security** — `run_migrations` now chmods the db file to 0600 (defense in depth). Tested. |
| S8 | Auth / cookies | Info | Session cookie is `SameSite=Lax`, not `Strict`. | Lax already blocks cross-site POST CSRF; the double-submit CSRF token is the primary control anyway. | **accepted-risk** — matches ARCHITECTURE.md; same-origin SPA. |
| S9 | Import / injection | Low | CSV formula-injection cells (`=cmd\|…`, `+`, `-`, `@`) in payee/category are stored raw. | Harmless in-app (React escapes on render); only dangerous if the data is later exported to CSV and opened in a spreadsheet. | **deferred-to-v2** — v1 has no CSV export; sanitize (prefix `'`) when an export feature lands. |

## Verified safe (no action)

- **Authorization (proven by test):** every `/api/v1` route sits behind the
  `require_auth` dependency except `/auth/session`, `/auth/setup`,
  `/auth/login`, and `/auth/logout`. `test_every_api_route_requires_auth` walks
  the FastAPI route tree (through `_IncludedRouter` mounts) and asserts the
  invariant over all 31 protected routes; the SPA catch-all is intentionally
  public static serving.
- **CSRF coverage:** the middleware enforces `X-CSRF-Token` on every mutating
  `/api/v1` method for authenticated sessions, including `/auth/logout`
  (per API.md); only `/auth/setup` and `/auth/login` are exempt (no session
  exists yet). Requests without a session fall through to a 401.
- **Login throttle vs. `X-Forwarded-For`:** `_client_ip` uses
  `request.client.host` only and never trusts forwarded headers, so per-IP
  backoff cannot be bypassed by spoofing XFF. A global bucket backs the per-IP
  buckets. (Note for deployment: behind a reverse proxy all clients collapse to
  the proxy IP — acceptable for single-user, but don't add XFF trust naively.)
- **XSS:** no `dangerouslySetInnerHTML`, `innerHTML`, `document.write`, or
  `eval` in `web/`. User-controlled strings (account/goal/scenario names,
  emoji, payees, CSV preview cells) are rendered as escaped JSX text children.
  No user-controlled `href`/`src`/URL construction.
- **OFX entity expansion / billion laughs:** the OFX parser is regex-based over
  a flat tag stream and never invokes an XML entity-resolving parser, so
  external/nested entity expansion and quadratic-blowup attacks do not apply;
  deeply nested/repeated `<STMTTRN>` input parses to zero transactions without
  hang. The 5 MB size cap bounds work.
- **Path traversal (SPA serving):** `main._mount_spa` resolves the candidate and
  requires `is_relative_to(dist)`, so `../` and symlink escapes fall back to
  `index.html` rather than serving arbitrary files.
- **SQL injection:** all DB access is through SQLAlchemy 2.0 ORM / parameterized
  `select`/`delete`; no raw SQL or string-built queries anywhere.
- **TLS & secrets:** `serve.ensure_self_signed` writes the private key at 0600
  (touch + explicit chmod) into a 0700 `data/tls/`; plain HTTP is allowed only
  on loopback. No passwords, tokens, or financial data appear in logs or error
  bodies — the unhandled-exception handler returns a generic
  `{"error":{"code":"internal_error"}}` with no stack trace.
- **Dependencies:** `pip-audit` (server) and `npm audit --omit=dev` (web) both
  report 0 known vulnerabilities as of 2026-07-10.

## Fixed vs. flagged summary

- **Fixed on `ws/security`** (with regression tests): C1, C2, C3, S1, S2, S7.
- **Flagged to coordinator / deferred-to-v2:** S3 (frontend CSP inline script),
  S6 (request-body size limit), S9 (CSV-export formula-injection hardening).
- **Accepted risk (documented):** S4, S5, S8.

All high/critical findings are fixed. No architectural refactors were required.
