from __future__ import annotations

from conftest import PASSWORD


def test_session_reports_setup_required(client):
    body = client.get("/api/v1/auth/session").json()
    assert body == {"authenticated": False, "setup_required": True}


def test_setup_rejects_short_password(client):
    resp = client.post("/api/v1/auth/setup", json={"password": "shortpw"})
    assert resp.status_code == 400
    assert resp.json()["error"]["code"] == "password_too_short"


def test_setup_only_once(authed):
    resp = authed.post("/api/v1/auth/setup", json={"password": "another-password-1"})
    assert resp.status_code == 409
    assert resp.json()["error"]["code"] == "already_setup"


def test_login_flow_and_session_csrf(client):
    client.post("/api/v1/auth/setup", json={"password": PASSWORD})
    resp = client.post("/api/v1/auth/login", json={"password": PASSWORD})
    assert resp.status_code == 200
    csrf = resp.json()["csrf_token"]
    assert csrf
    assert "gol_session" in client.cookies

    body = client.get("/api/v1/auth/session").json()
    assert body["authenticated"] is True
    assert body["setup_required"] is False
    assert body["csrf_token"] == csrf


def test_bad_password_rejected(client):
    client.post("/api/v1/auth/setup", json={"password": PASSWORD})
    resp = client.post("/api/v1/auth/login", json={"password": "not-the-password"})
    assert resp.status_code == 401
    assert resp.json()["error"]["code"] == "invalid_credentials"


def test_unauthenticated_requests_get_401(client):
    resp = client.get("/api/v1/accounts")
    assert resp.status_code == 401
    assert resp.json()["error"]["code"] == "unauthenticated"


def test_mutation_without_csrf_forbidden(authed):
    del authed.headers["X-CSRF-Token"]
    resp = authed.post("/api/v1/goals", json={"name": "X", "target_amount": 10})
    assert resp.status_code == 403
    assert resp.json()["error"]["code"] == "csrf_required"


def test_wrong_csrf_token_forbidden(authed):
    authed.headers["X-CSRF-Token"] = "forged-token"
    resp = authed.post("/api/v1/goals", json={"name": "X", "target_amount": 10})
    assert resp.status_code == 403


def test_logout_invalidates_session(authed):
    assert authed.post("/api/v1/auth/logout").status_code == 204
    resp = authed.get("/api/v1/accounts")
    assert resp.status_code == 401


def test_stolen_cookie_after_logout_unusable(authed):
    cookie = authed.cookies["gol_session"]
    authed.post("/api/v1/auth/logout")
    authed.cookies.set("gol_session", cookie)
    assert authed.get("/api/v1/accounts").status_code == 401


def test_login_throttling_backs_off(client):
    client.post("/api/v1/auth/setup", json={"password": PASSWORD})
    for _ in range(3):
        assert client.post(
            "/api/v1/auth/login", json={"password": "wrong-password"}
        ).status_code == 401
    resp = client.post("/api/v1/auth/login", json={"password": "wrong-password"})
    assert resp.status_code == 429
    assert resp.json()["error"]["code"] == "too_many_attempts"
    assert int(resp.headers["Retry-After"]) >= 1


def test_security_headers_present(client):
    resp = client.get("/api/v1/auth/session")
    assert resp.headers["X-Content-Type-Options"] == "nosniff"
    assert "default-src 'self'" in resp.headers["Content-Security-Policy"]
    assert resp.headers["Referrer-Policy"] == "same-origin"


def test_no_plaintext_password_in_db(client, tmp_path):
    client.post("/api/v1/auth/setup", json={"password": PASSWORD})
    db_bytes = (tmp_path / "data" / "gol.db").read_bytes()
    assert PASSWORD.encode() not in db_bytes
    assert b"$argon2id$" in db_bytes
