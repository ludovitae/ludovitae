"""Generate the web mock's simulation fixtures from the REAL engine (#8).

The VITE_MOCK simulator used to reimplement Monte-Carlo dynamics in TypeScript,
which drifted from ``gol.sim`` forever. Instead, this script mirrors the web
mock's demo household (``web/src/api/mock/db.ts`` — 3 members, 12 accounts,
7 flows, 10 spending categories, 2 scenarios), runs the pinned real engine
across a small lattice over the studio's interactive sliders, and writes the
full ``SimResult`` for each lattice point to
``web/src/api/mock/fixtures/sim-fixtures.json``.

Run:  ``cd server && uv run python scripts/gen_mock_fixtures.py``
      ``uv run python scripts/gen_mock_fixtures.py --check``  (no-op / drift check)

Determinism: the household is pinned by absolute birth years and a fixed
``REFERENCE_DATE`` so regenerating is always a byte-for-byte no-op (a server
test asserts this; a vitest guard asserts the engine_version still matches the
web constant). Regenerate whenever the engine's behavior or version changes.
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import sys
import tempfile
from pathlib import Path

# Pinned so results never depend on the wall clock. Mirrors db.ts, whose demo
# household reads as ages 46 / 43 / 14 in 2026.
REFERENCE_DATE = dt.date(2026, 7, 1)
SEED = 42          # web useSimulation / useCompare default
N_PATHS = 1000     # web default n_paths

FIXTURES_PATH = (
    Path(__file__).resolve().parents[2]
    / "web" / "src" / "api" / "mock" / "fixtures" / "sim-fixtures.json"
)


def _bootstrap_db():
    """A throwaway in-memory-ish DB seeded with the db.ts demo household.

    Returns an open Session. Tables are created directly (no alembic) so the
    script stays fast and side-effect free.
    """
    os.environ.setdefault("GOL_DATA_DIR", tempfile.mkdtemp(prefix="gol-mock-fixtures-"))
    import gol.models as models  # noqa: F401  (register tables)
    from gol.db import Base, get_engine, reset_engine, session_factory

    reset_engine()
    Base.metadata.create_all(get_engine())
    db = session_factory()()
    _seed_demo_household(db, models)
    return db


def _seed_demo_household(db, models) -> None:
    """Mirror web/src/api/mock/db.ts exactly. Insertion order fixes the ids
    (members 1-3, accounts 1-12) that scenario ``member_overrides`` keys and
    contribution ``account_id`` references rely on."""
    Account = models.Account
    BalanceSnapshot = models.BalanceSnapshot
    Flow = models.Flow
    HouseholdMember = models.HouseholdMember
    Profile = models.Profile
    SpendingCategory = models.SpendingCategory

    db.add(Profile(
        annual_retirement_spending=80_000.0, inflation_pct=2.5,
        effective_tax_rate_pct=18.0, monthly_savings_target=1_500.0,
    ))

    # --- household (ids 1, 2, 3) ---
    db.add_all([
        HouseholdMember(name="Brian", role="self", birth_year=1980, life_expectancy=92,
                        retirement_age=65, ss_monthly_at_fra=2_200.0, ss_claim_age=67, notes=""),
        HouseholdMember(name="Dana", role="partner", birth_year=1983, life_expectancy=94,
                        retirement_age=67, ss_monthly_at_fra=1_600.0, ss_claim_age=67, notes=""),
        HouseholdMember(name="Wren", role="child", birth_year=2012, life_expectancy=95,
                        retirement_age=None, ss_monthly_at_fra=None, ss_claim_age=None, notes=""),
    ])
    db.flush()

    # --- accounts (ids 1..12), balance via a single snapshot at REFERENCE_DATE ---
    # (id, name, type, balance, growth_rate_pct, asset_class, member_id)
    account_rows = [
        (1, "Everyday Checking", "checking", 12_400.0, None, "cash", None),
        (2, "High-Yield Savings", "savings", 42_000.0, None, "cash", None),
        (3, "Vanguard Brokerage", "brokerage", 178_000.0, None, "stocks", None),
        (4, "401(k)", "retirement", 295_000.0, None, "mixed", 1),
        (5, "Roth IRA", "retirement", 88_000.0, None, "stocks", 1),
        (6, "HSA", "hsa", 24_500.0, None, "stocks", 2),
        (7, "House", "property", 480_000.0, 3.0, None, None),
        (8, "Subaru Outback", "vehicle", 14_000.0, -8.0, None, None),
        (9, "Mortgage", "mortgage", 315_000.0, None, None, None),
        (10, "Car Loan", "loan", 6_500.0, None, None, None),
        (11, "403(b)", "retirement", 96_000.0, None, "mixed", 2),
        (12, "Sapphire Card", "credit_card", 1_850.0, None, None, None),
    ]
    for _id, name, type_, balance, growth, asset_class, member_id in account_rows:
        acc = Account(
            name=name, type=type_, institution="", growth_rate_pct=growth,
            asset_class=asset_class, member_id=member_id, include_in_net_worth=True,
            notes="", created_at=REFERENCE_DATE,
        )
        acc.balances.append(BalanceSnapshot(date=REFERENCE_DATE, amount=balance))
        db.add(acc)
    db.flush()

    # --- flows (mirror db.ts; ends_at_retirement = kind != "expense") ---
    db.add_all([
        Flow(name="Salary — Brian", kind="income", amount_monthly=9_800.0,
             annual_growth_pct=3.0, category="salary", member_id=1, ends_at_retirement=True),
        Flow(name="Salary — Dana", kind="income", amount_monthly=6_200.0,
             annual_growth_pct=3.0, category="salary", member_id=2, ends_at_retirement=True),
        Flow(name="Mortgage payment", kind="expense", amount_monthly=2_350.0,
             annual_growth_pct=0.0, category="housing", member_id=None,
             end_date=dt.date(2041, 8, 1), ends_at_retirement=False),
        Flow(name="401(k) contributions", kind="contribution", amount_monthly=1_800.0,
             annual_growth_pct=0.0, category="retirement", member_id=1, account_id=4,
             ends_at_retirement=True),
        Flow(name="Roth IRA", kind="contribution", amount_monthly=580.0,
             annual_growth_pct=0.0, category="retirement", member_id=1, account_id=5,
             ends_at_retirement=True),
        Flow(name="HSA", kind="contribution", amount_monthly=350.0,
             annual_growth_pct=0.0, category="health", member_id=2, account_id=6,
             ends_at_retirement=True),
        Flow(name="Brokerage auto-invest", kind="contribution", amount_monthly=1_000.0,
             annual_growth_pct=0.0, category="investing", member_id=None, account_id=3,
             ends_at_retirement=True),
    ])

    # --- spending categories (mirror db.ts) ---
    cats = [
        ("Groceries", 950.0, "essential", None),
        ("Utilities", 320.0, "essential", None),
        ("Insurance", 380.0, "essential", None),
        ("Transportation", 420.0, "essential", None),
        ("Healthcare", 350.0, "essential", 5.0),
        ("Kids & school", 600.0, "essential", None),
        ("Dining out", 520.0, "discretionary", None),
        ("Travel", 500.0, "discretionary", None),
        ("Subscriptions", 85.0, "discretionary", None),
        ("Everything else", 900.0, "discretionary", None),
    ]
    db.add_all([
        SpendingCategory(name=n, monthly_amount=amt, kind=k, annual_growth_pct=g)
        for n, amt, k, g in cats
    ])
    db.flush()


# --- lattice definition -----------------------------------------------------
# Each axis is a 1-D sweep over one studio slider with every other slider at
# baseline, so the mock can interpolate along a single changed param. Values
# are chosen for even slider coverage; the baseline value itself is anchored by
# the shared baseline entry (params {}), so it is omitted here.

# member ids (from db.ts) → slider baselines
_BRIAN, _DANA = 1, 2


def _retirement_params(member_id: int, age: int) -> dict:
    return {"member_overrides": {str(member_id): {"retirement_age": age}}}


def _ss_params(member_id: int, age: int) -> dict:
    return {"member_overrides": {str(member_id): {"ss_claim_age": age}}}


AXES = [
    {
        "id": "retirement_age:1", "param": "retirement_age", "member_id": _BRIAN,
        "baseline_value": 65, "scale": 30.0,
        "values": [45, 50, 55, 58, 60, 62, 68, 70, 75],
        "params": lambda v: _retirement_params(_BRIAN, v),
    },
    {
        "id": "retirement_age:2", "param": "retirement_age", "member_id": _DANA,
        "baseline_value": 67, "scale": 30.0,
        "values": [45, 50, 55, 58, 60, 62, 65, 70, 75],
        "params": lambda v: _retirement_params(_DANA, v),
    },
    {
        "id": "ss_claim_age:1", "param": "ss_claim_age", "member_id": _BRIAN,
        "baseline_value": 67, "scale": 8.0,
        "values": [62, 63, 64, 65, 66, 68, 69, 70],  # full integer sweep (exact hits)
        "params": lambda v: _ss_params(_BRIAN, v),
    },
    {
        "id": "ss_claim_age:2", "param": "ss_claim_age", "member_id": _DANA,
        "baseline_value": 67, "scale": 8.0,
        "values": [62, 63, 64, 65, 66, 68, 69, 70],
        "params": lambda v: _ss_params(_DANA, v),
    },
    {
        "id": "spending_delta_pct", "param": "spending_delta_pct", "member_id": None,
        "baseline_value": 0, "scale": 60.0,
        "values": [-30, -20, -10, 10, 20, 30],
        "params": lambda v: {"spending_delta_pct": v},
    },
    {
        "id": "monthly_savings_delta", "param": "monthly_savings_delta", "member_id": None,
        "baseline_value": 0, "scale": 6000.0,
        "values": [-3000, -2000, -1000, -500, 500, 1000, 2000, 3000],
        "params": lambda v: {"monthly_savings_delta": v},
    },
    {
        "id": "annual_retirement_spending", "param": "annual_retirement_spending",
        "member_id": None, "baseline_value": 80_000, "scale": 130_000.0,
        "values": [30_000, 45_000, 60_000, 70_000, 90_000, 100_000, 120_000, 140_000, 160_000],
        "params": lambda v: {"annual_retirement_spending": v},
    },
]

# The two named scenarios from db.ts (stored as whole exact-match entries).
NAMED_SCENARIOS = [
    {
        "name": "Retire at 55",
        "params": {"retirement_age": 55, "annual_retirement_spending": 70_000},
    },
    {
        "name": "Coast mode",
        "params": {
            "monthly_savings_delta": -1500,
            "events": [
                {"name": "Take up golf", "kind": "recurring_expense",
                 "amount_monthly": 350, "start_age": 47, "end_age": None},
            ],
        },
    },
]


def _run(db, params: dict) -> dict:
    """Full /simulate response for these params (engine_version + notes +
    assumptions + engine core), matching gol.api.simulate exactly."""
    from gol import ENGINE_NOTES, ENGINE_VERSION
    from gol.api.simulate import _assumptions
    from gol.assembly import build_plan_inputs
    from gol.sim import run_simulation

    inputs = build_plan_inputs(db, params, today=REFERENCE_DATE)
    return {
        "engine_version": ENGINE_VERSION,
        "engine_notes": list(ENGINE_NOTES),
        "assumptions": _assumptions(inputs),
        **run_simulation(inputs, N_PATHS, SEED),
    }


def build_fixtures() -> dict:
    """Assemble the full fixtures document (importable by the drift test)."""
    from gol import ENGINE_NOTES, ENGINE_VERSION

    db = _bootstrap_db()
    try:
        doc = {
            "engine_version": ENGINE_VERSION,
            "engine_notes": list(ENGINE_NOTES),
            "reference_year": REFERENCE_DATE.year,
            "seed": SEED,
            "n_paths": N_PATHS,
            "baseline": {"params": {}, "result": _run(db, {})},
            "scenarios": [
                {"name": s["name"], "params": s["params"], "result": _run(db, s["params"])}
                for s in NAMED_SCENARIOS
            ],
            "axes": [
                {
                    "id": ax["id"],
                    "param": ax["param"],
                    "member_id": ax["member_id"],
                    "baseline_value": ax["baseline_value"],
                    "scale": ax["scale"],
                    "points": [
                        {"value": v, "params": ax["params"](v), "result": _run(db, ax["params"](v))}
                        for v in ax["values"]
                    ],
                }
                for ax in AXES
            ],
        }
        return doc
    finally:
        db.close()


def serialize(doc: dict) -> str:
    return json.dumps(doc, indent=2, sort_keys=True, ensure_ascii=False) + "\n"


def _smoke_test(doc: dict) -> None:
    """Fast structural sanity checks so `uv run` fails loudly on a broken run."""
    base = doc["baseline"]["result"]
    n = len(base["ages"])
    assert n > 1, "empty age axis"
    assert base["ages"][0] == REFERENCE_DATE.year - 1980, "self start age mismatch"
    for series in (*base["deterministic"].values(), *base["percentiles"].values()):
        assert len(series) == n, "series length mismatch"
    for ax in doc["axes"]:
        assert ax["points"], f"empty axis {ax['id']}"
        for p in ax["points"]:
            assert len(p["result"]["ages"]) == n, f"axis {ax['id']} ages mismatch"
    # monotonic sanity: retiring member 1 later never lowers ending net worth
    r1 = next(a for a in doc["axes"] if a["id"] == "retirement_age:1")
    lo = next(p for p in r1["points"] if p["value"] == 45)["result"]
    hi = next(p for p in r1["points"] if p["value"] == 70)["result"]
    assert hi["ending_net_worth"]["p50"] > lo["ending_net_worth"]["p50"], \
        "later retirement should not reduce median ending net worth"
    count = 1 + len(doc["scenarios"]) + sum(len(a["points"]) for a in doc["axes"])
    print(f"smoke ok: {count} fixture entries, {n}-point age axis")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true",
                        help="fail (non-zero) if regeneration would change the committed file")
    args = parser.parse_args()

    doc = build_fixtures()
    _smoke_test(doc)
    text = serialize(doc)

    if args.check:
        current = FIXTURES_PATH.read_text(encoding="utf-8") if FIXTURES_PATH.exists() else ""
        if current != text:
            print(f"DRIFT: {FIXTURES_PATH} is stale — run `uv run python "
                  f"scripts/gen_mock_fixtures.py` and commit.", file=sys.stderr)
            return 1
        print(f"fresh: {FIXTURES_PATH} matches a clean regeneration")
        return 0

    FIXTURES_PATH.parent.mkdir(parents=True, exist_ok=True)
    FIXTURES_PATH.write_text(text, encoding="utf-8")
    size_kb = len(text.encode("utf-8")) / 1024
    print(f"wrote {FIXTURES_PATH} ({size_kb:.0f} KB)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
