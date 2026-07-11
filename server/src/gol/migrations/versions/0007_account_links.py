"""v1.2.2 import account matching (#26, coordinator-ruled contract)

Revision ID: 0007
Revises: 0006
Create Date: 2026-07-11

- accounts.external_account_id: hashed external-account link (sha256 of the
  provider's raw account id — OFX ACCTID or CSV account-number cell; the raw
  id is never stored). Set on import commit, upsert/last-write-wins.
- import_presets.last_account_id: the wizard's picker default — last
  single-target account a preset committed into. Loose reference (SQLite
  add_column cannot carry an FK); serving code null-checks existence.
- Ships built-in presets — "Fidelity — Accounts History" (18-column
  multi-account export) and "American Express — Activity" (13-column
  charges-positive export) — so the owner's first real imports auto-match.
  Column names are the providers' public export schemas, not user data.
"""

import datetime as dt
import hashlib

import sqlalchemy as sa
from alembic import op

revision = "0007"
down_revision = "0006"
branch_labels = None
depends_on = None

# Provider header shapes (public export schemas).
_FIDELITY_COLUMNS = [
    "Run Date", "Account", "Account Number", "Action", "Symbol",
    "Description", "Type", "Exchange Quantity", "Exchange Currency",
    "Currency", "Price", "Quantity", "Exchange Rate", "Commission", "Fees",
    "Accrued Interest", "Amount", "Settlement Date",
]
_AMEX_COLUMNS = [
    "Date", "Description", "Card Member", "Account #", "Amount",
    "Extended Details", "Appears On Your Statement As", "Address",
    "City/State", "Zip Code", "Country", "Reference", "Category",
]
_CITI_COLUMNS = [
    "Status", "Date", "Description", "Debit", "Credit", "Member Name",
]

_BUILTIN_PRESETS = [
    {
        "name": "Fidelity — Accounts History",
        "columns": _FIDELITY_COLUMNS,
        "mapping": {
            "date": "Run Date",
            "amount": "Amount",
            "payee": "Action",
            "account_column": "Account",
            "account_id_column": "Account Number",
        },
        "flip_signs": False,
    },
    {
        # Charges positive in Amex exports -> flip on import (liability
        # convention); merchant categories import heuristic-grade (#26).
        "name": "American Express — Activity",
        "columns": _AMEX_COLUMNS,
        "mapping": {
            "date": "Date",
            "amount": "Amount",
            "payee": "Description",
            "category": "Category",
            "account_id_column": "Account #",
        },
        "flip_signs": True,
    },
    {
        # Split debit/credit (role-based signs); Status marks pending rows.
        "name": "Citi — Credit Card",
        "columns": _CITI_COLUMNS,
        "mapping": {
            "date": "Date",
            "debit": "Debit",
            "credit": "Credit",
            "payee": "Description",
            "status_column": "Status",
        },
        "flip_signs": False,
    },
    {
        # Classic all-positive split debit/credit checking export.
        "name": "Commerce Bank — Checking",
        "columns": ["Date", "No.", "Description", "Debit", "Credit"],
        "mapping": {
            "date": "Date",
            "debit": "Debit",
            "credit": "Credit",
            "payee": "Description",
        },
        "flip_signs": False,
    },
]


def _fingerprint(columns: list[str]) -> str:
    """Mirror of gol.importers.csv.header_fingerprint (kept inline so the
    migration never drifts with application code)."""
    material = ",".join(sorted(col.strip().lower() for col in columns))
    return hashlib.sha256(material.encode()).hexdigest()


def upgrade() -> None:
    op.add_column(
        "accounts",
        sa.Column("external_account_id", sa.String(length=64), nullable=True),
    )
    op.create_index(
        "ix_accounts_external_account_id", "accounts", ["external_account_id"]
    )
    op.add_column(
        "import_presets",
        sa.Column("last_account_id", sa.Integer(), nullable=True),
    )

    presets = sa.table(
        "import_presets",
        sa.column("name", sa.String),
        sa.column("header_fingerprint", sa.String),
        sa.column("mapping", sa.JSON),
        sa.column("flip_signs", sa.Boolean),
        sa.column("created_at", sa.DateTime),
        sa.column("last_account_id", sa.Integer),
    )
    for spec in _BUILTIN_PRESETS:
        fingerprint = _fingerprint(spec["columns"])
        # Upsert-by-fingerprint semantics: never duplicate a user-saved preset.
        existing = op.get_bind().execute(
            sa.select(sa.func.count())
            .select_from(presets)
            .where(presets.c.header_fingerprint == fingerprint)
        ).scalar()
        if existing:
            continue
        op.bulk_insert(
            presets,
            [
                {
                    "name": spec["name"],
                    "header_fingerprint": fingerprint,
                    "mapping": spec["mapping"],
                    "flip_signs": spec["flip_signs"],
                    "created_at": dt.datetime(2026, 7, 11),
                    "last_account_id": None,
                }
            ],
        )


def downgrade() -> None:
    op.drop_column("import_presets", "last_account_id")
    op.drop_index("ix_accounts_external_account_id", table_name="accounts")
    op.drop_column("accounts", "external_account_id")
