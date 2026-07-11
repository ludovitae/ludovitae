"""POST /import/preview and /import/commit — in-memory parsing, 5 MB cap."""

from __future__ import annotations

import datetime as dt
import json

from fastapi import APIRouter, Form, UploadFile
from sqlalchemy import select

from gol.api.common import Db, get_or_404
from gol.auth.deps import Authenticated
from gol.categorization import categorize_new_transaction, load_rules
from gol.errors import ApiError
from gol.importers import csv as csv_importer
from gol.importers import ofx as ofx_importer
from gol.importers.base import ParsedTransaction, dedupe_hash
from gol.models import Account, BalanceSnapshot, Transaction, utcnow
from gol.pairing import run_auto_pairing

router = APIRouter(tags=["import"])

MAX_FILE_BYTES = 5 * 1024 * 1024  # 5 MB


async def _read_limited(file: UploadFile) -> bytes:
    data = await file.read(MAX_FILE_BYTES + 1)
    if len(data) > MAX_FILE_BYTES:
        raise ApiError(413, "file_too_large", "import files are limited to 5 MB")
    if not data:
        raise ApiError(400, "empty_file", "uploaded file is empty")
    return data


def _check_kind(kind: str) -> None:
    if kind not in ("csv", "ofx"):
        raise ApiError(422, "validation_error", "kind must be csv or ofx")


@router.post("/import/preview")
async def import_preview(
    db: Db, _: Authenticated, file: UploadFile, kind: str = Form(...),
    account_id: int = Form(...),
):
    _check_kind(kind)
    get_or_404(db, Account, account_id, "account_not_found")
    data = await _read_limited(file)
    if kind == "csv":
        try:
            return csv_importer.preview(data)
        except csv_importer.CsvError as exc:
            raise ApiError(400, "parse_error", str(exc)) from exc
    try:
        stmt = ofx_importer.parse(data)
    except ofx_importer.OfxError as exc:
        raise ApiError(400, "parse_error", str(exc)) from exc
    return {
        "accounts_found": stmt.account_ids,
        "transaction_count": len(stmt.transactions),
        "balance": stmt.balance,
    }


@router.post("/import/commit")
async def import_commit(
    db: Db, _: Authenticated, file: UploadFile, kind: str = Form(...),
    account_id: int = Form(...), mapping: str | None = Form(default=None),
    update_balance: bool = Form(default=False),
):
    _check_kind(kind)
    account = get_or_404(db, Account, account_id, "account_not_found")
    data = await _read_limited(file)

    balance: float | None = None
    balance_date: dt.date | None = None
    if kind == "csv":
        if not mapping:
            raise ApiError(400, "mapping_required", "CSV import requires a column mapping")
        try:
            mapping_dict = json.loads(mapping)
        except json.JSONDecodeError as exc:
            raise ApiError(422, "validation_error", "mapping must be a JSON object") from exc
        if not isinstance(mapping_dict, dict):
            raise ApiError(422, "validation_error", "mapping must be a JSON object")
        try:
            parsed: list[ParsedTransaction] = csv_importer.parse_transactions(data, mapping_dict)
        except csv_importer.CsvError as exc:
            raise ApiError(400, "parse_error", str(exc)) from exc
    else:
        try:
            stmt = ofx_importer.parse(data)
        except ofx_importer.OfxError as exc:
            raise ApiError(400, "parse_error", str(exc)) from exc
        parsed = stmt.transactions
        balance, balance_date = stmt.balance, stmt.balance_date

    existing = set(
        db.execute(
            select(Transaction.dedupe_hash).where(Transaction.account_id == account_id)
        ).scalars()
    )
    rules = load_rules(db)
    imported = skipped = 0
    for txn in parsed:
        digest = dedupe_hash(account_id, txn)
        if digest in existing:
            skipped += 1
            continue
        existing.add(digest)
        row = Transaction(
            account_id=account_id, date=txn.date, amount=txn.amount,
            payee=txn.payee, dedupe_hash=digest,
        )
        # layered categorization: file-supplied (manual) > rules > heuristics
        categorize_new_transaction(row, rules, account.type, txn.category)
        db.add(row)
        imported += 1

    if update_balance and balance is not None:
        date = balance_date or dt.date.today()
        snapshot = db.execute(
            select(BalanceSnapshot).where(
                BalanceSnapshot.account_id == account.id, BalanceSnapshot.date == date
            )
        ).scalar_one_or_none()
        if snapshot is None:
            db.add(BalanceSnapshot(account_id=account.id, date=date, amount=balance))
        else:
            snapshot.amount = balance

    # freshness: every commit counts as an import, even an all-duplicate one
    account.last_import_at = utcnow()
    db.flush()  # assign ids before pairing (pair id = smaller txn id)
    # transfer auto-pairing runs after every import commit; idempotent because
    # only unpaired rows are considered and dedupe prevents duplicate rows.
    run_auto_pairing(db)
    db.flush()
    return {"imported": imported, "skipped_duplicates": skipped}
