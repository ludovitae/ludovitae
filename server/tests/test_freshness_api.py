"""T-007 import freshness over the API: type defaults, states, overrides,
dashboard stale strip."""

from __future__ import annotations

import datetime as dt

from sqlalchemy import select

from gol.db import session_factory
from gol.models import Account


def _backdate_import(account_id: int, days: int) -> None:
    """Directly age an account's last_import_at (no API can time-travel)."""
    db = session_factory()()
    try:
        acc = db.execute(select(Account).where(Account.id == account_id)).scalar_one()
        acc.last_import_at = dt.datetime.now() - dt.timedelta(days=days)
        db.commit()
    finally:
        db.close()


def test_track_freshness_defaults_by_type(authed):
    cases = {
        "checking": True, "savings": True, "credit_card": True, "brokerage": True,
        "retirement": True, "hsa": True, "property": False, "vehicle": False,
        "mortgage": False, "loan": False, "other_asset": False, "other_liability": False,
    }
    for type_, expected in cases.items():
        acc = authed.post("/api/v1/accounts", json={"name": type_, "type": type_}).json()
        assert acc["track_freshness"] is expected, type_
        assert acc["freshness"] == ("never" if expected else "off"), type_
        assert acc["last_import_at"] is None and acc["newest_transaction_date"] is None

    # explicit override beats the type default
    acc = authed.post(
        "/api/v1/accounts",
        json={"name": "manual card", "type": "credit_card", "track_freshness": False},
    ).json()
    assert acc["track_freshness"] is False and acc["freshness"] == "off"


def test_import_commit_sets_freshness_fields(authed):
    acc = authed.post("/api/v1/accounts", json={"name": "Chk", "type": "checking"}).json()
    d = dt.date.today() - dt.timedelta(days=3)
    resp = authed.post(
        "/api/v1/import/commit",
        files={"file": ("t.csv", f"Date,Amount,Description\n{d},-1.00,X\n", "text/csv")},
        data={"kind": "csv", "account_id": str(acc["id"]),
              "mapping": '{"date": "Date", "amount": "Amount", "payee": "Description"}'},
    )
    assert resp.status_code == 200
    after = authed.get(f"/api/v1/accounts/{acc['id']}").json()
    assert after["last_import_at"] is not None
    assert after["newest_transaction_date"] == d.isoformat()
    assert after["freshness"] == "fresh"


def test_freshness_states_and_override(authed):
    acc = authed.post("/api/v1/accounts", json={"name": "Chk", "type": "checking"}).json()
    _backdate_import(acc["id"], 30)  # past 2/3 of the default 35
    assert authed.get(f"/api/v1/accounts/{acc['id']}").json()["freshness"] == "aging"
    _backdate_import(acc["id"], 40)
    assert authed.get(f"/api/v1/accounts/{acc['id']}").json()["freshness"] == "stale"

    # per-account threshold override: 40 days is fine for a quarterly account
    patched = authed.patch(f"/api/v1/accounts/{acc['id']}", json={"staleness_days": 90})
    assert patched.json()["staleness_days"] == 90
    assert patched.json()["freshness"] == "fresh"

    # tracking off silences it entirely
    off = authed.patch(f"/api/v1/accounts/{acc['id']}", json={"track_freshness": False})
    assert off.json()["freshness"] == "off"
    bad = authed.patch(f"/api/v1/accounts/{acc['id']}", json={"track_freshness": None})
    assert bad.status_code == 422


def test_dashboard_stale_accounts_strip(authed):
    fresh = authed.post("/api/v1/accounts", json={"name": "Fresh", "type": "checking"}).json()
    aging = authed.post("/api/v1/accounts", json={"name": "Aging", "type": "savings"}).json()
    stale = authed.post("/api/v1/accounts", json={"name": "Stale", "type": "credit_card"}).json()
    authed.post("/api/v1/accounts", json={"name": "House", "type": "property"})  # off
    _backdate_import(fresh["id"], 2)
    _backdate_import(aging["id"], 25)
    _backdate_import(stale["id"], 50)

    strip = authed.get("/api/v1/dashboard").json()["stale_accounts"]
    assert [(s["name"], s["freshness"], s["days_since_import"]) for s in strip] == [
        ("Stale", "stale", 50), ("Aging", "aging", 25),
    ]
    # 'never' accounts (no imports, no txns) are not in the strip
    assert all(s["name"] != "Fresh" for s in strip)
