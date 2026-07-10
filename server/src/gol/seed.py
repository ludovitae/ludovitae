"""`uv run gol-seed` — populate a realistic demo household (age ~46).

Idempotent-ish: refuses to run if accounts already exist unless --force.
Never creates a password; first-run setup stays with the user.
"""

from __future__ import annotations

import argparse
import datetime as dt
import sys

from sqlalchemy import select

from gol.assembly import get_or_create_profile, get_or_create_settings
from gol.db import run_migrations, session_factory
from gol.models import Account, BalanceSnapshot, Flow, Goal, Scenario


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


def seed(force: bool = False) -> None:
    run_migrations()
    db = session_factory()()
    try:
        if db.execute(select(Account)).first() is not None:
            if not force:
                print("database already has accounts; use --force to seed anyway")
                sys.exit(1)

        today = dt.date.today()
        profile = get_or_create_profile(db)
        profile.birth_year = today.year - 46
        profile.retirement_age = 65
        profile.life_expectancy = 92
        profile.annual_retirement_spending = 80_000.0
        profile.social_security_monthly = 2_200.0
        profile.social_security_start_age = 67
        profile.inflation_pct = 2.5
        profile.effective_tax_rate_pct = 18.0
        get_or_create_settings(db)

        accounts = [
            Account(name="Everyday Checking", type="checking", institution="First National",
                    asset_class="cash"),
            Account(name="Rainy-Day Savings", type="savings", institution="First National",
                    asset_class="cash"),
            Account(name="Vanguard Brokerage", type="brokerage", institution="Vanguard",
                    asset_class="stocks"),
            Account(name="401(k)", type="retirement", institution="Fidelity",
                    asset_class="mixed"),
            Account(name="HSA", type="hsa", institution="Fidelity", asset_class="stocks"),
            Account(name="The House", type="property", growth_rate_pct=3.0,
                    notes="bought 2016"),
            Account(name="Honda CR-V", type="vehicle", growth_rate_pct=-9.0),
            Account(name="Mortgage", type="mortgage", institution="First National",
                    growth_rate_pct=5.25, notes="30yr fixed"),
        ]
        db.add_all(accounts)
        db.flush()
        checking, savings, brokerage, k401, hsa, house, car, mortgage = accounts

        balances_now = {
            checking.id: 12_400.0, savings.id: 41_000.0, brokerage.id: 262_000.0,
            k401.id: 388_000.0, hsa.id: 28_500.0, house.id: 545_000.0,
            car.id: 21_000.0, mortgage.id: 296_000.0,
        }
        # ~18 months of monthly history with mild drift for the dashboard chart.
        drift = {
            checking.id: 0.000, savings.id: 0.003, brokerage.id: 0.008,
            k401.id: 0.008, hsa.id: 0.007, house.id: 0.0025,
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
            Flow(name="Salary (net of benefits)", kind="income", amount_monthly=9_500.0,
                 annual_growth_pct=3.0, category="salary", ends_at_retirement=True),
            Flow(name="Household spending", kind="expense", amount_monthly=5_400.0,
                 annual_growth_pct=2.5, category="living"),
            Flow(name="Mortgage payment", kind="contribution", amount_monthly=2_150.0,
                 account_id=mortgage.id, category="housing"),
            Flow(name="401(k) contribution", kind="contribution", amount_monthly=1_500.0,
                 account_id=k401.id, category="retirement", ends_at_retirement=True),
            Flow(name="Brokerage auto-invest", kind="contribution", amount_monthly=600.0,
                 account_id=brokerage.id, category="investing", ends_at_retirement=True),
        ])

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
                name="Retire at 55",
                description="Stop working ten years early; trim retirement spending.",
                params={
                    "retirement_age": 55,
                    "monthly_savings_delta": 500.0,
                    "annual_retirement_spending": 70_000.0,
                    "events": [
                        {"name": "Take up golf", "kind": "recurring_expense",
                         "amount_monthly": 350.0, "start_age": 55},
                    ],
                },
            ),
            Scenario(
                name="Coast a little",
                description="Ease off saving now, spend more on living.",
                params={"monthly_savings_delta": -750.0},
            ),
        ])
        db.commit()
        print("seeded demo household: 8 accounts, 5 flows, 3 goals, 2 scenarios")
    finally:
        db.close()


def main() -> None:
    parser = argparse.ArgumentParser(description="Seed a demo dataset")
    parser.add_argument("--force", action="store_true", help="seed even if data exists")
    args = parser.parse_args()
    seed(force=args.force)


if __name__ == "__main__":
    main()
