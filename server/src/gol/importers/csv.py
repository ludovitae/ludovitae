"""CSV import: header sniffing, mapping suggestion, tolerant value parsing.

v1.2.2 (T-009): header fingerprints for institution presets, split
debit/credit column support, sign-convention detection, and tolerance for
trailing summary rows (bank "Total"/"Ending balance" footers).

v1.2.2 (#26): preamble tolerance (leading blank/non-CSV lines before the
header are skipped), multi-account exports (optional account_column /
account_id_column in the mapping; rows carry their own account identity),
and an exact "Action" column preferred as payee (Fidelity-style exports).
"""

from __future__ import annotations

import csv as csvlib
import datetime as dt
import hashlib
import io
import re

from gol.importers.base import ParsedTransaction, amount_ok, normalize_payee

SAMPLE_ROWS = 5

_MAPPING_HINTS = {
    "date": ("date", "posted", "transaction date", "post date", "posting date"),
    "amount": ("amount", "amt", "value", "debit/credit"),
    "payee": ("payee", "description", "merchant", "name", "memo", "details"),
    "category": ("category", "type"),
}

# Split-column exports: one column for money out, one for money in. Only
# suggested when the file has no single amount column and BOTH sides match
# (a column matching both — e.g. "Debit/Credit" — is a single amount column).
_DEBIT_HINTS = ("debit", "withdrawal", "money out", "charge")
_CREDIT_HINTS = ("credit", "deposit", "money in")

_DATE_FORMATS = ("%Y-%m-%d", "%m/%d/%Y", "%m/%d/%y", "%Y/%m/%d", "%d.%m.%Y", "%b %d, %Y")

# Account types whose transactions should be mostly negative (charges) in our
# sign convention — the sign-hint heuristic applies to these (T-009 ruling).
SIGN_HINT_TYPES = ("credit_card", "loan", "mortgage")


class CsvError(ValueError):
    pass


def _decode(data: bytes) -> str:
    return data.decode("utf-8-sig", errors="replace")


def _rows(text: str) -> list[list[str]]:
    # Sniff ONLY the delimiter (#26): the Sniffer's inferred quoting flags are
    # unreliable on samples with multiline quoted fields (a real Amex export
    # made it pick doublequote=False, corrupting records with escaped quotes).
    # Excel semantics — doublequote, '"' — are the RFC behavior we support.
    sample = text[:4096]
    try:
        delimiter = csvlib.Sniffer().sniff(sample, delimiters=",;\t|").delimiter
    except csvlib.Error:
        delimiter = ","
    rows = [
        row
        for row in csvlib.reader(io.StringIO(text), delimiter=delimiter)
        if any(c.strip() for c in row)
    ]
    # Preamble tolerance (#26): real exports open with title/disclaimer lines
    # before the header. The header is the first row with >= 2 non-empty
    # cells; anything above it is dropped so fingerprints and mappings see
    # the true columns. (Blank lines are already gone via the filter above.)
    start = next(
        (i for i, row in enumerate(rows) if sum(1 for c in row if c.strip()) >= 2),
        0,
    )
    return rows[start:]


def header_fingerprint(columns: list[str]) -> str:
    """Institution identity for presets (T-009 contract): sha256 of the
    lowercased, sorted, comma-joined CSV header list."""
    material = ",".join(sorted(col.strip().lower() for col in columns))
    return hashlib.sha256(material.encode()).hexdigest()


def _matches(low: str, hints: tuple[str, ...]) -> bool:
    return any(hint in low for hint in hints)


# Multi-account exports (#26): identity column (hash source) and display-name
# column. Substring hints for the id; the name column must be exactly
# "account" or contain "account name" (never "account type" etc.).
_ACCOUNT_ID_HINTS = ("account number", "account no", "account #", "acct number", "account id")


def _suggest_account_columns(
    columns: list[str], data_rows: list[list[str]]
) -> dict[str, str]:
    """Suggest account_column/account_id_column when an account-ish header's
    values repeat across rows with more than one distinct value (#26)."""
    lowered = {col.strip().lower(): col for col in columns}
    id_col = next((orig for low, orig in lowered.items() if _matches(low, _ACCOUNT_ID_HINTS)), None)
    if id_col is None or not data_rows:
        return {}
    idx = columns.index(id_col)
    values = {row[idx].strip() for row in data_rows if idx < len(row) and row[idx].strip()}
    # repeat across rows + cardinality > 1: a per-row-unique column (txn ids)
    # or a constant column is not a multi-account marker
    if not (1 < len(values) < len(data_rows)):
        return {}
    out = {"account_id_column": id_col}
    name_col = next(
        (orig for low, orig in lowered.items() if low == "account" or "account name" in low),
        None,
    )
    if name_col is not None:
        out["account_column"] = name_col
    return out


