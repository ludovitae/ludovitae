"""POST /import/preview and /import/commit — in-memory parsing, 5 MB cap.

v1.2.2 (T-009): institution mapping presets keyed by CSV header fingerprint
(GET/DELETE /import/presets), preview preset matching + sign-convention
hints, commit-side flip_signs and save_preset upsert.

v1.2.2 (#26): hashed external-account links (OFX ACCTID / CSV account
numbers), preview account matching (`account_match` for OFX,
`account_groups` for multi-account CSVs), commit-side account creation
(`new_account`, per-group `account_map`), preset `last_account_id`, and
investment-activity auto-categorization for investment-type accounts.
"""

from __future__ import annotations

import datetime as dt
import json
import logging

from fastapi import APIRouter, Form, Response, UploadFile
from pydantic import BaseModel, Field, ValidationError
from sqlalchemy import select

from gol.api.accounts import _serialize_one, _validate_enums, _validate_member
from gol.api.common import Db, get_or_404
from gol.auth.deps import Authenticated
from gol.categorization import categorize_new_transaction, load_rules
from gol.errors import ApiError
from gol.importers import csv as csv_importer
from gol.importers import ofx as ofx_importer
from gol.importers.base import (
    ParsedTransaction,
    dedupe_hash,
    hash_external_id,
    mask_external_id,
)
from gol.models import (
    INVESTABLE_TYPES,
    INVESTMENT_ACTIVITY_CATEGORY,
    TRACK_FRESHNESS_TYPES,
    Account,
    BalanceSnapshot,
    ImportPreset,
    Transaction,
    utcnow,
)
from gol.pairing import run_auto_pairing

log = logging.getLogger(__name__)

router = APIRouter(tags=["import"])

MAX_FILE_BYTES = 5 * 1024 * 1024  # 5 MB


class NewAccountBody(BaseModel):
    """#26: account payload accepted by commit as an alternative to
    account_id (and inside account_map entries for multi-account CSVs)."""

    name: str = Field(min_length=1, max_length=200)
    type: str
    institution: str | None = None
    asset_class: str | None = None
    member_id: int | None = None


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


def _parse_json_field(raw: str, field: str) -> dict:
    try:
        value = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise ApiError(422, "validation_error", f"{field} must be a JSON object") from exc
    if not isinstance(value, dict):
        raise ApiError(422, "validation_error", f"{field} must be a JSON object")
    return value


def _parse_mapping(mapping: str | None) -> dict:
    if not mapping:
        raise ApiError(400, "mapping_required", "CSV import requires a column mapping")
    return _parse_json_field(mapping, "mapping")


def _validate_new_account(value: object) -> NewAccountBody:
    try:
        body = NewAccountBody.model_validate(value)
    except ValidationError as exc:
        first = exc.errors()[0]
        loc = ".".join(str(p) for p in first["loc"])
        raise ApiError(
            422, "validation_error", f"new_account.{loc}: {first['msg']}"
        ) from exc
    _validate_enums(body.type, body.asset_class)
    return body


def _parse_new_account(raw: str) -> NewAccountBody:
    return _validate_new_account(_parse_json_field(raw, "new_account"))


def _create_account(db, body: NewAccountBody) -> Account:
    """#26: create an import-target account with type-appropriate freshness
    defaults (mirrors POST /accounts creation semantics)."""
    _validate_member(db, body.member_id)
    acc = Account(
        name=body.name,
        type=body.type,
        institution=body.institution,
        asset_class=body.asset_class,
        member_id=body.member_id,
        track_freshness=body.type in TRACK_FRESHNESS_TYPES,
    )
    db.add(acc)
    db.flush()
    return acc


def _link_external(db, account: Account, digest: str, masked: str) -> None:
    """Upsert the hashed external-account link — last-write-wins; a collision
    moves the link off the previous holder (logged, ids only). #30: the
    display mask (···last-4) is captured alongside the hash — the hash is
    one-way, so link time is the only chance to remember the digits."""
    other = db.execute(
        select(Account).where(
            Account.external_account_id == digest, Account.id != account.id
        )
    ).scalar_one_or_none()
    if other is not None:
        log.warning(
            "external account link moved from account %s to account %s (last-write-wins)",
            other.id, account.id,
        )
        other.external_account_id = None
        other.external_account_masked = None
    account.external_account_id = digest
    account.external_account_masked = masked


def _account_by_external_id(db, digest: str) -> Account | None:
    return db.execute(
        select(Account).where(Account.external_account_id == digest)
    ).scalar_one_or_none()


