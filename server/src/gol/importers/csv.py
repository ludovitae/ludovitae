"""CSV import: header sniffing, mapping suggestion, tolerant value parsing."""

from __future__ import annotations

import csv as csvlib
import datetime as dt
import io
import re

from gol.importers.base import ParsedTransaction, amount_ok

SAMPLE_ROWS = 5

_MAPPING_HINTS = {
    "date": ("date", "posted", "transaction date", "post date", "posting date"),
    "amount": ("amount", "amt", "value", "debit/credit"),
    "payee": ("payee", "description", "merchant", "name", "memo", "details"),
    "category": ("category", "type"),
}

_DATE_FORMATS = ("%Y-%m-%d", "%m/%d/%Y", "%m/%d/%y", "%Y/%m/%d", "%d.%m.%Y", "%b %d, %Y")


class CsvError(ValueError):
    pass


def _decode(data: bytes) -> str:
    return data.decode("utf-8-sig", errors="replace")


def _rows(text: str) -> list[list[str]]:
    sample = text[:4096]
    try:
        dialect = csvlib.Sniffer().sniff(sample, delimiters=",;\t|")
    except csvlib.Error:
        dialect = csvlib.excel
    return [row for row in csvlib.reader(io.StringIO(text), dialect) if any(c.strip() for c in row)]


def suggest_mapping(columns: list[str]) -> dict[str, str]:
    mapping: dict[str, str] = {}
    lowered = {col.strip().lower(): col for col in columns}
    for field, hints in _MAPPING_HINTS.items():
        for hint in hints:
            match = next((orig for low, orig in lowered.items() if hint in low), None)
            if match is not None:
                mapping[field] = match
                break
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
        "suggested_mapping": suggest_mapping(columns),
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


def parse_transactions(data: bytes, mapping: dict[str, str]) -> list[ParsedTransaction]:
    for required in ("date", "amount"):
        if required not in mapping:
            raise CsvError(f"mapping must include {required!r}")
    rows = _rows(_decode(data))
    if not rows:
        raise CsvError("empty CSV file")
    columns = [c.strip() for c in rows[0]]
    try:
        idx = {field: columns.index(col) for field, col in mapping.items() if col}
    except ValueError as exc:
        raise CsvError(f"mapped column not found: {exc}") from exc

    out: list[ParsedTransaction] = []
    for row in rows[1:]:
        def cell(field: str, row=row) -> str:
            i = idx.get(field)
            return row[i] if i is not None and i < len(row) else ""

        out.append(
            ParsedTransaction(
                date=parse_date(cell("date")),
                amount=parse_amount(cell("amount")),
                payee=cell("payee").strip(),
                category=cell("category").strip() or None,
            )
        )
    return out
