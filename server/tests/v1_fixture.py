"""Shared v1-database fixture for the migration sim-identity test (T-005).

``V1_FIXTURE_SQL`` recreates a realistic v1 (schema revision 0001) database
with raw SQL — profile columns that v1.1 migrates into household_members, plus
accounts/balances/flows. Money columns are integer cents.

The golden output in ``tests/fixtures/v1_identity_golden.json`` was generated
by running THIS data through the v1 engine (commit f4b0272, engine version 1)
at the pinned date/seed below. The v1.1 identity test upgrades the same
database to head and must reproduce that output exactly.

Identity household constraints (deliberate):
- no retirement-type accounts -> no tax-deferred balances -> RMDs never fire;
- social_security_start_age 67 (FRA) -> claim factor 1.0, benefit unchanged.
"""

from __future__ import annotations

import datetime as dt

TODAY = dt.date(2026, 7, 15)  # pinned so start_age/flow windows are stable
SEED = 4242
N_PATHS = 400

V1_FIXTURE_SQL = (
    # birth 1979 -> age 47 in 2026; retire 65; SS $2,400/mo from 67 (FRA)
    "INSERT INTO profile (id, birth_year, retirement_age, life_expectancy,"
    " annual_retirement_spending, social_security_monthly,"
    " social_security_start_age, inflation_pct, effective_tax_rate_pct)"
    " VALUES (1, 1979, 65, 90, 7800000, 240000, 67, 2.5, 18.0)",
    # accounts — note: NO retirement-type account (identity requires no RMDs)
    "INSERT INTO accounts (id, name, type, institution, growth_rate_pct,"
    " asset_class, include_in_net_worth, notes, created_at) VALUES"
    " (1, 'Everyday Checking', 'checking', 'First National', NULL, 'cash', 1, '', '2026-07-01'),"
    " (2, 'Brokerage', 'brokerage', 'Vanguard', NULL, 'mixed', 1, '', '2026-07-01'),"
    " (3, 'House', 'property', NULL, 3.0, NULL, 1, '', '2026-07-01'),"
    " (4, 'Mortgage', 'mortgage', 'First National', 5.25, NULL, 1, '', '2026-07-01')",
    "INSERT INTO balance_snapshots (account_id, date, amount) VALUES"
    " (1, '2026-07-01', 1500000),"   # $15,000
    " (2, '2026-07-01', 30000000),"  # $300,000
    " (3, '2026-07-01', 45000000),"  # $450,000
    " (4, '2026-07-01', 25000000)",  # $250,000
    "INSERT INTO flows (id, name, kind, amount_monthly, annual_growth_pct,"
    " start_date, end_date, account_id, category, ends_at_retirement) VALUES"
    " (1, 'Salary', 'income', 800000, 3.0, NULL, NULL, NULL, 'salary', 1),"
    " (2, 'Living', 'expense', 450000, 2.5, NULL, NULL, NULL, 'living', 0),"
    " (3, 'Auto-invest', 'contribution', 80000, 0.0, NULL, NULL, 2, 'investing', 1),"
    " (4, 'Mortgage payment', 'contribution', 180000, 0.0, NULL, NULL, 4, 'housing', 0)",
)


def apply_v1_fixture_sql(engine) -> None:
    """Insert the fixture rows into a database at schema revision 0001."""
    from sqlalchemy import text

    with engine.begin() as conn:
        for stmt in V1_FIXTURE_SQL:
            conn.execute(text(stmt))
