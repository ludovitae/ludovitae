"""`uv run gol-seed` — populate a realistic demo household (v1.1: two adults
with staggered ages/retirements, a child, owned accounts and salaries,
spending categories, and ~14 months of transactions so /spending/observed
has something to say).

Deterministic: amounts come from fixed formulas, never RNG. Idempotent-ish:
refuses to run if accounts already exist unless --force. Never creates a
password; first-run setup stays with the user.
"""

from __future__ import annotations

import argparse
import datetime as dt
import sys

from sqlalchemy import select

from gol.assembly import get_or_create_profile, get_or_create_settings
from gol.db import run_migrations, session_factory
from gol.importers.base import ParsedTransaction, dedupe_hash
from gol.models import (
    Account,
    BalanceSnapshot,
    Flow,
    Goal,
    HouseholdMember,
    Scenario,
    SpendingCategory,
    Transaction,
)


def _month_starts(months_back: int) -> list[dt.date]:
    today = dt.date.today()
    out = []
    year, month = today.year, today.month
    for _ in range(months_back):
        out.append(dt.date(year, month, 1))
        month -= 1
        if month == 0:
            year, month = year - 1, 12
    return sorted(out)


def _add_txn(db, account_id: int, date: dt.date, amount: float,
             payee: str, category: str | None) -> None:
    parsed = ParsedTransaction(date=date, amount=amount, payee=payee, category=category)
    db.add(Transaction(
        account_id=account_id, date=date, amount=amount, payee=payee,
        category=category, dedupe_hash=dedupe_hash(account_id, parsed),
    ))


def _seed_transactions(db, account_id: int) -> int:
    """~14 months of checking outflows; amounts vary by fixed formulas."""
    count = 0
    for i, month_start in enumerate(_month_starts(14)):
        # groceries: 4 shops a month, drifting around $210
        for week in range(4):
            _add_txn(db, account_id, month_start + dt.timedelta(days=2 + 7 * week),
                     -(198.0 + ((i * 7 + week * 13) % 40)), "Green Basket Market",
                     "groceries")
            count += 1
        # dining out: 3 a month
        for k in range(3):
            _add_txn(db, account_id, month_start + dt.timedelta(days=5 + 9 * k),
                     -(28.0 + ((i * 5 + k * 11) % 35)), "Taqueria Luna", "dining")
            count += 1
        # utilities + fuel + streaming
        _add_txn(db, account_id, month_start + dt.timedelta(days=9),
                 -(155.0 + ((i * 17) % 60)), "City Power & Water", "utilities")
        _add_txn(db, account_id, month_start + dt.timedelta(days=11),
                 -(48.0 + ((i * 9) % 22)), "QuickFuel", "gas")
        _add_txn(db, account_id, month_start + dt.timedelta(days=14),
                 -15.99, "StreamCo", None)  # uncategorized on purpose
        count += 3
        # monthly transfer to brokerage — excluded from observed spending
        _add_txn(db, account_id, month_start + dt.timedelta(days=1),
                 -1_500.0, "Transfer to Vanguard", "transfer")
        count += 1
    return count


