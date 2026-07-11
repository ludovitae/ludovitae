"""Transfer review endpoints (v1.2): scored near-miss candidates, manual
pair/unpair. Confident matches are auto-paired at import time (gol.pairing)."""

from __future__ import annotations

from fastapi import APIRouter, Response
from pydantic import BaseModel, Field
from sqlalchemy import select

from gol.analytics.transfers import candidates as score_candidates
from gol.api.common import Db
from gol.api.transactions import serialize_txn
from gol.auth.deps import Authenticated
from gol.errors import ApiError
from gol.models import Transaction
from gol.pairing import add_tombstone, clear_tombstone, load_tombstones, unpaired_refs

router = APIRouter(tags=["transfers"])


@router.get("/transfers/candidates")
def list_candidates(db: Db, _: Authenticated):
    refs, by_id = unpaired_refs(db)
    return [
        {"score": score, "txns": [serialize_txn(by_id[a.id]), serialize_txn(by_id[b.id])]}
        for score, a, b in score_candidates(refs, blocked=load_tombstones(db))
    ]


class PairBody(BaseModel):
    transaction_ids: list[int] = Field(min_length=2, max_length=2)


def _load_two(db, id_a: int, id_b: int) -> list[Transaction]:
    if id_a == id_b:
        raise ApiError(422, "validation_error", "transaction_ids must be two distinct ids")
    txns = db.execute(
        select(Transaction).where(Transaction.id.in_((id_a, id_b)))
    ).scalars().all()
    if len(txns) != 2:
        missing = sorted({id_a, id_b} - {t.id for t in txns})
        raise ApiError(404, "transaction_not_found", f"unknown transaction ids: {missing}")
    return txns


@router.post("/transfers/candidates/dismiss", status_code=204)
def dismiss_candidate(body: PairBody, db: Db, _: Authenticated):
    """Dismiss a near-miss candidate (ruling 2026-07-11): tombstones the two
    transactions — same mechanism as unpair — so the candidate never
    resurfaces across imports. Manual POST /transfers/pair clears it."""
    a, b = _load_two(db, *body.transaction_ids)
    if a.transfer_pair_id is not None or b.transfer_pair_id is not None:
        raise ApiError(409, "already_paired", "one of the transactions is already paired")
    add_tombstone(db, a.id, b.id)
    db.flush()
    return Response(status_code=204)


@router.post("/transfers/pair")
def pair(body: PairBody, db: Db, _: Authenticated):
    """Manually link two legs. Looser than auto-pairing (the user is
    overriding a near-miss) but still requires cross-account opposite-sign."""
    a, b = _load_two(db, *body.transaction_ids)
    if a.transfer_pair_id is not None or b.transfer_pair_id is not None:
        raise ApiError(409, "already_paired", "one of the transactions is already paired")
    if a.account_id == b.account_id:
        raise ApiError(422, "validation_error", "transfer legs must be in different accounts")
    if a.amount == 0 or b.amount == 0 or (a.amount > 0) == (b.amount > 0):
        raise ApiError(422, "validation_error", "transfer legs must have opposite signs")
    pair_id = min(a.id, b.id)
    a.transfer_pair_id = pair_id
    b.transfer_pair_id = pair_id
    # a manual pair forgives an earlier unpair/dismiss of these transactions
    clear_tombstone(db, a.id, b.id)
    db.flush()
    return [serialize_txn(t) for t in sorted((a, b), key=lambda t: t.id)]


@router.delete("/transfers/pair/{pair_id}", status_code=204)
def unpair(pair_id: int, db: Db, _: Authenticated):
    txns = db.execute(
        select(Transaction).where(Transaction.transfer_pair_id == pair_id)
    ).scalars().all()
    if not txns:
        raise ApiError(404, "pair_not_found", f"no transfer pair {pair_id}")
    for txn in txns:
        txn.transfer_pair_id = None
    # tombstone the pair: auto-pairing must never re-link a user unpair
    # (coordinator ruling 2026-07-11); manual re-pair clears it
    if len(txns) == 2:
        add_tombstone(db, txns[0].id, txns[1].id)
    db.flush()
    return Response(status_code=204)
