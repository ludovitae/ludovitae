"""Transfer pairing: confident auto-matches and scored near-miss candidates.

Model (docs/DECISIONS.md 2026-07-11): checking→card payments and other
own-account transfers show up as an outflow in one account and an inflow in
another. Confident matches (exact amount, opposite sign, cross-account,
within ±4 days) pair silently; near-misses (amount within 1% and within
±7 days) are surfaced as scored candidates for review.

Determinism: matching is greedy oldest-first over transactions sorted by
(date, id); among several eligible counterparts the closest-by-date (then
lowest id) wins. Amounts are compared in integer cents. Pairing is therefore
stable across re-imports: identical inputs produce identical pairs.
"""

from __future__ import annotations

import datetime as dt
from dataclasses import dataclass

AUTO_PAIR_WINDOW_DAYS = 4
CANDIDATE_WINDOW_DAYS = 7
CANDIDATE_AMOUNT_TOLERANCE = 0.01  # relative: |a+b| / max(|a|, |b|)

# Candidate score (0–1), documented for the review UI: 60% amount closeness
# (1.0 at exact, 0.0 at the 1% tolerance edge) + 40% date closeness (1.0 same
# day, 0.0 at the ±7-day window edge). An exact-amount match 5 days apart
# scores 0.886; a 1%-off same-day match scores 0.4.
_AMOUNT_WEIGHT = 0.6
_DATE_WEIGHT = 0.4


@dataclass(frozen=True)
class TxnRef:
    """The slice of a transaction that pairing needs."""

    id: int
    account_id: int
    date: dt.date
    amount: float  # dollars, signed


def _cents(amount: float) -> int:
    return round(amount * 100)


def _eligible(a: TxnRef, b: TxnRef, window_days: int, exact: bool) -> bool:
    if a.account_id == b.account_id:
        return False
    ca, cb = _cents(a.amount), _cents(b.amount)
    if ca == 0 or cb == 0 or (ca > 0) == (cb > 0):
        return False
    if abs((a.date - b.date).days) > window_days:
        return False
    if exact:
        return ca == -cb
    return abs(ca + cb) / max(abs(ca), abs(cb)) <= CANDIDATE_AMOUNT_TOLERANCE


def pair_key(id_a: int, id_b: int) -> tuple[int, int]:
    return (min(id_a, id_b), max(id_a, id_b))


def auto_pair(
    txns: list[TxnRef], blocked: frozenset[tuple[int, int]] = frozenset()
) -> list[tuple[int, int]]:
    """Confident matches among *unpaired* transactions.

    Returns (id_a, id_b) tuples with id_a < id_b; each transaction appears in
    at most one pair. Greedy oldest-first (date, then id). `blocked` holds
    (min_id, max_id) tombstones for user-unpaired pairs, which must never be
    auto-relinked (coordinator ruling 2026-07-11).
    """
    ordered = sorted(txns, key=lambda t: (t.date, t.id))
    used: set[int] = set()
    pairs: list[tuple[int, int]] = []
    for i, txn in enumerate(ordered):
        if txn.id in used:
            continue
        best: TxnRef | None = None
        for other in ordered[i + 1 :]:
            if other.id in used:
                continue
            if (other.date - txn.date).days > AUTO_PAIR_WINDOW_DAYS:
                break  # sorted by date: nothing further can match
            if pair_key(txn.id, other.id) in blocked:
                continue
            if not _eligible(txn, other, AUTO_PAIR_WINDOW_DAYS, exact=True):
                continue
            if best is None or (
                abs((other.date - txn.date).days),
                other.date,
                other.id,
            ) < (abs((best.date - txn.date).days), best.date, best.id):
                best = other
        if best is not None:
            used.update((txn.id, best.id))
            pairs.append((min(txn.id, best.id), max(txn.id, best.id)))
    return pairs


def score(a: TxnRef, b: TxnRef) -> float:
    """Candidate score in [0, 1] — see module docstring for the formula."""
    ca, cb = _cents(a.amount), _cents(b.amount)
    ratio = abs(ca + cb) / max(abs(ca), abs(cb))
    amount_closeness = max(0.0, 1.0 - ratio / CANDIDATE_AMOUNT_TOLERANCE)
    day_diff = abs((a.date - b.date).days)
    date_closeness = max(0.0, 1.0 - day_diff / CANDIDATE_WINDOW_DAYS)
    return round(_AMOUNT_WEIGHT * amount_closeness + _DATE_WEIGHT * date_closeness, 3)


def candidates(
    txns: list[TxnRef], blocked: frozenset[tuple[int, int]] = frozenset()
) -> list[tuple[float, TxnRef, TxnRef]]:
    """Scored near-miss pairs among *unpaired* transactions.

    Near-miss = cross-account, opposite sign, amount within 1% and within
    ±7 days (the auto-pair criteria with both bounds relaxed). Tombstoned
    (user-unpaired) pairs are excluded — the user already said "not a
    transfer"; re-linking one is manual POST /transfers/pair only.

    Each transaction appears in at most one candidate; assignment is greedy
    by descending score, ties broken by (id_a, id_b). Result is sorted by
    descending score.
    """
    scored: list[tuple[float, TxnRef, TxnRef]] = []
    ordered = sorted(txns, key=lambda t: (t.date, t.id))
    for i, txn in enumerate(ordered):
        for other in ordered[i + 1 :]:
            if (other.date - txn.date).days > CANDIDATE_WINDOW_DAYS:
                break
            if pair_key(txn.id, other.id) in blocked:
                continue
            if _eligible(txn, other, CANDIDATE_WINDOW_DAYS, exact=False):
                first, second = (txn, other) if txn.id < other.id else (other, txn)
                scored.append((score(first, second), first, second))
    scored.sort(key=lambda item: (-item[0], item[1].id, item[2].id))
    used: set[int] = set()
    out: list[tuple[float, TxnRef, TxnRef]] = []
    for sc, a, b in scored:
        if a.id in used or b.id in used:
            continue
        used.update((a.id, b.id))
        out.append((sc, a, b))
    return out
