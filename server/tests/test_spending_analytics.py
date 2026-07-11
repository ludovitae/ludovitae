"""T-007 analytics endpoints: summary math, recurring detection over the API,
hotspots (spikes/merchants/price hikes/forgotten), forecast composition."""

from __future__ import annotations

import datetime as dt

import pytest

MAPPING = '{"date": "Date", "amount": "Amount", "payee": "Description", "category": "Category"}'


def _shift_month(months: int, day: int) -> dt.date:
    today = dt.date.today()
    total = today.year * 12 + (today.month - 1) + months
    return dt.date(total // 12, total % 12 + 1, day)


def _import_csv(authed, account_id: int, rows: list[str]):
    csv_data = "Date,Amount,Description,Category\n" + "\n".join(rows) + "\n"
    resp = authed.post(
        "/api/v1/import/commit",
        files={"file": ("t.csv", csv_data, "text/csv")},
        data={"kind": "csv", "account_id": str(account_id), "mapping": MAPPING},
    )
    assert resp.status_code == 200, resp.text
    return resp.json()


@pytest.fixture()
def accounts(authed):
    checking = authed.post(
        "/api/v1/accounts", json={"name": "Chk", "type": "checking"}
    ).json()
    card = authed.post(
        "/api/v1/accounts", json={"name": "Card", "type": "credit_card"}
    ).json()
    return checking, card


def test_summary_months_categories_and_transfer_exclusion(authed, accounts):
    checking, card = accounts
    _import_csv(authed, checking["id"], [
        "2026-01-15,-100.00,Green Basket,groceries",
        "2026-01-20,-50.00,Green Basket,groceries",
        "2026-02-11,-80.00,Green Basket,groceries",
        "2026-01-08,-40.00,Cafe Uno,dining",
        "2026-03-05,-10.00,Zorp,",
        "2026-02-10,-500.00,Payment to Card,",
        "2026-02-01,-999.00,To brokerage,transfer",  # v1.1 fallback exclusion
        "2025-12-31,-77.00,Out of window,groceries",
    ])
    _import_csv(authed, card["id"], ["2026-02-11,500.00,PAYMENT THANK YOU,"])

    body = authed.get(
        "/api/v1/spending/summary?from=2026-01-01&to=2026-03-31"
    ).json()
    assert body["months"] == ["2026-01", "2026-02", "2026-03"]
    assert body["categories"] == [
        {"category": "groceries", "totals": [150.0, 80.0, 0.0], "total": 230.0},
        {"category": "dining", "totals": [40.0, 0.0, 0.0], "total": 40.0},
        {"category": "uncategorized", "totals": [0.0, 0.0, 10.0], "total": 10.0},
    ]
    assert body["grand_total"] == 280.0

    assert authed.get("/api/v1/spending/summary?group_by=week").status_code == 422
    assert authed.get(
        "/api/v1/spending/summary?from=2026-03-01&to=2026-01-01"
    ).status_code == 422


def _seed_recurring(authed, checking_id: int, card_id: int) -> None:
    """Netflix on the card with a price hike 3 months ago; Spotify and weekly
    Green Basket groceries on checking; irregular one-offs."""
    card_rows = [
        f"{_shift_month(-m, 25)},-15.49,NETFLIX.COM,"
        for m in range(13, 3, -1)
    ] + [f"{_shift_month(-m, 25)},-17.99,NETFLIX.COM," for m in (3, 2, 1)]
    _import_csv(authed, card_id, card_rows)
    chk_rows = [f"{_shift_month(-m, 25)},-9.99,Spotify USA," for m in range(14, 0, -1)]
    chk_rows += [f"{_shift_month(-m, 3)},-100.00,GREEN BASKET #10{m % 2},groceries"
                 for m in range(14, 0, -1)]
    chk_rows += [
        f"{_shift_month(-5, 25)},-35.00,Random Shop,",
        f"{_shift_month(-2, 25)},-25.00,Random Shop,",
    ]
    _import_csv(authed, checking_id, chk_rows)


def test_recurring_endpoint_detects_subscriptions_and_price_change(authed, accounts):
    checking, card = accounts
    _seed_recurring(authed, checking["id"], card["id"])

    charges = {c["payee"]: c for c in authed.get("/api/v1/spending/recurring").json()}
    netflix = charges["NETFLIX.COM"]
    assert netflix["cadence"] == "monthly"
    assert netflix["category"] == "subscriptions"  # heuristic on import
    assert netflix["typical_amount"] == 15.49
    assert netflix["last_amount"] == 17.99
    assert netflix["price_change_pct"] == 16.1
    assert netflix["occurrences"] == 13
    assert netflix["active"] is True
    assert netflix["monthly_equivalent"] == 17.99

    spotify = charges["Spotify USA"]
    assert spotify["cadence"] == "monthly"
    assert spotify["price_change_pct"] == 0.0

    assert "Random Shop" not in charges  # 2 occurrences, irregular
    # sorted by monthly_equivalent desc: groceries (100) first
    ordered = [c["payee"] for c in authed.get("/api/v1/spending/recurring").json()]
    assert ordered.index(netflix["payee"]) < ordered.index("Spotify USA")


def test_hotspots_spikes_merchants_price_increases_forgotten(authed, accounts):
    checking, card = accounts
    _seed_recurring(authed, checking["id"], card["id"])
    # dining spike: alternating payees (never "recurring"), 40/mo baseline
    # months -12..-7, 90/mo in recent months -6..-1
    dining = [
        f"{_shift_month(-m, 12)},-40.00,{'Cafe Uno' if m % 2 else 'Cafe Dos'},dining"
        for m in range(12, 6, -1)
    ] + [
        f"{_shift_month(-m, 12)},-90.00,{'Cafe Uno' if m % 2 else 'Cafe Dos'},dining"
        for m in range(6, 0, -1)
    ]
    _import_csv(authed, checking["id"], dining)

    body = authed.get("/api/v1/spending/hotspots").json()

    spikes = {s["category"]: s for s in body["category_spikes"]}
    assert set(spikes) == {"dining"}  # groceries flat, subscriptions hike < 20%
    assert spikes["dining"]["baseline_monthly_avg"] == 40.0
    assert spikes["dining"]["recent_monthly_avg"] == 90.0
    assert spikes["dining"]["delta_pct"] == 125.0

    top = body["top_merchants"][0]
    assert top["payee"].startswith("GREEN BASKET")  # store numbers normalized away
    assert top["monthly_avg"] == 100.0
    assert top["txn_count"] == 6

    hikes = [c["payee"] for c in body["price_increases"]]
    assert hikes == ["NETFLIX.COM"]  # +16.1%; Spotify/groceries flat

    forgotten = [c["payee"] for c in body["possibly_forgotten"]]
    assert "Spotify USA" in forgotten  # flat, active, running 14 months
    assert "NETFLIX.COM" not in forgotten  # price hike -> variance above 5%


def test_forecast_recurring_plus_variable(authed, accounts):
    checking, card = accounts
    _seed_recurring(authed, checking["id"], card["id"])

    body = authed.get("/api/v1/spending/forecast?months=3").json()
    assert len(body["months"]) == 3
    next_month = _shift_month(1, 1)
    assert body["months"][0] == f"{next_month.year:04d}-{next_month.month:02d}"
    # monthly recurring: netflix 17.99 + spotify 9.99 + green basket 100
    assert body["recurring"] == [127.98, 127.98, 127.98]
    # variable: Random Shop only (60 over the 6-month lookback)
    assert body["variable_by_category"] == [
        {"category": "uncategorized", "monthly_avg": 10.0},
    ]
    assert body["total"] == [137.98, 137.98, 137.98]


def test_forecast_annual_charge_lands_in_anniversary_month(authed, accounts):
    checking, _card = accounts
    rows = [f"{_shift_month(-m, 20)},-120.00,DomainCo," for m in (25, 13, 1)]
    _import_csv(authed, checking["id"], rows)

    body = authed.get("/api/v1/spending/forecast?months=12").json()
    due = _shift_month(-1, 20).month
    expected = [120.0 if _shift_month(i + 1, 1).month == due else 0.0 for i in range(12)]
    assert body["recurring"] == expected
    assert body["variable_by_category"] == []
    assert body["total"] == expected
