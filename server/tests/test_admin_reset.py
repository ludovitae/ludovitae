"""#27 — POST /admin/reset: typed-phrase confirm, pre-reset backup, exact
preservation list (auth credential + sessions + settings + AI), demo/empty
modes."""

from __future__ import annotations

import pytest
from sqlalchemy import select

from conftest import PASSWORD
from gol.backup import backups_dir
from gol.importers.builtin_presets import BUILTIN_PRESETS

BUILTIN_NAMES = {spec["name"] for spec in BUILTIN_PRESETS}
PHRASE = "reset ludovitae"


def _populate(authed) -> None:
    """A little of everything financial, plus preserved-side state."""
    acc = authed.post(
        "/api/v1/accounts",
        json={"name": "Chk", "type": "checking", "balance": 1200.0},
    ).json()
    authed.post("/api/v1/flows", json={
        "name": "Salary", "kind": "income", "amount_monthly": 5000.0,
    })
    authed.post("/api/v1/goals", json={"name": "Boat", "target_amount": 100.0})
    authed.post("/api/v1/scenarios", json={"name": "S", "params": {}})
    authed.post("/api/v1/rules", json={"pattern": "x", "category": "y"})
    authed.post("/api/v1/household", json={
        "name": "Partner", "role": "partner", "birth_year": 1985,
        "life_expectancy": 90,
    })
    csv_data = "Date,Amount,Description\n2026-06-01,-10.00,Shop\n"
    authed.post(
        "/api/v1/import/commit",
        files={"file": ("t.csv", csv_data, "text/csv")},
        data={"kind": "csv", "account_id": str(acc["id"]),
              "mapping": '{"date": "Date", "amount": "Amount", "payee": "Description"}',
              "save_preset": "My Bank"},
    )
    # preserved side: theme, AI key + budget
    authed.patch("/api/v1/settings", json={"theme": "game"})
    authed.put("/api/v1/settings/ai", json={
        "api_key": "sk-ant-demo-key-1234", "monthly_budget_usd": 7.5,
    })


def _reset(authed, mode: str, confirm: str = PHRASE):
    return authed.post("/api/v1/admin/reset", json={"mode": mode, "confirm": confirm})


# ------------------------------ validation ----------------------------------


def test_reset_requires_auth(client):
    resp = client.post("/api/v1/admin/reset", json={"mode": "empty", "confirm": PHRASE})
    assert resp.status_code == 401


def test_reset_requires_exact_phrase(authed):
    for bad in ("", "reset", "Reset Ludovitae", "reset ludovitae "):
        resp = _reset(authed, "empty", confirm=bad)
        assert resp.status_code == 422
        assert resp.json()["error"]["code"] == "confirm_required"
    # nothing was wiped by the failed attempts
    assert authed.get("/api/v1/auth/session").json()["authenticated"] is True


def test_reset_rejects_unknown_mode(authed):
    resp = _reset(authed, "nuke")
    assert resp.status_code == 422
    assert resp.json()["error"]["code"] == "validation_error"


# ------------------------------ empty mode ----------------------------------


