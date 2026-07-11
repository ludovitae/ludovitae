"""T-003 static serving: FastAPI serves web/dist when present, with an SPA
fallback to index.html, and never escapes the dist dir on path-traversal
attempts (raw or percent-encoded).
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from gol.db import reset_engine
from gol.main import create_app

INDEX_MARKER = "<!--GOL-SPA-INDEX-->"
SECRET = "TOP-SECRET-OUTSIDE-DIST"


@pytest.fixture()
def spa(tmp_path, monkeypatch):
    dist = tmp_path / "dist"
    (dist / "assets").mkdir(parents=True)
    (dist / "index.html").write_text(f"<!doctype html><title>GoL</title>{INDEX_MARKER}")
    (dist / "assets" / "app.js").write_text("console.log('gol-app')")
    # a sibling file outside dist that traversal must never reach
    (tmp_path / "secret.txt").write_text(SECRET)
    (tmp_path.parent / "etc_passwd_probe").write_text(SECRET)  # sibling probe

    monkeypatch.setenv("GOL_DATA_DIR", str(tmp_path / "data"))
    monkeypatch.setenv("GOL_WEB_DIST", str(dist))
    reset_engine()
    app = create_app()
    with TestClient(app) as c:
        yield c
    reset_engine()


def test_serves_index_at_root(spa):
    resp = spa.get("/")
    assert resp.status_code == 200
    assert INDEX_MARKER in resp.text


def test_serves_real_asset(spa):
    resp = spa.get("/assets/app.js")
    assert resp.status_code == 200
    assert "gol-app" in resp.text


def test_spa_fallback_for_client_route(spa):
    # a client-side route (no such file) → index.html, so the SPA router boots
    resp = spa.get("/scenarios")
    assert resp.status_code == 200
    assert INDEX_MARKER in resp.text


def test_spa_fallback_for_missing_asset(spa):
    resp = spa.get("/assets/does-not-exist.js")
    assert resp.status_code == 200
    assert INDEX_MARKER in resp.text


def test_api_routes_still_win_over_spa(spa):
    # /api/v1 is registered before the SPA catch-all
    resp = spa.get("/api/v1/auth/session")
    assert resp.status_code == 200
    assert resp.json()["setup_required"] is True


def test_unknown_api_path_404s_json_not_index(spa):
    # D-003: an unknown API GET must return a JSON 404 envelope, never the SPA
    # index HTML (a client would otherwise parse HTML as an API response).
    resp = spa.get("/api/v1/does-not-exist")
    assert resp.status_code == 404
    assert resp.json()["error"]["code"] == "not_found"
    assert INDEX_MARKER not in resp.text


def test_api_prefixed_client_path_still_404s(spa):
    resp = spa.get("/api/something/else")
    assert resp.status_code == 404
    assert INDEX_MARKER not in resp.text


@pytest.mark.parametrize(
    "path",
    [
        "/../secret.txt",
        "/../../etc_passwd_probe",
        "/..%2fsecret.txt",
        "/%2e%2e/secret.txt",
        "/%2e%2e%2fsecret.txt",
        "/assets/../../secret.txt",
        "/assets/..%2f..%2fsecret.txt",
        "/....//secret.txt",
        "/%2e%2e%2f%2e%2e%2fetc_passwd_probe",
        "/..\\secret.txt",
    ],
)
def test_path_traversal_never_escapes_dist(spa, path):
    resp = spa.get(path)
    # whatever the router does (index fallback or 404), it must never leak the
    # out-of-dist file contents
    assert SECRET not in resp.text, f"traversal leaked via {path!r}"
    assert resp.status_code in (200, 404)


def test_absolute_path_request_does_not_escape(spa):
    resp = spa.get("/etc/passwd")
    assert SECRET not in resp.text
    # no real /etc/passwd content either — served the SPA index instead
    assert resp.status_code in (200, 404)


def test_no_spa_route_when_dist_absent(tmp_path, monkeypatch):
    """With no built frontend, the catch-all is not mounted (dev uses Vite)."""
    monkeypatch.setenv("GOL_DATA_DIR", str(tmp_path / "data"))
    monkeypatch.setenv("GOL_WEB_DIST", str(tmp_path / "nonexistent-dist"))
    reset_engine()
    app = create_app()
    with TestClient(app) as c:
        # a non-API path 404s (no SPA fallback registered)
        assert c.get("/some/client/route").status_code == 404
    reset_engine()


def test_serves_packaged_webdist_when_no_other_source(tmp_path, monkeypatch):
    """#13: with GOL_WEB_DIST unset and repo web/dist absent, the app serves the
    gol/_webdist bundle packaged into the wheel."""
    packaged = tmp_path / "_webdist"
    packaged.mkdir()
    (packaged / "index.html").write_text(f"<!doctype html><title>GoL</title>{INDEX_MARKER}")

    monkeypatch.setenv("GOL_DATA_DIR", str(tmp_path / "data"))
    monkeypatch.delenv("GOL_WEB_DIST", raising=False)
    # repo web/dist absent, packaged bundle present
    monkeypatch.setattr("gol.main._DEFAULT_DIST", tmp_path / "no-such-web-dist")
    monkeypatch.setattr("gol.main._PACKAGED_DIST", packaged)
    reset_engine()
    app = create_app()
    with TestClient(app) as c:
        resp = c.get("/")
        assert resp.status_code == 200
        assert INDEX_MARKER in resp.text
        # /api/v1 still wins over the bundled SPA
        assert c.get("/api/v1/auth/session").json()["setup_required"] is True
    reset_engine()


def test_api_only_when_no_dist_anywhere(tmp_path, monkeypatch):
    """#13: env unset, no repo dist, no packaged bundle → API-only mode."""
    monkeypatch.setenv("GOL_DATA_DIR", str(tmp_path / "data"))
    monkeypatch.delenv("GOL_WEB_DIST", raising=False)
    monkeypatch.setattr("gol.main._DEFAULT_DIST", tmp_path / "no-web-dist")
    monkeypatch.setattr("gol.main._PACKAGED_DIST", tmp_path / "no-webdist")
    reset_engine()
    app = create_app()
    with TestClient(app) as c:
        assert c.get("/some/client/route").status_code == 404
        # API still works
        assert c.get("/api/v1/auth/session").status_code == 200
    reset_engine()