def seed(force: bool = False) -> None:
    run_migrations()
    db = session_factory()()
    try:
        if db.execute(select(Account)).first() is not None and not force:
            print("database already has accounts; use --force to seed anyway")
            sys.exit(1)

        today = dt.date.today()
        profile = get_or_create_profile(db)
        profile.annual_retirement_spending = 80_000.0
        profile.inflation_pct = 2.5
        profile.effective_tax_rate_pct = 18.0
        profile.monthly_savings_target = 2_100.0
        get_or_create_settings(db)

        # household: staggered ages and retirements, plus a child
        brian = HouseholdMember(
            name="Brian", role="self", birth_year=today.year - 46, life_expectancy=92,
            retirement_age=65, ss_monthly_at_fra=2_200.0, ss_claim_age=67,
        )
        dana = HouseholdMember(
            name="Dana", role="partner", birth_year=today.year - 43, life_expectancy=94,
            retirement_age=67, ss_monthly_at_fra=1_900.0, ss_claim_age=65,
        )
        riley = HouseholdMember(
            name="Riley", role="child", birth_year=today.year - 12, life_expectancy=92,
        )
        db.add_all([brian, dana, riley])
        db.flush()

        accounts = [
            Account(name="Everyday Checking", type="checking", institution="First National",
                    asset_class="cash"),
            Account(name="Rainy-Day Savings", type="savings", institution="First National",
                    asset_class="cash"),
            Account(name="Vanguard Brokerage", type="brokerage", institution="Vanguard",
                    asset_class="stocks"),
            Account(name="Brian's 401(k)", type="retirement", institution="Fidelity",
                    asset_class="mixed", member_id=brian.id),
            Account(name="Dana's 403(b)", type="retirement", institution="TIAA",
                    asset_class="mixed", member_id=dana.id),
            Account(name="HSA", type="hsa", institution="Fidelity", asset_class="stocks",
                    member_id=brian.id),
            Account(name="The House", type="property", growth_rate_pct=3.0,
                    notes="bought 2016"),
            Account(name="Honda CR-V", type="vehicle", growth_rate_pct=-9.0),
            Account(name="Mortgage", type="mortgage", institution="First National",
                    growth_rate_pct=5.25, notes="30yr fixed"),
        ]
        db.add_all(accounts)
        db.flush()
        checking, savings, brokerage, k401, b403, hsa, house, car, mortgage = accounts

        balances_now = {
            checking.id: 12_400.0, savings.id: 41_000.0, brokerage.id: 262_000.0,
            k401.id: 388_000.0, b403.id: 176_000.0, hsa.id: 28_500.0,
            house.id: 545_000.0, car.id: 21_000.0, mortgage.id: 296_000.0,
        }
        # ~18 months of monthly history with mild drift for the dashboard chart.
        drift = {
            checking.id: 0.000, savings.id: 0.003, brokerage.id: 0.008,
            k401.id: 0.008, b403.id: 0.008, hsa.id: 0.007, house.id: 0.0025,
            car.id: -0.008, mortgage.id: -0.0025,
        }
        months = _month_starts(18)
        for acc_id, now_amount in balances_now.items():
            for i, date in enumerate(months):
                steps_back = len(months) - i
                amount = now_amount / ((1.0 + drift[acc_id]) ** steps_back)
                db.add(BalanceSnapshot(account_id=acc_id, date=date, amount=round(amount, 2)))
            db.add(BalanceSnapshot(account_id=acc_id, date=today, amount=now_amount))

        db.add_all([
            Flow(name="Brian's salary (net of benefits)", kind="income",
                 amount_monthly=9_500.0, annual_growth_pct=3.0, category="salary",
                 member_id=brian.id, ends_at_retirement=True),
            Flow(name="Dana's salary", kind="income", amount_monthly=6_800.0,
                 annual_growth_pct=3.0, category="salary", member_id=dana.id,
                 ends_at_retirement=True),
            Flow(name="Subscriptions & misc", kind="expense", amount_monthly=150.0,
                 annual_growth_pct=2.5, category="living"),
            Flow(name="Mortgage payment", kind="contribution", amount_monthly=2_150.0,
                 account_id=mortgage.id, category="housing"),
            Flow(name="Brian's 401(k) contribution", kind="contribution",
                 amount_monthly=1_500.0, account_id=k401.id, category="retirement",
                 member_id=brian.id, ends_at_retirement=True),
            Flow(name="Dana's 403(b) contribution", kind="contribution",
                 amount_monthly=900.0, account_id=b403.id, category="retirement",
                 member_id=dana.id, ends_at_retirement=True),
            Flow(name="Brokerage auto-invest", kind="contribution", amount_monthly=600.0,
                 account_id=brokerage.id, category="investing", ends_at_retirement=True),
        ])

        # replace the migration's zero-amount starter category with real ones
        for cat in db.execute(select(SpendingCategory)).scalars():
            db.delete(cat)
        db.add_all([
            SpendingCategory(name="Housing & utilities", monthly_amount=1_150.0,
                             kind="essential"),
            SpendingCategory(name="Groceries", monthly_amount=950.0, kind="essential"),
            SpendingCategory(name="Transport", monthly_amount=450.0, kind="essential"),
            SpendingCategory(name="Kids & school", monthly_amount=550.0, kind="essential"),
            SpendingCategory(name="Dining out", monthly_amount=500.0,
                             kind="discretionary"),
            SpendingCategory(name="Travel", monthly_amount=420.0, kind="discretionary",
                             annual_growth_pct=1.0),
            SpendingCategory(name="Everything else", monthly_amount=600.0,
                             kind="discretionary"),
        ])

        txn_count = _seed_transactions(db, checking.id)

        db.add_all([
            Goal(name="Sailboat", emoji="⛵", target_amount=60_000.0,
                 target_date=dt.date(today.year + 6, 6, 1), priority=2,
                 funded_amount=5_000.0, notes="the dream"),
            Goal(name="College fund", emoji="🎓", target_amount=120_000.0,
                 target_date=dt.date(today.year + 8, 9, 1), priority=1,
                 funded_amount=35_000.0),
            Goal(name="Kitchen remodel", emoji="🍳", target_amount=45_000.0,
                 target_date=dt.date(today.year + 2, 3, 1), priority=3,
                 funded_amount=12_000.0),
        ])

        db.add_all([
            Scenario(
                name="Retire at 55 / Dana at 60",
                description="Both stop early; Dana claims Social Security at 62.",
                params={
                    "retirement_age": 55,
                    "member_overrides": {
                        str(dana.id): {"retirement_age": 60, "ss_claim_age": 62},
                    },
                    "monthly_savings_delta": 500.0,
                    "annual_retirement_spending": 70_000.0,
                    "events": [
                        {"name": "Take up golf", "kind": "recurring_expense",
                         "amount_monthly": 350.0, "start_age": 55},
                    ],
                },
            ),
            Scenario(
                name="Trim spending 10%",
                description="Cut every spending category and expense a tenth.",
                params={"spending_delta_pct": -10.0},
            ),
            Scenario(
                name="Coast a little",
                description="Ease off saving now, spend more on living.",
                params={"monthly_savings_delta": -750.0},
            ),
        ])
        db.commit()
        print(
            "seeded demo household: 3 members, 9 accounts, 7 flows, "
            f"7 spending categories, {txn_count} transactions, 3 goals, 3 scenarios"
        )
    finally:
        db.close()


def main() -> None:
    parser = argparse.ArgumentParser(description="Seed a demo dataset")
    parser.add_argument("--force", action="store_true", help="seed even if data exists")
    args = parser.parse_args()
    seed(force=args.force)


if __name__ == "__main__":
    main()
