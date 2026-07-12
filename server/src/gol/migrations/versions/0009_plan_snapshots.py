"""v1.3 plan snapshots + tracking (#21, coordinator-ruled contract)

Revision ID: 0009
Revises: 0008
Create Date: 2026-07-12

- plan_snapshots: a frozen, named plan capture — the full /simulate response
  plus a summary of the inputs it consumed, immutable after creation. At most
  one row is is_benchmark (the active comparison line); the zero-or-one
  invariant is enforced in the PATCH handler, not the schema (SQLite partial
  unique indexes are painful under batch mode and the app owns the rule).
"""

import sqlalchemy as sa
from alembic import op

revision = "0009"
down_revision = "0008"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "plan_snapshots",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("name", sa.String(length=200), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("engine_version", sa.String(length=8), nullable=False),
        sa.Column("scenario_id", sa.Integer(), nullable=True),
        sa.Column("is_benchmark", sa.Boolean(), nullable=False,
                  server_default=sa.false()),
        sa.Column("captured_net_worth", sa.Float(), nullable=False,
                  server_default="0"),
        sa.Column("monthly_spending", sa.Float(), nullable=False,
                  server_default="0"),
        sa.Column("monthly_saving", sa.Float(), nullable=False,
                  server_default="0"),
        sa.Column("response", sa.JSON(), nullable=False),
        sa.Column("inputs_summary", sa.JSON(), nullable=False),
    )


def downgrade() -> None:
    op.drop_table("plan_snapshots")