def suggest_mapping(columns: list[str], data_rows: list[list[str]] | None = None) -> dict[str, str]:
    mapping: dict[str, str] = {}
    # #26 (Commerce ruling): never propose a fully-empty column for any role —
    # exports carry placeholder columns ("No.") with no values at all.
    usable = set(range(len(columns)))
    if data_rows:
        usable = {
            i for i in usable
            if any(i < len(row) and row[i].strip() for row in data_rows)
        }
    lowered = {
        col.strip().lower(): col
        for i, col in enumerate(columns)
        if i in usable
    }
    # Fidelity-style exports (#26): a column named exactly "Action" carries
    # the human-readable activity and is preferred as payee over Description.
    if "action" in lowered:
        mapping["payee"] = lowered["action"]
    # Citi-style exports (#26): a column named exactly "Status" marks pending
    # rows, which import skips (skipped_pending).
    if "status" in lowered:
        mapping["status_column"] = lowered["status"]
    for field, hints in _MAPPING_HINTS.items():
        if field in mapping:
            continue
        for hint in hints:
            match = next((orig for low, orig in lowered.items() if hint in low), None)
            if match is not None:
                mapping[field] = match
                break
    mapping.update(_suggest_account_columns(columns, data_rows or []))
    if "amount" not in mapping:
        # split debit/credit columns — a column matching both sides (e.g.
        # "Debit/Credit") is a single signed column, not a split
        debit = next(
            (orig for low, orig in lowered.items()
             if _matches(low, _DEBIT_HINTS) and not _matches(low, _CREDIT_HINTS)),
            None,
        )
        credit = next(
            (orig for low, orig in lowered.items()
             if _matches(low, _CREDIT_HINTS) and not _matches(low, _DEBIT_HINTS)),
            None,
        )
        if debit is not None and credit is not None:
            mapping["debit"] = debit
            mapping["credit"] = credit
    return mapping


def preview(data: bytes) -> dict:
    rows = _rows(_decode(data))
    if not rows:
        raise CsvError("empty CSV file")
    columns = [c.strip() for c in rows[0]]
    sample = [
        {columns[i]: (row[i] if i < len(row) else "") for i in range(len(columns))}
        for row in rows[1 : 1 + SAMPLE_ROWS]
    ]
    return {
        "columns": columns,
        "sample_rows": sample,
        "suggested_mapping": suggest_mapping(columns, rows[1:]),
    }


def parse_date(value: str) -> dt.date:
    value = value.strip()
    for fmt in _DATE_FORMATS:
        try:
            return dt.datetime.strptime(value, fmt).date()
        except ValueError:
            continue
    raise CsvError(f"unparseable date: {value!r}")


def parse_amount(value: str) -> float:
    cleaned = value.strip().replace("$", "").replace(",", "").replace("−", "-")
    negative = cleaned.startswith("(") and cleaned.endswith(")")
    if negative:
        cleaned = cleaned[1:-1]
    if not re.fullmatch(r"-?\d+(\.\d+)?", cleaned):
        raise CsvError(f"unparseable amount: {value!r}")
    amount = float(cleaned)
    amount = -amount if negative else amount
    if not amount_ok(amount):
        raise CsvError(f"amount out of range: {value!r}")
    return amount


def _validate_mapping(mapping: dict[str, str]) -> bool:
    """Returns True for split debit/credit mode, False for single-amount."""
    if "date" not in mapping:
        raise CsvError("mapping must include 'date'")
    split = bool(mapping.get("debit")) and bool(mapping.get("credit"))
    if not split and "amount" not in mapping:
        raise CsvError("mapping must include 'amount' (or both 'debit' and 'credit')")
    if mapping.get("account_column") and not mapping.get("account_id_column"):
        raise CsvError("account_column requires account_id_column (the routing identity)")
    return split


def _column_index(columns: list[str], mapping: dict[str, str]) -> dict[str, int]:
    try:
        return {field: columns.index(col) for field, col in mapping.items() if col}
    except ValueError as exc:
        raise CsvError(f"mapped column not found: {exc}") from exc


def _row_amount(cell: str, split: bool, debit_cell: str, credit_cell: str) -> float:
    """Amount for one row. Split mode (#26 ruling): each side parses as an
    ABSOLUTE value and direction comes from the column's role — debit =
    outflow (negative), credit = inflow (positive). Some exports (Citi) list
    credits already negative; reading the sign from the cell would make
    payments double-count as spending."""
    if not split:
        return parse_amount(cell)
    debit = parse_amount(debit_cell) if debit_cell.strip() else 0.0
    credit = parse_amount(credit_cell) if credit_cell.strip() else 0.0
    if not debit_cell.strip() and not credit_cell.strip():
        raise CsvError("row has neither a debit nor a credit amount")
    return abs(credit) - abs(debit)


