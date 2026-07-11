"""v1.2 transfers, categorization, freshness, AI budget

Revision ID: 0003
Revises: 0002
Create Date: 2026-07-11

Data migration:
- transactions.category_source backfills to 'manual' where a category already
  exists (pre-v1.2 categories came from user-mapped CSV columns or manual
  seed data — treating them as manual means rules never clobber them), else
  'none'.
- accounts.track_freshness backfills by type: true for transactional and
  investment types (checking/savings/credit_card/brokerage/retirement/hsa),
  false otherwise (docs/API.md import-freshness defaults).
- ai_settings/ai_usage start empty; the singleton settings row is created on
  first API access.
"""

import sqlalchemy as sa
from alembic import op

revision = "0003"
down_revision = "0002"
branch_labels = None
depends_on = None

# Inlined (migrations must not import app code that may drift); source of
# truth: gol/models.TRACK_FRESHNESS_TYPES.
_TRACKED_TYPES = ("checking", "savings", "credit_card", "brokerage", "retirement", "hsa")


def upgrade() -> None:
    with op.batch_alter_table("transactions", schema=None) as batch_op:
        batch_op.add_column(sa.Column("transfer_pair_id", sa.Integer(), nullable=True))
        batch_op.add_column(
            sa.Column("category_source", sa.String(length=16), nullable=False,
                      server_default="none")
        )
        batch_op.create_index("ix_transactions_transfer_pair_id", ["transfer_pair_id"])
    op.execute("UPDATE transactions SET category_source = 'manual' WHERE category IS NOT NULL")

    with op.batch_alter_table("accounts", schema=None) as batch_op:
        batch_op.add_column(sa.Column("last_import_at", sa.DateTime(), nullable=True))
        batch_op.add_column(sa.Column("staleness_days", sa.Integer(), nullable=True))
        batch_op.add_column(
            sa.Column("track_freshness", sa.Boolean(), nullable=False, server_default="0")
        )
    placeholders = ", ".join(f"'{t}'" for t in _TRACKED_TYPES)
    op.execute(f"UPDATE accounts SET track_freshness = 1 WHERE type IN ({placeholders})")

    op.create_table(
        "category_rules",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("pattern", sa.String(length=300), nullable=False),
        sa.Column("match", sa.String(length=16), nullable=False, server_default="contains"),
        sa.Column("field", sa.String(length=16), nullable=False, server_default="payee"),
        sa.Column("category", sa.String(length=100), nullable=False),
        sa.Column("priority", sa.Integer(), nullable=False, server_default="100"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_table(
        "ai_settings",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("api_key", sa.String(length=300), nullable=True),
        sa.Column("enabled", sa.Boolean(), nullable=False, server_default="0"),
        sa.Column("monthly_budget_usd", sa.Float(), nullable=False, server_default="5.0"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_table(
        "ai_usage",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("month", sa.String(length=7), nullable=False),
        sa.Column("purpose", sa.String(length=50), nullable=False),
        sa.Column("input_tokens", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("output_tokens", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("est_cost_usd", sa.Float(), nullable=False, server_default="0.0"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_ai_usage_month", "ai_usage", ["month"])


def downgrade() -> None:
    op.drop_index("ix_ai_usage_month", table_name="ai_usage")
    op.drop_table("ai_usage")
    op.drop_table("ai_settings")
    op.drop_table("category_rules")
    with op.batch_alter_table("accounts", schema=None) as batch_op:
        batch_op.drop_column("track_freshness")
        batch_op.drop_column("staleness_days")
        batch_op.drop_column("last_import_at")
    with op.batch_alter_table("transactions", schema=None) as batch_op:
        batch_op.drop_index("ix_transactions_transfer_pair_id")
        batch_op.drop_column("category_source")
        batch_op.drop_column("transfer_pair_id")