def _serialize_preset(db, preset: ImportPreset) -> dict:
    return {
        "id": preset.id,
        "name": preset.name,
        "header_fingerprint": preset.header_fingerprint,
        "mapping": preset.mapping,
        "flip_signs": preset.flip_signs,
        "created_at": preset.created_at.isoformat(),
        "last_account_id": _live_last_account_id(db, preset),
    }


def _live_last_account_id(db, preset: ImportPreset) -> int | None:
    """last_account_id is a loose reference — served only while it resolves."""
    if preset.last_account_id is None:
        return None
    return preset.last_account_id if db.get(Account, preset.last_account_id) else None


def _preset_by_fingerprint(db, fingerprint: str) -> ImportPreset | None:
    return db.execute(
        select(ImportPreset).where(ImportPreset.header_fingerprint == fingerprint)
    ).scalar_one_or_none()


@router.get("/import/presets")
def list_presets(db: Db, _: Authenticated):
    presets = db.execute(select(ImportPreset).order_by(ImportPreset.id)).scalars()
    return [_serialize_preset(db, p) for p in presets]


@router.delete("/import/presets/{preset_id}", status_code=204)
def delete_preset(preset_id: int, db: Db, _: Authenticated):
    preset = get_or_404(db, ImportPreset, preset_id, "preset_not_found")
    db.delete(preset)
    db.flush()
    return Response(status_code=204)


def _account_groups(db, parsed: list[ParsedTransaction]) -> list[dict]:
    """#26 multi-account preview: one entry per distinct account number, in
    file order, matched to known accounts by hashed external id. `key` is the
    hash — the handle account_map is keyed by; the raw number never
    round-trips through the API."""
    groups: dict[str, dict] = {}
    for txn in parsed:
        if not txn.account_number:
            continue
        digest = hash_external_id(txn.account_number)
        entry = groups.get(digest)
        if entry is None:
            match = _account_by_external_id(db, digest)
            groups[digest] = {
                "key": digest,
                "number_masked": mask_external_id(txn.account_number),
                "name": txn.account_name,
                "rows": 1,
                "account_id": match.id if match else None,
            }
        else:
            entry["rows"] += 1
            if entry["name"] is None and txn.account_name:
                entry["name"] = txn.account_name
    return list(groups.values())


@router.post("/import/preview")
async def import_preview(
    db: Db, _: Authenticated, file: UploadFile, kind: str = Form(...),
    account_id: int | None = Form(default=None),
    mapping: str | None = Form(default=None),
):
    _check_kind(kind)
    # #26: account_id is optional — the create-new flow has no account yet
    account = (
        get_or_404(db, Account, account_id, "account_not_found")
        if account_id is not None
        else None
    )
    data = await _read_limited(file)
    if kind == "csv":
        try:
            result = csv_importer.preview(data)
        except csv_importer.CsvError as exc:
            raise ApiError(400, "parse_error", str(exc)) from exc
        fingerprint = csv_importer.header_fingerprint(result["columns"])
        preset = _preset_by_fingerprint(db, fingerprint)
        result["matched_preset"] = (
            None
            if preset is None
            else {
                "id": preset.id,
                "name": preset.name,
                "mapping": preset.mapping,
                "flip_signs": preset.flip_signs,
                "last_account_id": _live_last_account_id(db, preset),
            }
        )
        # Effective mapping for the heuristics below: an explicit client
        # override (#26 re-preview after remapping) wins, then the matched
        # preset's mapping, then the suggestion.
        if mapping:
            effective = _parse_json_field(mapping, "mapping")
        elif preset is not None:
            effective = preset.mapping
        else:
            effective = result["suggested_mapping"]
        # Sign heuristic: split debit/credit mappings carry explicit signs,
        # and without a target account there is no convention to check.
        if account is None or (effective.get("debit") and effective.get("credit")):
            result["sign_hint"] = None
        else:
            amounts = csv_importer.lenient_amounts(data, effective)
            result["sign_hint"] = csv_importer.sign_hint(amounts, account.type)
        # #26 multi-account detection
        if effective.get("account_id_column"):
            try:
                parsed = csv_importer.parse_transactions(data, dict(effective))
            except csv_importer.CsvError:
                parsed = []  # lenient: preview never fails on row problems
            result["account_groups"] = _account_groups(db, parsed) or None
        else:
            result["account_groups"] = None
        # #26 Citi ruling: surface pending rows when a status column is mapped
        result["pending_rows"] = (
            csv_importer.pending_rows(data, effective)
            if effective.get("status_column")
            else None
        )
        return result
    try:
        stmt = ofx_importer.parse(data)
    except ofx_importer.OfxError as exc:
        raise ApiError(400, "parse_error", str(exc)) from exc
    acctid = stmt.account_ids[0] if stmt.account_ids else None
    match = _account_by_external_id(db, hash_external_id(acctid)) if acctid else None
    return {
        "accounts_found": stmt.account_ids,
        "transaction_count": len(stmt.transactions),
        "balance": stmt.balance,
        # #26: matched by hashed ACCTID; no ACCTID in the file -> both null
        "account_match": {
            "account_id": match.id if match else None,
            "acctid_masked": mask_external_id(acctid) if acctid else None,
        },
    }


