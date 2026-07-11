"""Common import types + the v2 SyncAdapter interface (live sync lands later)."""

from __future__ import annotations

import abc
import datetime as dt
import hashlib
import math
import re
from dataclasses import dataclass

# Sanity bound for a single imported money value (dollars). Anything larger —
# or non-finite (inf/nan) — is rejected before it reaches the Decimal->int64
# cents column, which would otherwise raise and surface as a 500. Comfortably
# below the int64 cents ceiling (~9.2e16 dollars).
MAX_AMOUNT = 1e13


def amount_ok(value: float) -> bool:
    """True if `value` is a finite, in-range money amount safe to persist."""
    return math.isfinite(value) and abs(value) <= MAX_AMOUNT


def normalize_payee(raw: str) -> str:
    """Collapse consecutive whitespace to single spaces (#26): fixed-width
    padded exports ('TARGET              MANHATTAN   KS') would otherwise
    fragment recurring/merchant analytics and dedupe hashes."""
    return re.sub(r"\s+", " ", raw).strip()


@dataclass(frozen=True)
class ParsedTransaction:
    date: dt.date
    amount: float
    payee: str = ""
    category: str | None = None
    # v1.2.2 (#26) multi-account CSVs: the row's own account identity, when
    # the mapping carries account columns (None for single-target imports).
    account_number: str | None = None
    account_name: str | None = None


def hash_external_id(raw: str) -> str:
    """Hashed external-account link (#26): sha256 of the provider's raw
    account id (OFX ACCTID / CSV account-number cell). Only this hash is ever
    stored or returned — the raw id never leaves the request."""
    return hashlib.sha256(raw.strip().encode()).hexdigest()


def mask_external_id(raw: str) -> str:
    """Display form of an external account id: ···<last 4>."""
    return f"···{raw.strip()[-4:]}"


def dedupe_hash(account_id: int, txn: ParsedTransaction) -> str:
    """Duplicate detection key: (account, date, amount, payee) — docs/API.md."""
    cents = round(txn.amount * 100)
    material = f"{account_id}|{txn.date.isoformat()}|{cents}|{txn.payee.strip().lower()}"
    return hashlib.sha256(material.encode()).hexdigest()


class SyncAdapter(abc.ABC):
    """Interface for v2 live-sync providers (SimpleFIN/Plaid). Unused in v1."""

    @abc.abstractmethod
    def list_accounts(self) -> list[dict]: ...

    @abc.abstractmethod
    def fetch_transactions(
        self, account_ref: str, since: dt.date | None = None
    ) -> list[ParsedTransaction]: ...
