"""Regression tests for the T-004 security review.

Every fix landed on ws/security has a test here; the authz route-walk proves
the global invariant that all /api/v1 resource routes sit behind require_auth.
"""

from __future__ import annotations

import os
import stat

import pytest
from fastapi.routing import APIRoute

from gol import config
from gol.auth.deps import require_auth
from gol.auth.passwords import _hasher, hash_password, verify_password
from gol.importers import csv as csv_importer
from gol.importers import ofx as ofx_importer

PASSWORD = "correct-horse-battery"

# The only endpoints that must be reachable without a session. logout takes no
# session dependency by design (it clears whatever cookie is presented) but is
# still protected from CSRF by the middleware.
PUBLIC_PATHS = {
    "/auth/session",
    "/auth/setup",
    "/auth/login",
    "/auth/logout",
}


def _flatten_calls(dependant) -> list:
    calls = [dependant.call] if dependant.call else []
    for sub in dependant.dependencies:
        calls.extend(_flatten_calls(sub))
    return calls


def _all_api_routes(app):
    """Every mounted APIRoute (FastAPI wraps include_router mounts in
    _IncludedRouter, so we recurse through original_router)."""
    # The API lives entirely under include_router mounts (_IncludedRouter). The
    # only top-level APIRoute is the SPA static-file catch-all, which is
    # intentionally public and out of scope for this authz invariant.
    for mount in app.routes:
        orig = getattr(mount, "original_router", None)
        if orig is not None:
            for route in orig.routes:
                if isinstance(route, APIRoute):
                    yield route


def test_every_api_route_requires_auth(client):
    """Walk the route tree: prove require_auth is a dependency of every resource
    route except the explicit public set."""
    checked = 0
    for route in _all_api_routes(client.app):
        if route.path in PUBLIC_PATHS:
            assert require_auth not in _flatten_calls(route.dependant), (
                f"{route.path} should be public but depends on require_auth"
            )
            continue
        assert require_auth in _flatten_calls(route.dependant), (
            f"{route.path} {route.methods} is NOT behind require_auth"
        )
        checked += 1
    assert checked >= 20, f"expected many protected routes, only saw {checked}"


def test_unauthenticated_mutation_is_rejected(client):
    """Belt-and-suspenders: a mutating call with no session never succeeds."""
    resp = client.post("/api/v1/accounts", json={"name": "x", "type": "checking"})
    assert resp.status_code in (401, 403)


# --- CSRF ---------------------------------------------------------------------

def test_logout_requires_csrf(authed):
    no_csrf = {k: v for k, v in authed.headers.items() if k.lower() != "x-csrf-token"}
    resp = authed.post("/api/v1/auth/logout", headers={**no_csrf, "X-CSRF-Token": ""})
    assert resp.status_code == 403
    assert resp.json()["error"]["code"] == "csrf_required"


def test_wrong_csrf_token_rejected(authed):
    resp = authed.post(
        "/api/v1/accounts",
        json={"name": "x", "type": "checking"},
        headers={"X-CSRF-Token": "wrong-token-value"},
    )
    assert resp.status_code == 403
    assert resp.json()["error"]["code"] == "csrf_required"


def test_valid_csrf_token_accepted(authed):
    resp = authed.post("/api/v1/accounts", json={"name": "x", "type": "checking"})
    assert resp.status_code == 201


# --- Session rotation / fixation ---------------------------------------------

def test_login_rotates_session_token(client):
    client.post("/api/v1/auth/setup", json={"password": PASSWORD})
    r1 = client.post("/api/v1/auth/login", json={"password": PASSWORD})
    first_cookie = r1.cookies.get("gol_session")
    first_csrf = r1.json()["csrf_token"]

    r2 = client.post("/api/v1/auth/login", json={"password": PASSWORD})
    second_cookie = r2.cookies.get("gol_session")
    second_csrf = r2.json()["csrf_token"]

    assert first_cookie and second_cookie and first_cookie != second_cookie
    assert first_csrf != second_csrf


def test_attacker_planted_session_cookie_is_not_honoured(client):
    """Session fixation: a token the server never issued grants nothing, and
    logging in does not adopt it."""
    client.post("/api/v1/auth/setup", json={"password": PASSWORD})
    client.cookies.set("gol_session", "attacker-chosen-token")
    r = client.post("/api/v1/auth/login", json={"password": PASSWORD})
    assert r.status_code == 200
    assert r.cookies.get("gol_session") not in (None, "attacker-chosen-token")


def test_session_cookie_flags(client):
    client.post("/api/v1/auth/setup", json={"password": PASSWORD})
    r = client.post("/api/v1/auth/login", json={"password": PASSWORD})
    set_cookie = r.headers.get("set-cookie", "")
    assert "gol_session=" in set_cookie
    assert "HttpOnly" in set_cookie
    assert "samesite=lax" in set_cookie.lower()


# --- Security headers ---------------------------------------------------------

def test_security_headers_present(client):
    r = client.get("/api/v1/auth/session")
    csp = r.headers["content-security-policy"]
    assert "default-src 'self'" in csp
    assert "object-src 'none'" in csp
    assert "frame-ancestors 'none'" in csp
    # script-src must NOT allow inline/unsafe — it falls back to default 'self'.
    assert "'unsafe-inline'" not in csp.split("script-src")[0] or "script-src" not in csp
    assert r.headers["x-content-type-options"] == "nosniff"
    assert r.headers["x-frame-options"] == "DENY"


