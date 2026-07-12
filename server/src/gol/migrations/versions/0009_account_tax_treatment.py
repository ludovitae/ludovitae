"""v1.3 account tax-treatment split (#25, coordinator-ruled contract)

Revision ID: 0009
Revises: 0008
Create Date: 2026-07-12

- accounts.tax_treatment: nullable OVERRIDE for how an account is taxed in
  the sim (`tax_deferred | roth | taxable | hsa`). NULL means "derive from
  `type`" (retirement -> tax_deferred, hsa -> hsa, else taxable), which is
  exactly today's behavior — so every existing row is added NULL and migrated
  databases simulate bit-for-bit identically (the T-005 sim-identity
  standard). `roth` is reachable only by an explicit override; there is no
  roth account type. This is the schema substrate for the per-member Roth
  bucket in the engine (fixes phantom RMDs + phantom withdrawal tax on real
  Roth accounts) and the future Roth-conversion / equity-grant work.

Coordination note: numbered 0009 off head 0008. If the plan-snapshots
workstream also claims 0009, the coordinator renumbers one of them at merge.
"""

import sqlalchemy as sa
from alembic import op

revision = "0009"
down_revision = "0008"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "accounts",
        sa.Column("tax_treatment", sa.String(length=16), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("accounts", "tax_treatment")
