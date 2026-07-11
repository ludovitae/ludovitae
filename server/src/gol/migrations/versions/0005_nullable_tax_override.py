"""v1.2.2 (T-012 phase 2): effective_tax_rate_pct becomes a nullable
flat-rate override

Revision ID: 0005
Revises: 0004
Create Date: 2026-07-11

A stored value selects the flat-rate engine path (v1/v2 behavior, preserved
verbatim); NULL selects the bracket-aware tax model. Existing rows keep their
stored value — migrated databases simulate bit-for-bit identically (the T-005
sim-identity standard) until the owner clears the override. Fresh profiles
default to NULL (brackets) at the model layer.
"""

import sqlalchemy as sa
from alembic import op

revision = "0005"
down_revision = "0004"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("profile") as batch:
        batch.alter_column(
            "effective_tax_rate_pct", existing_type=sa.Float(), nullable=True
        )


def downgrade() -> None:
    # Bracket-mode profiles fall back to the historical 18% flat default.
    op.execute(
        "UPDATE profile SET effective_tax_rate_pct = 18.0"
        " WHERE effective_tax_rate_pct IS NULL"
    )
    with op.batch_alter_table("profile") as batch:
        batch.alter_column(
            "effective_tax_rate_pct", existing_type=sa.Float(), nullable=False
        )