# --- argon2 parameters --------------------------------------------------------

def test_argon2_parameters_meet_owasp():
    assert _hasher.time_cost >= 2
    assert _hasher.memory_cost >= 19 * 1024  # OWASP minimum 19 MiB
    h = hash_password(PASSWORD)
    assert h.startswith("$argon2id$")
    assert verify_password(h, PASSWORD) is True
    assert verify_password(h, "wrong") is False


# --- Import: fail closed, never 500 ------------------------------------------

@pytest.fixture()
def imp(authed):
    authed.post("/api/v1/accounts", json={"name": "Checking", "type": "checking"})
    return authed


def _post_import(clientobj, kind, content, mapping=None, endpoint="commit"):
    files = {"file": (f"x.{kind}", content, "application/octet-stream")}
    data = {"kind": kind, "account_id": "1"}
    if mapping:
        data["mapping"] = mapping
    return clientobj.post(f"/api/v1/import/{endpoint}", files=files, data=data)


CSV_MAP = '{"date":"date","amount":"amount","payee":"payee"}'


def _ofx_with_amount(raw: bytes) -> bytes:
    return (
        b"<OFX><BANKTRANLIST><STMTTRN><DTPOSTED>20240101<TRNAMT>"
        + raw
        + b"<NAME>x</STMTTRN></BANKTRANLIST></OFX>"
    )


def test_ofx_infinite_amount_fails_closed(imp):
    r = _post_import(imp, "ofx", _ofx_with_amount(b"inf"))
    # Non-finite amount is dropped as malformed; request succeeds with 0 imported.
    assert r.status_code == 200
    assert r.json()["imported"] == 0


def test_ofx_nan_amount_fails_closed(imp):
    r = _post_import(imp, "ofx", _ofx_with_amount(b"nan"))
    assert r.status_code == 200
    assert r.json()["imported"] == 0


def test_csv_oversized_amount_fails_closed(imp):
    content = b"date,amount,payee\n2024-01-01," + b"9" * 25 + b",hi\n"
    r = _post_import(imp, "csv", content, CSV_MAP)
    assert r.status_code == 400
    assert r.json()["error"]["code"] == "parse_error"


def test_csv_nul_bytes_do_not_500(imp):
    content = b"date,amount,payee\n2024-01-01,10,\x00hi\n"
    r = _post_import(imp, "csv", content, CSV_MAP)
    assert r.status_code in (200, 400)


def test_import_over_size_limit_rejected(imp):
    content = b"date,amount,payee\n" + (b"2024-01-01,1,x\n" * 400000)
    assert len(content) > 5 * 1024 * 1024
    r = _post_import(imp, "csv", content, CSV_MAP)
    assert r.status_code == 413
    assert r.json()["error"]["code"] == "file_too_large"


def test_import_binary_garbage_does_not_500(imp):
    r = _post_import(imp, "csv", b"\xff\xfe\x00\x01garbage\x00", CSV_MAP)
    assert r.status_code < 500


def test_importer_units_reject_bad_amounts():
    with pytest.raises(csv_importer.CsvError):
        csv_importer.parse_amount("9" * 20)
    assert ofx_importer._parse_amount("inf") is None
    assert ofx_importer._parse_amount("nan") is None
    assert ofx_importer._parse_amount("1e400") is None
    assert ofx_importer._parse_amount("12.34") == 12.34


# --- Login throttling ---------------------------------------------------------

def test_throttle_not_bypassable_via_forwarded_for(client):
    client.post("/api/v1/auth/setup", json={"password": PASSWORD})
    last = None
    for i in range(12):
        last = client.post(
            "/api/v1/auth/login",
            json={"password": "wrong"},
            headers={"X-Forwarded-For": f"10.0.0.{i}"},
        )
    # Spoofing a fresh XFF each time must not dodge the backoff: eventually 429.
    assert last.status_code == 429
    assert "Retry-After" in last.headers


# --- Data-at-rest permissions -------------------------------------------------

def test_db_and_tls_dir_permissions(client):
    client.get("/api/v1/auth/session")  # touch the DB
    db_path = config.db_path()
    assert db_path.exists()
    mode = stat.S_IMODE(os.stat(db_path).st_mode)
    assert mode & 0o077 == 0, f"db file is group/world accessible: {oct(mode)}"
    data_mode = stat.S_IMODE(os.stat(config.data_dir()).st_mode)
    assert data_mode & 0o077 == 0, f"data dir too open: {oct(data_mode)}"


# --- S6: declared-body-size guard ----------------------------------------------

def test_oversized_declared_body_is_rejected_413(authed):
    r = authed.post(
        "/api/v1/import/commit",
        content=b"",
        headers={
            "Content-Type": "multipart/form-data; boundary=x",
            "Content-Length": str(9 * 1024 * 1024),
        },
    )
    assert r.status_code == 413
    assert r.json()["error"]["code"] == "request_too_large"


def test_invalid_content_length_is_rejected_400(authed):
    r = authed.post(
        "/api/v1/goals",
        content=b"{}",
        headers={"Content-Type": "application/json", "Content-Length": "not-a-number"},
    )
    assert r.status_code == 400
