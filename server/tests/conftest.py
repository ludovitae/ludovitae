from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from gol.db import reset_engine
from gol.main import create_app

PASSWORD = "correct-horse-battery"


@pytest.fixture()
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("GOL_DATA_DIR", str(tmp_path / "data"))
    reset_engine()
    app = create_app()
    with TestClient(app) as c:
        yield c
    reset_engine()


@pytest.fixture()
def authed(client):
    """Client with a live session; CSRF header attached to every request."""
    assert client.post("/api/v1/auth/setup", json={"password": PASSWORD}).status_code == 204
    resp = client.post("/api/v1/auth/login", json={"password": PASSWORD})
    assert resp.status_code == 200
    client.headers["X-CSRF-Token"] = resp.json()["csrf_token"]
    return client