def _import_into(db, account: Account, parsed: list[ParsedTransaction], rules) -> tuple[int, int]:
    """Insert parsed rows into one account (dedupe + categorization +
    freshness). Investment-type accounts auto-categorize every imported row
    as investment-activity (coordinator ruling, #26) — excluded from
    spending analytics like transfer pairs."""
    existing = set(
        db.execute(
            select(Transaction.dedupe_hash).where(Transaction.account_id == account.id)
        ).scalars()
    )
    investment = account.type in INVESTABLE_TYPES
    imported = skipped = 0
    for txn in parsed:
        digest = dedupe_hash(account.id, txn)
        if digest in existing:
            skipped += 1
            continue
        existing.add(digest)
        row = Transaction(
            account_id=account.id, date=txn.date, amount=txn.amount,
            payee=txn.payee, dedupe_hash=digest,
        )
        if investment:
            row.category = INVESTMENT_ACTIVITY_CATEGORY
            row.category_source = "heuristic"
        else:
            # layered categorization: file-supplied (manual) > rules > heuristics
            categorize_new_transaction(row, rules, account.type, txn.category)
        db.add(row)
        imported += 1
    # freshness: every commit counts as an import, even an all-duplicate one
    account.last_import_at = utcnow()
    return imported, skipped


def _resolve_group_account(
    db, digest: str, name: str | None, masked: str, account_map: dict
) -> tuple[Account, bool]:
    """Resolution order per group (#26): explicit account_map entry ->
    hashed-id match -> unknown (caller collects for the 422)."""
    entry = account_map.get(digest)
    if entry is not None:
        if not isinstance(entry, dict):
            raise ApiError(422, "validation_error", "account_map entries must be objects")
        if "account_id" in entry:
            acc = get_or_404(db, Account, entry["account_id"], "account_not_found")
            _link_external(db, acc, digest, masked)
            return acc, False
        if "new_account" in entry:
            acc = _create_account(db, _validate_new_account(entry["new_account"]))
            _link_external(db, acc, digest, masked)
            return acc, True
        raise ApiError(
            422, "validation_error",
            "account_map entries must carry account_id or new_account",
        )
    match = _account_by_external_id(db, digest)
    if match is None:
        raise _UnknownAccount(name)
    # #30 self-heal: accounts linked before migration 0008 have a hash but no
    # mask — this import knows the raw number, so capture the digits now.
    if match.external_account_masked is None:
        match.external_account_masked = masked
    return match, False


class _UnknownAccount(Exception):
    def __init__(self, name: str | None):
        self.name = name


def _commit_multi_account(
    db, parsed: list[ParsedTransaction], account_map: dict, rules
) -> dict:
    """#26 multi-account CSV commit: route rows per account number."""
    order: list[str] = []
    groups: dict[str, dict] = {}
    for txn in parsed:
        if not txn.account_number:
            raise ApiError(
                422, "validation_error",
                "a dated row is missing its account number "
                f"(row dated {txn.date.isoformat()})",
            )
        digest = hash_external_id(txn.account_number)
        if digest not in groups:
            order.append(digest)
            groups[digest] = {
                "masked": mask_external_id(txn.account_number),
                "name": txn.account_name,
                "txns": [],
            }
        groups[digest]["txns"].append(txn)

    # Resolve every group before writing anything: unknown numbers fail the
    # whole commit closed so a partial import never happens.
    resolved: dict[str, tuple[Account, bool]] = {}
    unknown: list[str] = []
    for digest in order:
        try:
            resolved[digest] = _resolve_group_account(
                db, digest, groups[digest]["name"], groups[digest]["masked"], account_map
            )
        except _UnknownAccount:
            unknown.append(groups[digest]["masked"])
    if unknown:
        raise ApiError(
            422, "unknown_account",
            "no account is linked to " + ", ".join(unknown)
            + " — map each to an existing account or create new ones",
        )

    accounts_out = []
    total_imported = total_skipped = 0
    for digest in order:
        account, created = resolved[digest]
        imported, skipped = _import_into(db, account, groups[digest]["txns"], rules)
        total_imported += imported
        total_skipped += skipped
        accounts_out.append({
            "account_id": account.id,
            "name": account.name,
            "created": created,
            "imported": imported,
            "skipped_duplicates": skipped,
        })
    return {
        "imported": total_imported,
        "skipped_duplicates": total_skipped,
        "accounts": accounts_out,
    }


