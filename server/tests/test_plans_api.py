"""Plan snapshots + tracking (v1.3, #21).

Covers the four acceptance areas from the task:
  * snapshot immutability under a simulated engine-version bump,
  * tracking math (net_worth/spending/saving) incl. within-normal-range,
  * benchmark exclusivity (zero-or-one),
  * capture / CRUD / validation.

Backdating a snapshot's created_at and seeding balance snapshots + investment
transactions is done through a direct session (get_db commits per request, so
a separate session against the same tmp DB sees committed rows).
"""

from __future__ import annotations

import datetime as dt

import gol
from gol.db import session_factory
from gol.importers.base import ParsedTransaction, dedupe_hash
from gol.models import BalanceSnapshot, PlanSnapshot, Transaction


def _setup_plan(authed) -> int:
    self_id = next(
        m["id"] for m in authed.get("/api/v1/household").json() if m["role"] == "self"
    )
    authed.patch(
        f"/api/v1/household/{self_id}",
        json={"name": "Brian", "birth_year": 1980, "retirement_age": 65,
              "life_expectancy": 92, "ss_monthly_at_fra": 2_200.0,
              "ss_claim_age": 67},
    )
    authed.post(
        "/api/v1/accounts",
        json={"name": "Brokerage", "type": "brokerage", "balance": 400_000,
              "asset_class": "mixed"},
    )
    authed.post(
        "/api/v1/flows",
        json={"name": "Salary", "kind": "income", "amount_monthly": 9_000,
              "member_id": self_id, "ends_at_retirement": True},
    )
    authed.post(
        "/api/v1/flows",
        json={"name": "Living", "kind": "expense", "amount_monthly": 5_000},
    )
    return self_id


def _snapshot(authed, name="2026 plan", **body) -> dict:
    body.setdefault("scenario_id", 0)
    body.setdefault("seed", 5)
    body.setdefault("n_paths", 100)
    resp = authed.post("/api/v1/plans/snapshot", json={"name": name, **body})
    assert resp.status_code == 201, resp.text
    return resp.json()


def _months_back(n: int) -> list[dt.date]:
    today = dt.date.today()
    out = []
    y, m = today.year, today.month
    for _ in range(n):
        out.append(dt.date(y, m, 1))
        m -= 1
        if m == 0:
            y, m = y - 1, 12
    return sorted(out)


# --- capture + summary -------------------------------------------------------


def test_snapshot_captures_full_response_and_summary(authed):
    _setup_plan(authed)
    snap = _snapshot(authed)
    assert snap["engine_version"] == gol.ENGINE_VERSION
    assert snap["is_benchmark"] is True  # first snapshot auto-benchmarks
    assert snap["captured_net_worth"] == 400_000.0
    # plan spending rate = the active expense flow ($5,000/mo)
    assert snap["monthly_spending"] == 5_000.0
    # frozen full response present with the sim arrays
    resp = snap["response"]
    assert set(resp["deterministic"]) == {"net_worth", "invested", "cash",
                                          "property", "debt"}
    assert set(resp["percentiles"]) == {"p10", "p25", "p50", "p75", "p90"}
    assert resp["start_year"] == dt.date.today().year
    assert snap["inputs_summary"]["net_worth"] == 400_000.0
    assert snap["inputs_summary"]["monthly_spending"] == 5_000.0


def test_snapshot_with_params_captures_scenario_diff(authed):
    _setup_plan(authed)
    snap = _snapshot(authed, name="Frugal", scenario_id=None,
                     params={"spending_delta_pct": -20.0})
    # -20% on the $5,000 expense -> $4,000/mo plan spending
    assert snap["monthly_spending"] == 4_000.0
    assert snap["scenario_id"] is None
    assert snap["inputs_summary"]["params"] == {"spending_delta_pct": -20.0}


def test_snapshot_rejects_both_scenario_and_params(authed):
    _setup_plan(authed)
    resp = authed.post(
        "/api/v1/plans/snapshot",
        json={"name": "x", "scenario_id": 0, "params": {}},
    )
    assert resp.status_code == 400
    assert resp.json()["error"]["code"] == "bad_request"


