"""Transfer-pairing service: bridges the ORM to gol.analytics.transfers.

Runs after every import commit. Idempotent: only transactions with
transfer_pair_id IS NULL are considered, and row dedupe already prevents
duplicate transactions — re-importing the same file creates zero rows and
therefore zero new pairs. The pair id is the smaller of the two transaction
ids (stable across re-imports because ids are stable).

Known limitation (logged in T-007): a manually unpaired confident match will
be re-paired by the next import run — there is no "never pair these"
tombstone in the v1.2 contract.
"""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from gol.analytics.transfers import TxnRef, auto_pair
from gol.models import Transaction


def unpaired_refs(db: Session) -> tuple[list[TxnRef], dict[int, Transaction]]:
    rows = (
        db.execute(select(Transaction).where(Transaction.transfer_pair_id.is_(None)))
        .scalars()
        .all()
    )
    refs = [TxnRef(id=t.id, account_id=t.account_id, date=t.date, amount=t.amount) for t in rows]
    return refs, {t.id: t for t in rows}


def run_auto_pairing(db: Session) -> int:
    """Pair confident matches among unpaired transactions; returns new-pair count."""
    refs, by_id = unpaired_refs(db)
    pairs = auto_pair(refs)
    for id_a, id_b in pairs:
        pair_id = min(id_a, id_b)
        by_id[id_a].transfer_pair_id = pair_id
        by_id[id_b].transfer_pair_id = pair_id
    return len(pairs)
