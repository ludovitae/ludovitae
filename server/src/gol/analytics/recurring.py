"""Recurring-charge detection (docs/API.md /spending/recurring).

Detection contract: same normalized payee, ≥3 occurrences, regular cadence
(every gap within ±5 days of the cadence length), every amount within ±20%
of the typical (median) amount — price changes inside that band are flagged
via price_change_pct, not disqualifying. `active` = seen within 1.5× cadence.

Pure: callers pass occurrences and `today`.
"""

from __future__ import annotations

import datetime as dt
import re
import statistics
from collections import Counter
from dataclasses import dataclass

CADENCE_DAYS = {"weekly": 7.0, "monthly": 30.44, "annual": 365.25}
GAP_TOLERANCE_DAYS = 5.0
AMOUNT_TOLERANCE = 0.20
ACTIVE_CADENCE_FACTOR = 1.5
# last_amount at the cadence's monthly rate (docs/API.md example: a monthly
# charge's monthly_equivalent equals its last_amount).
MONTHLY_FACTOR = {"weekly": 52.0 / 12.0, "monthly": 1.0, "annual": 1.0 / 12.0}

# Trailing tokens that look like store/reference numbers: all-digit, #1234,
# x1234, ref-ish digit-heavy alnum ("p1234abc"). Dropped repeatedly, but the
# first token always survives so "7-eleven 32233" -> "7-eleven".
_NOISE_TOKEN = re.compile(r"^[#*x]?\d[\d\-/]*$|^(?=(?:[^\d]*\d){3})[a-z0-9\-]+$")


def normalize_payee(payee: str) -> str:
    """Lowercase, collapse whitespace, strip trailing store/reference IDs."""
    tokens = payee.lower().split()
    while len(tokens) > 1 and _NOISE_TOKEN.match(tokens[-1]):
        tokens.pop()
    return " ".join(tokens)


@dataclass(frozen=True)
class Occurrence:
    date: dt.date
    amount: float  # positive spend dollars
    payee: str  # raw payee as imported
    category: str | None = None


@dataclass(frozen=True)
class RecurringCharge:
    key: str  # normalized payee (group identity)
    payee: str  # display payee: most common raw spelling
    category: str | None
    cadence: str
    typical_amount: float
    last_amount: float
    price_change_pct: float
    last_date: dt.date
    first_seen: dt.date
    occurrences: int
    active: bool
    monthly_equivalent: float
    amounts: tuple[float, ...]  # chronological; lets callers assess variance


def _pick_cadence(gaps: list[int]) -> str | None:
    median_gap = statistics.median(gaps)
    best: tuple[float, str] | None = None
    for name, days in CADENCE_DAYS.items():
        if all(abs(gap - days) <= GAP_TOLERANCE_DAYS for gap in gaps):
            distance = abs(median_gap - days)
            if best is None or distance < best[0]:
                best = (distance, name)
    return best[1] if best else None


def _mode(values: list[str], recency: list[str]) -> str:
    """Most common value; ties broken by most recent occurrence."""
    counts = Counter(values)
    top = max(counts.values())
    tied = {v for v, n in counts.items() if n == top}
    for value in reversed(recency):
        if value in tied:
            return value
    return values[-1]


def detect_recurring(occurrences: list[Occurrence], today: dt.date) -> list[RecurringCharge]:
    """Group by normalized payee and keep groups that meet the contract.

    Output is sorted by descending monthly_equivalent, then key.
    """
    groups: dict[str, list[Occurrence]] = {}
    for occ in occurrences:
        key = normalize_payee(occ.payee)
        if key:
            groups.setdefault(key, []).append(occ)

    charges: list[RecurringCharge] = []
    for key, occs in groups.items():
        occs.sort(key=lambda o: o.date)
        if len(occs) < 3:
            continue
        gaps = [(b.date - a.date).days for a, b in zip(occs, occs[1:], strict=False)]
        cadence = _pick_cadence(gaps)
        if cadence is None:
            continue
        amounts = [round(o.amount, 2) for o in occs]
        typical = round(statistics.median(amounts), 2)
        if typical <= 0 or any(abs(a - typical) / typical > AMOUNT_TOLERANCE for a in amounts):
            continue
        last = amounts[-1]
        cadence_days = CADENCE_DAYS[cadence]
        raw_payees = [o.payee for o in occs]
        categories = [o.category for o in occs if o.category]
        charges.append(
            RecurringCharge(
                key=key,
                payee=_mode(raw_payees, raw_payees),
                category=_mode(categories, categories) if categories else None,
                cadence=cadence,
                typical_amount=typical,
                last_amount=last,
                price_change_pct=round((last - typical) / typical * 100.0, 1),
                last_date=occs[-1].date,
                first_seen=occs[0].date,
                occurrences=len(occs),
                active=(today - occs[-1].date).days <= ACTIVE_CADENCE_FACTOR * cadence_days,
                monthly_equivalent=round(last * MONTHLY_FACTOR[cadence], 2),
                amounts=tuple(amounts),
            )
        )
    charges.sort(key=lambda c: (-c.monthly_equivalent, c.key))
    return charges


def relative_stdev(amounts: tuple[float, ...]) -> float:
    """Population stdev / mean — the low-variance test for possibly_forgotten."""
    mean = statistics.fmean(amounts)
    if mean == 0:
        return 0.0
    return statistics.pstdev(amounts) / mean
