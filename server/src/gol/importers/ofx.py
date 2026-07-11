"""Minimal, tolerant OFX parser (hand-rolled).

Handles both OFX 1.x (SGML with unclosed leaf tags) and 2.x (XML) by treating
the document as a flat tag stream: it only needs transactions, ledger
balances, and account ids — not the full schema.
"""

from __future__ import annotations

import datetime as dt
import re
from dataclasses import dataclass, field

from gol.importers.base import ParsedTransaction, amount_ok, normalize_payee


class OfxError(ValueError):
    pass


@dataclass
class OfxStatement:
    account_ids: list[str] = field(default_factory=list)
    transactions: list[ParsedTransaction] = field(default_factory=list)
    balance: float | None = None
    balance_date: dt.date | None = None


_TXN_BLOCK = re.compile(r"<STMTTRN>(.*?)(?=</STMTTRN>|<STMTTRN>|</BANKTRANLIST>|$)", re.S | re.I)
_LEDGER_BLOCK = re.compile(r"<LEDGERBAL>(.*?)(?=</LEDGERBAL>|<AVAILBAL>|$)", re.S | re.I)


def _leaf(body: str, tag: str) -> str | None:
    """Value of a leaf tag: text up to the next '<' or end of line (SGML-safe)."""
    match = re.search(rf"<{tag}>([^<\r\n]*)", body, re.I)
    if match is None:
        return None
    value = match.group(1).strip()
    return value or None


def _parse_ofx_date(value: str | None) -> dt.date | None:
    if not value:
        return None
    digits = re.match(r"(\d{8})", value.strip())
    if not digits:
        return None
    try:
        return dt.datetime.strptime(digits.group(1), "%Y%m%d").date()
    except ValueError:
        return None


def _parse_amount(value: str | None) -> float | None:
    if value is None:
        return None
    try:
        amount = float(value.replace(",", "."))
    except ValueError:
        return None
    # Drop non-finite / absurd magnitudes (inf, nan, overflow) so they can never
    # reach the int64 cents column and crash the request with a 500.
    return amount if amount_ok(amount) else None


def _strip_headers(text: str) -> str:
    """Drop OFX 1.x colon-headers / XML prolog; keep from the first tag."""
    start = text.find("<")
    return text[start:] if start >= 0 else text


def parse(data: bytes) -> OfxStatement:
    text = _strip_headers(data.decode("utf-8", errors="replace"))
    if "<OFX" not in text.upper():
        raise OfxError("not an OFX document")

    stmt = OfxStatement()
    seen: set[str] = set()
    for match in re.finditer(r"<ACCTID>([^<\r\n]+)", text, re.I):
        acct = match.group(1).strip()
        if acct and acct not in seen:
            seen.add(acct)
            stmt.account_ids.append(acct)

    for block_match in _TXN_BLOCK.finditer(text):
        block = block_match.group(1)
        date = _parse_ofx_date(_leaf(block, "DTPOSTED"))
        amount = _parse_amount(_leaf(block, "TRNAMT"))
        if date is None or amount is None:
            continue  # tolerate malformed entries
        payee = normalize_payee(_leaf(block, "NAME") or _leaf(block, "MEMO") or "")
        stmt.transactions.append(ParsedTransaction(date=date, amount=amount, payee=payee))

    ledger = _LEDGER_BLOCK.search(text)
    if ledger is not None:
        stmt.balance = _parse_amount(_leaf(ledger.group(1), "BALAMT"))
        stmt.balance_date = _parse_ofx_date(_leaf(ledger.group(1), "DTASOF"))
    return stmt