def test_snapshot_unknown_scenario_404(authed):
    _setup_plan(authed)
    resp = authed.post(
        "/api/v1/plans/snapshot", json={"name": "x", "scenario_id": 999}
    )
    assert resp.status_code == 404


# --- immutability under an engine-version bump ------------------------------


def test_snapshot_immutable_under_engine_upgrade(authed, monkeypatch):
    """The whole point: an engine upgrade must not move an old plan. Capture,
    then simulate an engine-version bump — a fresh /simulate reports the new
    version, but the stored snapshot keeps its frozen numbers and version."""
    _setup_plan(authed)
    snap = _snapshot(authed, seed=11)
    frozen_nw = snap["response"]["deterministic"]["net_worth"]
    frozen_version = snap["response"]["engine_version"]
    plan_id = snap["id"]

    # Bump the engine version everywhere the response reads it.
    monkeypatch.setattr(gol, "ENGINE_VERSION", "999")
    import gol.api.simulate as sim_mod
    monkeypatch.setattr(sim_mod, "ENGINE_VERSION", "999")

    fresh = authed.post(
        "/api/v1/simulate", json={"scenario_id": 0, "seed": 11, "n_paths": 100}
    ).json()
    assert fresh["engine_version"] == "999"  # new engine really is active

    # the frozen snapshot is untouched
    reread = authed.get(f"/api/v1/plans/{plan_id}").json()
    assert reread["engine_version"] == frozen_version
    assert reread["response"]["engine_version"] == frozen_version
    assert reread["response"]["deterministic"]["net_worth"] == frozen_nw


# --- benchmark exclusivity ---------------------------------------------------


def test_benchmark_is_zero_or_one(authed):
    _setup_plan(authed)
    a = _snapshot(authed, name="A")
    b = _snapshot(authed, name="B")
    c = _snapshot(authed, name="C")
    # only the first is a benchmark
    assert a["is_benchmark"] is True
    assert b["is_benchmark"] is False and c["is_benchmark"] is False

    # promoting B demotes A (exactly one benchmark at all times)
    authed.patch(f"/api/v1/plans/{b['id']}", json={"is_benchmark": True})
    flags = {p["id"]: p["is_benchmark"] for p in authed.get("/api/v1/plans").json()}
    assert flags == {a["id"]: False, b["id"]: True, c["id"]: False}

    # promoting C demotes B
    authed.patch(f"/api/v1/plans/{c['id']}", json={"is_benchmark": True})
    flags = {p["id"]: p["is_benchmark"] for p in authed.get("/api/v1/plans").json()}
    assert sum(flags.values()) == 1 and flags[c["id"]] is True

    # a benchmark can be cleared, leaving zero
    authed.patch(f"/api/v1/plans/{c['id']}", json={"is_benchmark": False})
    flags = {p["id"]: p["is_benchmark"] for p in authed.get("/api/v1/plans").json()}
    assert sum(flags.values()) == 0


def test_delete_plan(authed):
    _setup_plan(authed)
    snap = _snapshot(authed)
    assert authed.delete(f"/api/v1/plans/{snap['id']}").status_code == 204
    assert authed.get(f"/api/v1/plans/{snap['id']}").status_code == 404
    assert authed.get("/api/v1/plans").json() == []


# --- tracking math -----------------------------------------------------------


def _brokerage_id(authed) -> int:
    return next(
        a["id"] for a in authed.get("/api/v1/accounts").json()
        if a["name"] == "Brokerage"
    )


def _interp_at(series: list[dict], date_str: str) -> float:
    """Mirror of the endpoint's linear interpolation, for asserting against
    the returned plan/band arrays at the actual 'now' date."""
    target = dt.date.fromisoformat(date_str)
    pts = sorted((dt.date.fromisoformat(p["date"]), p["value"]) for p in series)
    if target <= pts[0][0]:
        return pts[0][1]
    if target >= pts[-1][0]:
        return pts[-1][1]
    for i in range(1, len(pts)):
        d1, v1 = pts[i]
        if target <= d1:
            d0, v0 = pts[i - 1]
            span = (d1 - d0).days or 1
            return v0 + (v1 - v0) * ((target - d0).days / span)
    return pts[-1][1]


