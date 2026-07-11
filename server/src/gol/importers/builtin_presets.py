"""Built-in import presets (#26): institution mappings that ship with the
app so the owner's first real exports auto-match by header fingerprint.

Migration 0007 seeds these into existing databases (with its own frozen
copy — migrations never track live code); POST /admin/reset (#27) re-seeds
them after wiping the presets table, because they are app furniture, not
user data. Column names are the providers' public export schemas.
"""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from gol.importers.csv import header_fingerprint
from gol.models import ImportPreset

BUILTIN_PRESETS: tuple[dict, ...] = (
    {
        "name": "Fidelity — Accounts History",
        "columns": [
            "Run Date", "Account", "Account Number", "Action", "Symbol",
            "Description", "Type", "Exchange Quantity", "Exchange Currency",
            "Currency", "Price", "Quantity", "Exchange Rate", "Commission",
            "Fees", "Accrued Interest", "Amount", "Settlement Date",
        ],
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
        # Amex lists charges as positive numbers -> flip on import.
        "name": "American Express — Activity",
        "columns": [
            "Date", "Description", "Card Member", "Account #", "Amount",
            "Extended Details", "Appears On Your Statement As", "Address",
            "City/State", "Zip Code", "Country", "Reference", "Category",
        ],
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
        # Split debit/credit with role-based signs; Status marks pending
        # rows which import skips (skipped_pending). flip_signs is N/A
        # under split semantics.
        "name": "Citi — Credit Card",
        "columns": [
            "Status", "Date", "Description", "Debit", "Credit", "Member Name",
        ],
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
        # Classic all-positive split debit/credit; fully-quoted export with
        # non-zero-padded M/D/YYYY dates and an always-empty "No." column.
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
)


def ensure_builtin_presets(db: Session) -> None:
    """Insert any missing built-in preset (upsert-by-fingerprint semantics:
    a user-saved preset for the same header shape is never clobbered)."""
    for spec in BUILTIN_PRESETS:
        fingerprint = header_fingerprint(spec["columns"])
        exists = db.execute(
            select(ImportPreset).where(ImportPreset.header_fingerprint == fingerprint)
        ).scalar_one_or_none()
        if exists is None:
            db.add(
                ImportPreset(
                    name=spec["name"],
                    header_fingerprint=fingerprint,
                    mapping=spec["mapping"],
                    flip_signs=spec["flip_signs"],
                )
            )
    db.flush()
