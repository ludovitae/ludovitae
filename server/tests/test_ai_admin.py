"""T-007 AI budget & admin: masked settings, write-only key, ledger
aggregation, and the hard-stop guard every future AI caller must use."""

from __future__ import annotations

import datetime as dt

import pytest

from gol.ai_budget import check_ai_budget, month_key, record_ai_usage
from gol.db import session_factory
from gol.errors import ApiError
from gol.models import AiUsage


def _db():
    return session_factory()()


def test_settings_defaults(authed):
    body = authed.get("/api/v1/settings/ai").json()
    assert body == {
        "has_api_key": False, "api_key_last4": None, "enabled": False,
        "monthly_budget_usd": 5.0, "spend_this_month_usd": 0.0,
        "tokens_this_month": {"input": 0, "output": 0},
    }


def test_key_is_write_only_and_maskable(authed):
    secret = "sk-ant-api03-verysecret-x7Q2"
    put = authed.put("/api/v1/settings/ai", json={"api_key": secret, "enabled": True})
    assert put.status_code == 200
    assert secret not in put.text  # never echoed
    body = put.json()
    assert body["has_api_key"] is True
    assert body["api_key_last4"] == "x7Q2"
    assert body["enabled"] is True

    # subsequent GET stays masked; other fields update without touching key
    got = authed.get("/api/v1/settings/ai").json()
    assert got["api_key_last4"] == "x7Q2"
    budget = authed.put("/api/v1/settings/ai", json={"monthly_budget_usd": 2.5}).json()
    assert budget["monthly_budget_usd"] == 2.5 and budget["has_api_key"] is True

    # api_key: null deletes it
    cleared = authed.put("/api/v1/settings/ai", json={"api_key": None}).json()
    assert cleared["has_api_key"] is False and cleared["api_key_last4"] is None

    assert authed.put("/api/v1/settings/ai", json={"api_key": "short"}).status_code == 422
    assert authed.put(
        "/api/v1/settings/ai", json={"monthly_budget_usd": -1}
    ).status_code == 422


def test_budget_guard_hard_stops_at_budget(authed):
    authed.put("/api/v1/settings/ai", json={"monthly_budget_usd": 1.0})
    db = _db()
    try:
        check_ai_budget(db, projected_cost_usd=0.99)  # fits
        record_ai_usage(db, "categorize", input_tokens=1000, output_tokens=200,
                        est_cost_usd=0.75)
        db.commit()
        check_ai_budget(db, projected_cost_usd=0.25)  # exactly at budget: allowed
        with pytest.raises(ApiError) as exc:
            check_ai_budget(db, projected_cost_usd=0.26)  # would exceed
        assert exc.value.status_code == 403
        assert exc.value.code == "ai_budget_exhausted"

        record_ai_usage(db, "categorize", input_tokens=500, output_tokens=100,
                        est_cost_usd=0.30)
        db.commit()
        with pytest.raises(ApiError):
            check_ai_budget(db)  # already over even with a zero-cost call
    finally:
        db.close()
    # the admin panel reflects the ledger
    body = authed.get("/api/v1/settings/ai").json()
    assert body["spend_this_month_usd"] == 1.05
    assert body["tokens_this_month"] == {"input": 1500, "output": 300}


def test_usage_endpoint_aggregates_by_month_and_purpose(authed):
    db = _db()
    try:
        record_ai_usage(db, "categorize", 1000, 200, 0.01)
        record_ai_usage(db, "categorize", 2000, 400, 0.02)
        record_ai_usage(db, "insights", 5000, 1000, 0.05)
        # an old month, written directly
        db.add(AiUsage(month="2026-01", purpose="categorize", input_tokens=10,
                       output_tokens=2, est_cost_usd=0.001,
                       created_at=dt.datetime(2026, 1, 15)))
        db.commit()
    finally:
        db.close()

    usage = authed.get("/api/v1/ai/usage?months=6").json()
    assert [u["month"] for u in usage] == [month_key(), "2026-01"]
    current = usage[0]
    assert current["input_tokens"] == 8000
    assert current["output_tokens"] == 1600
    assert current["est_cost_usd"] == 0.08
    assert current["by_purpose"]["categorize"] == {
        "input_tokens": 3000, "output_tokens": 600, "est_cost_usd": 0.03,
    }
    assert current["by_purpose"]["insights"]["est_cost_usd"] == 0.05

    only_one = authed.get("/api/v1/ai/usage?months=1").json()
    assert [u["month"] for u in only_one] == [month_key()]
    assert authed.get("/api/v1/ai/usage?months=0").status_code == 422