@router.post("/import/commit")
async def import_commit(
    db: Db, _: Authenticated, file: UploadFile, kind: str = Form(...),
    account_id: int | None = Form(default=None),
    new_account: str | None = Form(default=None),
    account_map: str | None = Form(default=None),
    mapping: str | None = Form(default=None),
    update_balance: bool = Form(default=False),
    flip_signs: bool = Form(default=False),
    save_preset: str | None = Form(default=None),
):
    _check_kind(kind)
    data = await _read_limited(file)

    balance: float | None = None
    balance_date: dt.date | None = None
    acctid: str | None = None
    mapping_dict: dict = {}
    columns: list[str] = []
    skipped_pending = 0
    if kind == "csv":
        mapping_dict = _parse_mapping(mapping)
        try:
            parsed: list[ParsedTransaction] = csv_importer.parse_transactions(
                data, mapping_dict, flip_signs=flip_signs
            )
            columns = csv_importer.preview(data)["columns"]
        except csv_importer.CsvError as exc:
            raise ApiError(400, "parse_error", str(exc)) from exc
        skipped_pending = csv_importer.pending_rows(data, mapping_dict)
        if save_preset is not None and save_preset.strip():
            _upsert_preset(db, save_preset.strip(), columns, mapping_dict, flip_signs)
    else:
        try:
            stmt = ofx_importer.parse(data)
        except ofx_importer.OfxError as exc:
            raise ApiError(400, "parse_error", str(exc)) from exc
        parsed = stmt.transactions
        balance, balance_date = stmt.balance, stmt.balance_date
        acctid = stmt.account_ids[0] if stmt.account_ids else None

    rules = load_rules(db)
    multi = kind == "csv" and bool(mapping_dict.get("account_id_column"))

    if multi:
        if account_id is not None or new_account is not None:
            raise ApiError(
                422, "validation_error",
                "multi-account imports route by account_map — "
                "account_id/new_account must be absent",
            )
        map_dict = _parse_json_field(account_map, "account_map") if account_map else {}
        result = _commit_multi_account(db, parsed, map_dict, rules)
        result["skipped_pending"] = skipped_pending
        db.flush()
        run_auto_pairing(db)
        db.flush()
        return result

    # single-target mode: exactly one of account_id / new_account (#26)
    if (account_id is None) == (new_account is None):
        raise ApiError(
            422, "validation_error",
            "provide exactly one of account_id or new_account",
        )
    created = False
    if new_account is not None:
        account = _create_account(db, _parse_new_account(new_account))
        created = True
    else:
        account = get_or_404(db, Account, account_id, "account_not_found")

    # #26: hashed external-account link for OFX (upsert, last-write-wins);
    # #30: the display mask is captured alongside the hash
    if acctid:
        _link_external(db, account, hash_external_id(acctid), mask_external_id(acctid))

    imported, skipped = _import_into(db, account, parsed, rules)

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

    # #26: single-target CSV commits that save or match a preset remember the
    # target account as the wizard's picker default
    if kind == "csv":
        preset = _preset_by_fingerprint(db, csv_importer.header_fingerprint(columns))
        if preset is not None:
            preset.last_account_id = account.id

    db.flush()  # assign ids before pairing (pair id = smaller txn id)
    # transfer auto-pairing runs after every import commit; idempotent because
    # only unpaired rows are considered and dedupe prevents duplicate rows.
    run_auto_pairing(db)
    db.flush()
    result = {
        "imported": imported,
        "skipped_duplicates": skipped,
        "skipped_pending": skipped_pending,
    }
    if created:
        result["account"] = _serialize_one(db, account)
    return result


def _upsert_preset(
    db, name: str, columns: list[str], mapping: dict, flip_signs: bool
) -> None:
    """One preset per header shape (T-009 contract): saving under an existing
    fingerprint updates name/mapping/flip_signs in place."""
    fingerprint = csv_importer.header_fingerprint(columns)
    preset = _preset_by_fingerprint(db, fingerprint)
    if preset is None:
        db.add(
            ImportPreset(
                name=name, header_fingerprint=fingerprint,
                mapping=mapping, flip_signs=flip_signs,
            )
        )
    else:
        preset.name = name
        preset.mapping = mapping
        preset.flip_signs = flip_signs
    db.flush()