def test_empty_reset_wipes_financial_preserves_auth_and_ai(authed):
    _populate(authed)
    resp = _reset(authed, "empty")
    assert resp.status_code == 200
    body = resp.json()
    assert body["mode"] == "empty"

    # backup taken FIRST, into the pre-reset rotation family
    assert body["backup"] is not None and body["backup"].startswith("pre-reset-")
    backup_path = backups_dir() / body["backup"]
    assert backup_path.exists() and backup_path.stat().st_size > 0

    # zero financial rows
    assert authed.get("/api/v1/accounts").json() == []
    assert authed.get("/api/v1/flows").json() == []
    assert authed.get("/api/v1/goals").json() == []
    assert authed.get("/api/v1/transactions").json() == []
    scenarios = authed.get("/api/v1/scenarios").json()
    assert [s["id"] for s in scenarios] == [0]  # only the synthetic baseline
    assert authed.get("/api/v1/spending").json()["categories"] == []
    assert authed.get("/api/v1/rules").json() == []
    # presets: built-ins re-seeded, user preset gone
    presets = authed.get("/api/v1/import/presets").json()
    assert {p["name"] for p in presets} == BUILTIN_NAMES

    # household back to a single fresh self member with nulls
    household = authed.get("/api/v1/household").json()
    assert len(household) == 1
    you = household[0]
    assert (you["name"], you["role"]) == ("You", "self")
    assert you["retirement_age"] is None
    assert you["ss_monthly_at_fra"] is None
    assert you["ss_claim_age"] is None

    # profile back to defaults
    profile = authed.get("/api/v1/profile").json()
    assert profile["annual_retirement_spending"] == 80000.0
    assert profile["inflation_pct"] == 2.5
    assert profile["effective_tax_rate_pct"] is None

    # PRESERVED: session still live, settings, AI key + budget + usage table
    assert authed.get("/api/v1/auth/session").json()["authenticated"] is True
    assert authed.get("/api/v1/settings").json()["theme"] == "game"
    ai = authed.get("/api/v1/settings/ai").json()
    assert ai["has_api_key"] is True
    assert ai["api_key_last4"] == "1234"
    assert ai["monthly_budget_usd"] == 7.5

    # PRESERVED: the password — a fresh login still works
    assert authed.post("/api/v1/auth/logout").status_code == 204
    login = authed.post("/api/v1/auth/login", json={"password": PASSWORD})
    assert login.status_code == 200


def test_empty_reset_on_fresh_db_is_safe(authed):
    """First-run 'Start empty' path: nothing to wipe, still 200; the DB file
    exists (schema + credential), so a backup is still taken."""
    resp = _reset(authed, "empty")
    assert resp.status_code == 200
    assert resp.json()["backup"].startswith("pre-reset-")
    assert authed.get("/api/v1/accounts").json() == []


# ------------------------------- demo mode ----------------------------------


def test_demo_reset_seeds_demo_household(authed):
    _populate(authed)
    resp = _reset(authed, "demo")
    assert resp.status_code == 200
    assert resp.json()["mode"] == "demo"

    accounts = authed.get("/api/v1/accounts").json()
    assert len(accounts) == 10  # the seeder's household
    household = authed.get("/api/v1/household").json()
    assert len(household) == 3
    assert sum(1 for m in household if m["role"] == "self") == 1
    scenarios = authed.get("/api/v1/scenarios").json()
    assert len(scenarios) == 4  # baseline + 3 seeded
    txns = authed.get("/api/v1/transactions?limit=10").json()
    assert len(txns) > 0
    # the user's pre-reset data is gone (wipe ran before the seed)
    assert not any(a["name"] == "Chk" for a in accounts)
    # preserved side still intact
    assert authed.get("/api/v1/settings").json()["theme"] == "game"
    assert authed.get("/api/v1/settings/ai").json()["has_api_key"] is True

    # a dashboard renders off the demo data (sanity end-to-end)
    dash = authed.get("/api/v1/dashboard").json()
    assert dash["net_worth"] != 0


def test_reset_backup_rotation_keeps_five(authed):
    _populate(authed)
    names = set()
    for _ in range(6):
        resp = _reset(authed, "empty")
        assert resp.status_code == 200
        names.add(resp.json()["backup"])
    kept = sorted(backups_dir().glob("pre-reset-*.db"))
    assert len(kept) <= 5


@pytest.mark.usefixtures("authed")
def test_reset_is_csrf_protected(authed):
    del authed.headers["X-CSRF-Token"]
    resp = authed.post(
        "/api/v1/admin/reset", json={"mode": "empty", "confirm": PHRASE}
    )
    assert resp.status_code == 403
    assert resp.json()["error"]["code"] == "csrf_required"


def _table_count(model) -> int:
    from gol.db import session_factory

    db = session_factory()()
    try:
        return len(db.execute(select(model)).scalars().all())
    finally:
        db.close()


def test_ai_usage_ledger_survives_reset(authed):
    """The preservation list is exact: ai_usage rows are never wiped."""
    from gol.db import session_factory
    from gol.models import AiUsage

    db = session_factory()()
    try:
        db.add(AiUsage(month="2026-06", purpose="categorize",
                       input_tokens=10, output_tokens=5, est_cost_usd=0.01))
        db.commit()
    finally:
        db.close()
    assert _reset(authed, "empty").status_code == 200
    assert _table_count(AiUsage) == 1
