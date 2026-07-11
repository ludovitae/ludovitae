"""T-007 acceptance over the real seed: subscriptions detected, all card
payments auto-paired (empty candidates), price hike flagged, freshness mix."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from conftest import PASSWORD
from gol.db import reset_engine
from gol.main import create_app
from gol.seed import seed


@pytest.fixture()
def seeded(tmp_path, monkeypatch):
    monkeypatch.setenv("GOL_DATA_DIR", str(tmp_path / "data"))
    reset_engine()
    seed()
    app = create_app()
    with TestClient(app) as client:
        assert client.post("/api/v1/auth/setup", json={"password": PASSWORD}).status_code == 204
        resp = client.post("/api/v1/auth/login", json={"password": PASSWORD})
        client.headers["X-CSRF-Token"] = resp.json()["csrf_token"]
        yield client
    reset_engine()


def test_seeded_card_payments_all_auto_paired(seeded):
    accounts = {a["name"]: a for a in seeded.get("/api/v1/accounts").json()}
    card = accounts["Sapphire Card"]
    assert card["type"] == "credit_card" and card["track_freshness"] is True

    txns = seeded.get(f"/api/v1/transactions?account_id={card['id']}&limit=10000").json()
    payments = [t for t in txns if t["payee"] == "PAYMENT THANK YOU"]
    assert len(payments) == 14
    assert all(t["transfer_pair_id"] is not None for t in payments)
    # acceptance: nothing left to review
    assert seeded.get("/api/v1/transfers/candidates").json() == []


def test_seeded_recurring_finds_subscriptions(seeded):
    charges = {c["payee"]: c for c in seeded.get("/api/v1/spending/recurring").json()}
    assert charges["NETFLIX.COM"]["cadence"] == "monthly"
    assert charges["NETFLIX.COM"]["price_change_pct"] == 16.1
    assert charges["Spotify USA"]["cadence"] == "monthly"
    assert charges["Spotify USA"]["price_change_pct"] == 0.0
    assert charges["StreamCo"]["cadence"] == "monthly"  # uncategorized on purpose
    assert charges["DomainHost Renewal"]["cadence"] == "annual"
    assert all(charges[p]["active"] for p in
               ("NETFLIX.COM", "Spotify USA", "StreamCo", "DomainHost Renewal"))


def test_seeded_hotspots_flag_the_netflix_hike_only(seeded):
    body = seeded.get("/api/v1/spending/hotspots").json()
    assert [c["payee"] for c in body["price_increases"]] == ["NETFLIX.COM"]
    forgotten = [c["payee"] for c in body["possibly_forgotten"]]
    assert "Spotify USA" in forgotten


def test_seeded_freshness_mix_and_dashboard_strip(seeded):
    accounts = {a["name"]: a for a in seeded.get("/api/v1/accounts").json()}
    assert accounts["Everyday Checking"]["freshness"] == "fresh"
    assert accounts["Sapphire Card"]["freshness"] == "fresh"
    assert accounts["Rainy-Day Savings"]["freshness"] == "stale"
    assert accounts["The House"]["freshness"] == "off"

    strip = seeded.get("/api/v1/dashboard").json()["stale_accounts"]
    assert [s["name"] for s in strip] == ["Rainy-Day Savings"]
    assert strip[0]["freshness"] == "stale" and strip[0]["days_since_import"] == 60


def test_seeded_interest_charge_is_real_spending(seeded):
    summary = seeded.get("/api/v1/spending/summary").json()
    categories = {c["category"]: c for c in summary["categories"]}
    assert categories["interest-fees"]["total"] == 23.51
    # paired card payments are not spending
    assert "transfer" not in categories
    observed = seeded.get("/api/v1/spending/observed?months=12").json()
    assert all(c["category"] != "transfer" for c in observed["by_category"])
