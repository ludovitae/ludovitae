"""Transfer-pairing service: bridges the ORM to gol.analytics.transfers.

Runs after every import commit. Idempotent: only transactions with
transfer_pair_id IS NULL are considered, and row dedupe already prevents
duplicate transactions — re-importing the same file creates zero rows and
therefore zero new pairs. The pair id is the smaller of the two transaction
ids (stable across re-imports because ids are stable).

User unpairs are tombstoned (coordinator ruling 2026-07-11): DELETE
/transfers/pair/{id} records the two transaction ids in
transfer_pair_tombstones and auto-pairing/candidates skip them forever;
manual POST /transfers/pair on the same two transactions clears the
tombstone.
"""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from gol.analytics.transfers import TxnRef, auto_pair, pair_key
from gol.models import Transaction, TransferPairTombstone


def unpaired_refs(db: Session) -> tuple[list[TxnRef], dict[int, Transaction]]:
    rows = (
        db.execute(select(Transaction).where(Transaction.transfer_pair_id.is_(None)))
        .scalars()
        .all()
    )
    refs = [TxnRef(id=t.id, account_id=t.account_id, date=t.date, amount=t.amount) for t in rows]
    return refs, {t.id: t for t in rows}


def load_tombstones(db: Session) -> frozenset[tuple[int, int]]:
    rows = db.execute(
        select(TransferPairTombstone.txn_id_a, TransferPairTombstone.txn_id_b)
    ).all()
    return frozenset(pair_key(a, b) for a, b in rows)


def _tombstone_rows(db: Session, id_a: int, id_b: int) -> list[TransferPairTombstone]:
    key_a, key_b = pair_key(id_a, id_b)
    return list(
        db.execute(
            select(TransferPairTombstone)
            .where(TransferPairTombstone.txn_id_a == key_a)
            .where(TransferPairTombstone.txn_id_b == key_b)
        ).scalars()
    )


def add_tombstone(db: Session, id_a: int, id_b: int) -> None:
    """Record a user unpair (idempotent)."""
    if not _tombstone_rows(db, id_a, id_b):
        key_a, key_b = pair_key(id_a, id_b)
        db.add(TransferPairTombstone(txn_id_a=key_a, txn_id_b=key_b))


def clear_tombstone(db: Session, id_a: int, id_b: int) -> None:
    """Manual re-pair forgives the unpair."""
    for row in _tombstone_rows(db, id_a, id_b):
        db.delete(row)


def run_auto_pairing(db: Session) -> int:
    """Pair confident matches among unpaired transactions; returns new-pair count."""
    refs, by_id = unpaired_refs(db)
    pairs = auto_pair(refs, blocked=load_tombstones(db))
    for id_a, id_b in pairs:
        pair_id = min(id_a, id_b)
        by_id[id_a].transfer_pair_id = pair_id
        by_id[id_b].transfer_pair_id = pair_id
    return len(pairs)
