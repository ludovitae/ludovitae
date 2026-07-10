"""Security middleware: response headers and CSRF double-submit enforcement."""

from __future__ import annotations

import secrets

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request

from gol.auth.sessions import CSRF_HEADER, SESSION_COOKIE, lookup_session
from gol.db import session_factory
from gol.errors import error_response

MUTATING_METHODS = {"POST", "PATCH", "PUT", "DELETE"}
# No session exists yet at setup/login time, so no CSRF token can exist either.
CSRF_EXEMPT_PATHS = {"/api/v1/auth/setup", "/api/v1/auth/login"}

SECURITY_HEADERS = {
    "Content-Security-Policy": (
        "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; "
        "connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'self'; "
        "form-action 'self'; frame-ancestors 'none'"
    ),
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "same-origin",
    "X-Frame-Options": "DENY",
    "Cross-Origin-Opener-Policy": "same-origin",
    "Cache-Control": "no-store",
}


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        response = await call_next(request)
        for name, value in SECURITY_HEADERS.items():
            response.headers.setdefault(name, value)
        return response


# SECURITY-REVIEW-v1 S6: Starlette spools multipart bodies before route-level
# size checks run. Declared-length guard; a client lying about Content-Length
# gets dropped by h11 at the protocol layer, so this closes the honest-header
# spool path without buffering anything ourselves.
MAX_BODY_BYTES = 8 * 1024 * 1024


class BodyLimitMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        if request.method in MUTATING_METHODS:
            declared = request.headers.get("content-length")
            if declared is not None:
                try:
                    too_big = int(declared) > MAX_BODY_BYTES
                except ValueError:
                    return error_response(400, "bad_request", "invalid Content-Length")
                if too_big:
                    return error_response(
                        413, "request_too_large", "request body exceeds 8 MB limit"
                    )
        return await call_next(request)


class CsrfMiddleware(BaseHTTPMiddleware):
    """Require X-CSRF-Token matching the session's token on all mutating routes.

    Requests without a valid session fall through: the auth dependency answers
    401, which reveals nothing a CSRF attacker could use.
    """

    async def dispatch(self, request: Request, call_next):
        if (
            request.method in MUTATING_METHODS
            and request.url.path.startswith("/api/v1")
            and request.url.path not in CSRF_EXEMPT_PATHS
        ):
            raw = request.cookies.get(SESSION_COOKIE)
            if raw:
                db = session_factory()()
                try:
                    session = lookup_session(db, raw)
                    db.commit()
                finally:
                    db.close()
                if session is not None:
                    header = request.headers.get(CSRF_HEADER)
                    # Constant-time compare: never leak token bytes via timing.
                    if not header or not secrets.compare_digest(header, session.csrf_token):
                        return error_response(
                            403, "csrf_required", "missing or invalid X-CSRF-Token header"
                        )
        return await call_next(request)
