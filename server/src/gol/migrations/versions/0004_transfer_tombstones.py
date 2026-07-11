"""v1.2 unpair tombstones (coordinator ruling on T-007 review)

Revision ID: 0004
Revises: 0003
Create Date: 2026-07-11

DELETE /transfers/pair/{id} records the two transaction ids here so that
import-time auto-pairing never re-links a pair the user explicitly broke.
Manual POST /transfers/pair on the same two transactions deletes the row.
"""

import sqlalchemy as sa
from alembic import op

revision = "0004"
down_revision = "0003"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "transfer_pair_tombstones",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("txn_id_a", sa.Integer(), nullable=False),
        sa.Column("txn_id_b", sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(["txn_id_a"], ["transactions.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["txn_id_b"], ["transactions.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("txn_id_a", "txn_id_b", name="uq_tombstone_pair"),
    )
    op.create_index("ix_transfer_pair_tombstones_txn_id_a", "transfer_pair_tombstones",
                    ["txn_id_a"])
    op.create_index("ix_transfer_pair_tombstones_txn_id_b", "transfer_pair_tombstones",
                    ["txn_id_b"])


def downgrade() -> None:
    op.drop_index("ix_transfer_pair_tombstones_txn_id_b",
                  table_name="transfer_pair_tombstones")
    op.drop_index("ix_transfer_pair_tombstones_txn_id_a",
                  table_name="transfer_pair_tombstones")
    op.drop_table("transfer_pair_tombstones")
