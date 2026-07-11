"""v1.1 household members + spending profile

Revision ID: 0002
Revises: 0001
Create Date: 2026-07-11

Data migration (lossless for simulation — regression-tested against a pinned
v1 golden run):
- member 1 ("You", role self) is synthesized from the v1 profile columns.
  ss_claim_age = old social_security_start_age clamped to 62..70, and
  ss_monthly_at_fra is BACK-computed (old monthly benefit / claim factor,
  rounded to cents) so that fra * factor reproduces the old simulated benefit
  (exact at claim age 67, within a cent otherwise; v1 start ages outside
  62..70 are clamped — v1 allowed values v1.1 forbids).
- one starter "Everything else" spending category is seeded with amount 0
  (from nothing — amount 0 keeps migrated simulations identical).
- person-level profile columns are dropped; monthly_savings_target added.
"""

import sqlalchemy as sa
from alembic import op

import gol.db

revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None

# SS claiming factors vs FRA 67 — inlined (migrations must not import app
# code that may drift); source of truth: gol/sim/tables.py.
_FACTORS = {62: 0.70, 63: 0.75, 64: 0.80, 65: 0.8667, 66: 0.9333,
            67: 1.0, 68: 1.08, 69: 1.16, 70: 1.24}


def upgrade() -> None:
    op.create_table(
        "household_members",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(length=200), nullable=False),
        sa.Column("role", sa.String(length=16), nullable=False),
        sa.Column("birth_year", sa.Integer(), nullable=False),
        sa.Column("life_expectancy", sa.Integer(), nullable=False),
        sa.Column("retirement_age", sa.Integer(), nullable=True),
        sa.Column("ss_monthly_at_fra", gol.db.Money(), nullable=True),
        sa.Column("ss_claim_age", sa.Integer(), nullable=True),
        sa.Column("notes", sa.Text(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_table(
        "spending_categories",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(length=200), nullable=False),
        sa.Column("monthly_amount", gol.db.Money(), nullable=False),
        sa.Column("kind", sa.String(length=16), nullable=False),
        sa.Column("annual_growth_pct", sa.Float(), nullable=True),
        sa.PrimaryKeyConstraint("id"),
    )
    with op.batch_alter_table("accounts", schema=None) as batch_op:
        batch_op.add_column(sa.Column("member_id", sa.Integer(), nullable=True))
        batch_op.create_foreign_key(
            "fk_accounts_member_id", "household_members",
            ["member_id"], ["id"], ondelete="SET NULL",
        )
    with op.batch_alter_table("flows", schema=None) as batch_op:
        batch_op.add_column(sa.Column("member_id", sa.Integer(), nullable=True))
        batch_op.create_foreign_key(
            "fk_flows_member_id", "household_members",
            ["member_id"], ["id"], ondelete="SET NULL",
        )

    # --- data migration (read v1 columns BEFORE the profile table rebuild) ---
    bind = op.get_bind()
    row = bind.execute(sa.text(
        "SELECT birth_year, retirement_age, life_expectancy,"
        " social_security_monthly, social_security_start_age"
        " FROM profile ORDER BY id LIMIT 1"
    )).first()
    if row is not None:
        birth_year, retirement_age, life_expectancy, ss_cents, ss_start = row
        claim_age = min(max(int(ss_start), 62), 70)
        fra_cents = round((ss_cents or 0) / _FACTORS[claim_age])
        bind.execute(
            sa.text(
                "INSERT INTO household_members (name, role, birth_year,"
                " life_expectancy, retirement_age, ss_monthly_at_fra,"
                " ss_claim_age, notes) VALUES ('You', 'self', :birth_year,"
                " :life_expectancy, :retirement_age, :fra_cents, :claim_age, '')"
            ),
            {"birth_year": birth_year, "life_expectancy": life_expectancy,
             "retirement_age": retirement_age, "fra_cents": fra_cents,
             "claim_age": claim_age},
        )
    bind.execute(sa.text(
        "INSERT INTO spending_categories (name, monthly_amount, kind,"
        " annual_growth_pct) VALUES ('Everything else', 0, 'discretionary', NULL)"
    ))

    with op.batch_alter_table("profile", schema=None) as batch_op:
        batch_op.add_column(
            sa.Column("monthly_savings_target", gol.db.Money(),
                      nullable=False, server_default="0")
        )
        batch_op.drop_column("birth_year")
        batch_op.drop_column("retirement_age")
        batch_op.drop_column("life_expectancy")
        batch_op.drop_column("social_security_monthly")
        batch_op.drop_column("social_security_start_age")


def downgrade() -> None:
    """Best-effort: restores v1 profile columns from the self member (the
    FRA back-computation is reversed with the same factor)."""
    bind = op.get_bind()
    member = bind.execute(sa.text(
        "SELECT birth_year, life_expectancy, retirement_age, ss_monthly_at_fra,"
        " ss_claim_age FROM household_members WHERE role = 'self'"
        " ORDER BY id LIMIT 1"
    )).first()

    with op.batch_alter_table("profile", schema=None) as batch_op:
        batch_op.add_column(sa.Column("birth_year", sa.Integer(), nullable=False,
                                      server_default="1980"))
        batch_op.add_column(sa.Column("retirement_age", sa.Integer(), nullable=False,
                                      server_default="65"))
        batch_op.add_column(sa.Column("life_expectancy", sa.Integer(), nullable=False,
                                      server_default="92"))
        batch_op.add_column(sa.Column("social_security_monthly", gol.db.Money(),
                                      nullable=False, server_default="0"))
        batch_op.add_column(sa.Column("social_security_start_age", sa.Integer(),
                                      nullable=False, server_default="67"))

    if member is not None:
        birth_year, life_expectancy, retirement_age, fra_cents, claim_age = member
        claim = min(max(int(claim_age or 67), 62), 70)
        monthly_cents = round((fra_cents or 0) * _FACTORS[claim])
        bind.execute(
            sa.text(
                "UPDATE profile SET birth_year = :birth_year,"
                " retirement_age = :retirement_age,"
                " life_expectancy = :life_expectancy,"
                " social_security_monthly = :monthly_cents,"
                " social_security_start_age = :claim"
            ),
            {"birth_year": birth_year,
             "retirement_age": retirement_age if retirement_age is not None else 65,
             "life_expectancy": life_expectancy, "monthly_cents": monthly_cents,
             "claim": claim},
        )

    with op.batch_alter_table("flows", schema=None) as batch_op:
        batch_op.drop_constraint("fk_flows_member_id", type_="foreignkey")
        batch_op.drop_column("member_id")
    with op.batch_alter_table("accounts", schema=None) as batch_op:
        batch_op.drop_constraint("fk_accounts_member_id", type_="foreignkey")
        batch_op.drop_column("member_id")
    op.drop_table("spending_categories")
    op.drop_table("household_members")