def _seed_flat_nw(authed, plan_id, acc_id, value):
    """Backdate created_at ~4 months and set actual net worth to a flat value
    across every tracked month (clearing the setup's today-dated balance so
    'now' reflects exactly this value)."""
    db = session_factory()()
    try:
        months = _months_back(4)
        today = dt.date.today()
        snap = db.get(PlanSnapshot, plan_id)
        snap.created_at = dt.datetime.combine(months[0], dt.time(12, 0))
        for b in db.execute(BalanceSnapshot.__table__.select()).all():
            db.delete(db.get(BalanceSnapshot, b.id))
        db.flush()
        for m in months:
            db.add(BalanceSnapshot(account_id=acc_id, date=m, amount=value))
        if months[-1] != today:
            db.add(BalanceSnapshot(account_id=acc_id, date=today, amount=value))
        db.commit()
    finally:
        db.close()


def test_tracking_net_worth_ahead(authed):
    _setup_plan(authed)
    snap = _snapshot(authed, seed=3)
    acc_id = _brokerage_id(authed)
    # probe the interpolated plan value at 'now', then seed comfortably above it
    _seed_flat_nw(authed, snap["id"], acc_id, snap["captured_net_worth"])
    probe = authed.get(f"/api/v1/plans/{snap['id']}/tracking?metric=net_worth").json()
    now = probe["actual"][-1]["date"]
    plan_now = _interp_at(probe["plan"], now)
    _seed_flat_nw(authed, snap["id"], acc_id, plan_now + 50_000)

    tr = authed.get(f"/api/v1/plans/{snap['id']}/tracking?metric=net_worth").json()
    assert tr["metric"] == "net_worth"
    assert tr["band"] is not None and "p25" in tr["band"] and "p75" in tr["band"]
    assert tr["actual"], "expected monthly actual points"
    assert tr["delta_now"] > 0
    assert tr["status"] == "ahead"


def test_tracking_net_worth_within_normal_range(authed):
    """Below the deterministic line but inside p25-p75 is 'within_normal_range',
    NOT 'behind' — the model-honesty framing (assumptions-strip precedent)."""
    _setup_plan(authed)
    snap = _snapshot(authed, seed=3)
    acc_id = _brokerage_id(authed)
    _seed_flat_nw(authed, snap["id"], acc_id, snap["captured_net_worth"])
    probe = authed.get(f"/api/v1/plans/{snap['id']}/tracking?metric=net_worth").json()
    now = probe["actual"][-1]["date"]
    plan_now = _interp_at(probe["plan"], now)
    p25_now = _interp_at(probe["band"]["p25"], now)
    assert p25_now < plan_now, "band must have spread by now for this test"
    target = (plan_now + p25_now) / 2.0  # below plan, above p25
    _seed_flat_nw(authed, snap["id"], acc_id, target)

    tr = authed.get(f"/api/v1/plans/{snap['id']}/tracking?metric=net_worth").json()
    assert tr["delta_now"] < 0  # below the deterministic plan line
    assert tr["status"] == "within_normal_range"


def test_tracking_net_worth_behind_below_p25(authed):
    _setup_plan(authed)
    snap = _snapshot(authed, seed=3)
    acc_id = _brokerage_id(authed)
    _seed_flat_nw(authed, snap["id"], acc_id, snap["captured_net_worth"])
    probe = authed.get(f"/api/v1/plans/{snap['id']}/tracking?metric=net_worth").json()
    now = probe["actual"][-1]["date"]
    p25_now = _interp_at(probe["band"]["p25"], now)
    _seed_flat_nw(authed, snap["id"], acc_id, p25_now - 50_000)

    tr = authed.get(f"/api/v1/plans/{snap['id']}/tracking?metric=net_worth").json()
    assert tr["status"] == "behind"


def test_tracking_no_actual_yet(authed):
    """A snapshot with no balance history after capture -> empty actual,
    null delta/status (nothing to compare)."""
    _setup_plan(authed)
    snap = _snapshot(authed)
    # created_at is now; no complete months, and the seeded balance is today's
    tr = authed.get(f"/api/v1/plans/{snap['id']}/tracking?metric=spending").json()
    assert tr["actual"] == []
    assert tr["delta_now"] is None and tr["status"] is None