def parse_transactions(
    data: bytes, mapping: dict[str, str], flip_signs: bool = False
) -> list[ParsedTransaction]:
    split = _validate_mapping(mapping)
    rows = _rows(_decode(data))
    if not rows:
        raise CsvError("empty CSV file")
    columns = [c.strip() for c in rows[0]]
    idx = _column_index(columns, mapping)

    parsed: list[ParsedTransaction | CsvError] = []
    for row in rows[1:]:
        def cell(field: str, row=row) -> str:
            i = idx.get(field)
            return row[i] if i is not None and i < len(row) else ""

        # Pending rows (#26 Citi ruling): skipped entirely — their amounts
        # mutate when they post and would break dedupe. Counted separately
        # via pending_rows() for the skipped_pending report.
        if _is_pending(cell("status_column")):
            continue
        try:
            date = parse_date(cell("date"))
        except CsvError as exc:
            # Only a row that doesn't even carry a date can be a summary
            # footer candidate (trailing tolerance below).
            parsed.append(exc)
            continue
        # A row WITH a valid date must parse completely — amount errors
        # (oversized, garbage, missing) always fail closed, never skip.
        amount = _row_amount(cell("amount"), split, cell("debit"), cell("credit"))
        parsed.append(
            ParsedTransaction(
                date=date,
                amount=-amount if flip_signs else amount,
                payee=normalize_payee(cell("payee")),
                category=cell("category").strip() or None,
                account_number=cell("account_id_column").strip() or None,
                account_name=cell("account_column").strip() or None,
            )
        )

    # Trailing-summary tolerance (T-009): banks append "Total"/"Ending
    # balance" footer rows (no date in the date column). A contiguous block of
    # date-less rows at the END is silently dropped; one anywhere else stays a
    # hard error so mid-file corruption is never swallowed.
    last_ok = max((i for i, p in enumerate(parsed) if isinstance(p, ParsedTransaction)), default=-1)
    for item in parsed[: last_ok + 1]:
        if isinstance(item, CsvError):
            raise item
    return [p for p in parsed[: last_ok + 1] if isinstance(p, ParsedTransaction)]


def _is_pending(status_cell: str) -> bool:
    return status_cell.strip().lower() == "pending"


def pending_rows(data: bytes, mapping: dict[str, str]) -> int:
    """How many rows the mapped status_column marks Pending (#26) — lenient:
    0 when the mapping/file has no usable status column."""
    col = mapping.get("status_column")
    if not col:
        return 0
    rows = _rows(_decode(data))
    if not rows:
        return 0
    columns = [c.strip() for c in rows[0]]
    if col not in columns:
        return 0
    i = columns.index(col)
    return sum(1 for row in rows[1:] if i < len(row) and _is_pending(row[i]))


def lenient_amounts(data: bytes, mapping: dict[str, str]) -> list[float]:
    """All row amounts that parse under `mapping`, unparseable rows skipped —
    feeds the sign-convention heuristic (never raises for row-level issues)."""
    try:
        split = _validate_mapping(mapping)
    except CsvError:
        return []
    rows = _rows(_decode(data))
    if not rows:
        return []
    try:
        idx = _column_index([c.strip() for c in rows[0]], mapping)
    except CsvError:
        return []
    out: list[float] = []
    for row in rows[1:]:
        def cell(field: str, row=row) -> str:
            i = idx.get(field)
            return row[i] if i is not None and i < len(row) else ""

        if _is_pending(cell("status_column")):
            continue
        try:
            out.append(_row_amount(cell("amount"), split, cell("debit"), cell("credit")))
        except CsvError:
            continue
    return out


def sign_hint(amounts: list[float], account_type: str) -> dict | None:
    """T-009 heuristic: liability accounts (cards/loans) should be mostly
    charges (negative). >80% positive amounts → the export very likely lists
    charges as positive; suggest flipping signs. None when nothing to say."""
    if account_type not in SIGN_HINT_TYPES or not amounts:
        return None
    positive = sum(1 for a in amounts if a > 0)
    if positive / len(amounts) <= 0.8:
        return None
    label = "credit card" if account_type == "credit_card" else account_type
    return {
        "looks_flipped": True,
        "reason": (
            f"{positive} of {len(amounts)} rows look like charges, but they are "
            f"positive — this {label} export probably lists charges as positive "
            "numbers. Flipping signs stores charges as money out."
        ),
    }
