"""v1.2.2 import presets (T-009, coordinator-ruled contract)

Revision ID: 0005
Revises: 0004
Create Date: 2026-07-11

Saved CSV column mappings per institution, keyed by header fingerprint
(sha256 of the lowercased, sorted, comma-joined CSV header list). One preset
per fingerprint; POST /import/commit upserts via save_preset.
"""

import sqlalchemy as sa
from alembic import op

revision = "0005"
down_revision = "0004"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "import_presets",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(length=200), nullable=False),
        sa.Column("header_fingerprint", sa.String(length=64), nullable=False),
        sa.Column("mapping", sa.JSON(), nullable=False),
        sa.Column("flip_signs", sa.Boolean(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("header_fingerprint", name="uq_import_preset_fingerprint"),
    )


def downgrade() -> None:
    op.drop_table("import_presets")