def _seed_txns(db, account_id, rows):
    for date, amount, payee, category in rows:
        parsed = ParsedTransaction(date=date, amount=amount, payee=payee,
                                   category=category)
        db.add(Transaction(
            account_id=account_id, date=date, amount=amount, payee=payee,
            category=category, category_source="manual",
            dedupe_hash=dedupe_hash(account_id, parsed),
        ))


def test_tracking_spending_over_plan_is_behind(authed):
    _setup_plan(authed)  # plan spending = $5,000/mo
    snap = _snapshot(authed)
    checking_id = authed.post(
        "/api/v1/accounts",
        json={"name": "Checking", "type": "checking", "asset_class": "cash"},
    ).json()["id"]
    db = session_factory()()
    try:
        months = _months_back(4)
        snap_row = db.get(PlanSnapshot, snap["id"])
        snap_row.created_at = dt.datetime.combine(months[0], dt.time(12, 0))
        # $6,000/mo of real outflows in each complete month (over the $5k plan)
        rows = []
        for m in months[:-1]:  # complete months only
            rows.append((m + dt.timedelta(days=3), -3_000.0, "Rent", "housing"))
            rows.append((m + dt.timedelta(days=10), -3_000.0, "Life", "living"))
            # a transfer that must NOT count as spending
            rows.append((m + dt.timedelta(days=5), -2_000.0, "Move money",
                         "transfer"))
        _seed_txns(db, checking_id, rows)
        db.commit()
    finally:
        db.close()
    tr = authed.get(f"/api/v1/plans/{snap['id']}/tracking?metric=spending").json()
    assert tr["band"] is None
    assert tr["actual"], "expected complete-month spending points"
    # $6,000 actual vs $5,000 plan -> $1,000/mo over
    assert tr["actual"][-1]["value"] == 6_000.0
    assert tr["delta_now"] == 1_000.0
    assert tr["status"] == "behind"


def test_tracking_saving_from_investment_deposits(authed):
    _setup_plan(authed)
    snap = _snapshot(authed)
    brokerage_id = next(
        a["id"] for a in authed.get("/api/v1/accounts").json()
        if a["name"] == "Brokerage"
    )
    db = session_factory()()
    try:
        months = _months_back(4)
        snap_row = db.get(PlanSnapshot, snap["id"])
        snap_row.created_at = dt.datetime.combine(months[0], dt.time(12, 0))
        rows = []
        for m in months[:-1]:  # complete months
            # a positive deposit into the brokerage = observed saving
            rows.append((m + dt.timedelta(days=2), 1_200.0, "Contribution",
                         "investment-activity"))
            # a negative row (a sale) must not reduce saving below the deposits
            rows.append((m + dt.timedelta(days=6), -100.0, "Fee",
                         "investment-activity"))
        _seed_txns(db, brokerage_id, rows)
        db.commit()
    finally:
        db.close()
    tr = authed.get(f"/api/v1/plans/{snap['id']}/tracking?metric=saving").json()
    assert tr["band"] is None
    assert tr["actual"][-1]["value"] == 1_200.0  # positive deposits only


def test_tracking_bad_metric_422(authed):
    _setup_plan(authed)
    snap = _snapshot(authed)
    assert authed.get(
        f"/api/v1/plans/{snap['id']}/tracking?metric=bogus"
    ).status_code == 422


# --- dashboard benchmark stat ------------------------------------------------


def test_dashboard_benchmark_null_without_snapshot(authed):
    _setup_plan(authed)
    assert authed.get("/api/v1/dashboard").json()["benchmark"] is None


def test_dashboard_benchmark_reports_active(authed):
    _setup_plan(authed)
    snap = _snapshot(authed, seed=3)
    acc_id = _brokerage_id(authed)
    _seed_flat_nw(authed, snap["id"], acc_id, snap["captured_net_worth"])
    probe = authed.get(f"/api/v1/plans/{snap['id']}/tracking?metric=net_worth").json()
    plan_now = _interp_at(probe["plan"], probe["actual"][-1]["date"])
    _seed_flat_nw(authed, snap["id"], acc_id, plan_now + 25_000)

    bm = authed.get("/api/v1/dashboard").json()["benchmark"]
    assert bm is not None
    assert bm["plan_id"] == snap["id"]
    assert bm["metric"] == "net_worth"
    assert bm["status"] == "ahead"
    assert bm["delta_now"] > 0
