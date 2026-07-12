"""v1.2.2 account detail page (#30, coordinator-ruled contract)

Revision ID: 0008
Revises: 0007
Create Date: 2026-07-12

- accounts.external_account_masked: display form of the external-account
  link ("···" + last 4 of the raw provider id), captured at link time
  alongside the sha256 hash. The hash is one-way, so accounts linked before
  this migration keep a NULL mask — serving code renders those as "linked"
  without digits, and the mask self-heals on their next import commit.
"""

import sqlalchemy as sa
from alembic import op

revision = "0008"
down_revision = "0007"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "accounts",
        sa.Column("external_account_masked", sa.String(length=16), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("accounts", "external_account_masked")
