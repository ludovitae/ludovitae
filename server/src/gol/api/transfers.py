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
from gol.pairing import unpaired_refs

router = APIRouter(tags=["transfers"])


@router.get("/transfers/candidates")
def list_candidates(db: Db, _: Authenticated):
    refs, by_id = unpaired_refs(db)
    return [
        {"score": score, "txns": [serialize_txn(by_id[a.id]), serialize_txn(by_id[b.id])]}
        for score, a, b in score_candidates(refs)
    ]


class PairBody(BaseModel):
    transaction_ids: list[int] = Field(min_length=2, max_length=2)


@router.post("/transfers/pair")
def pair(body: PairBody, db: Db, _: Authenticated):
    """Manually link two legs. Looser than auto-pairing (the user is
    overriding a near-miss) but still requires cross-account opposite-sign."""
    id_a, id_b = body.transaction_ids
    if id_a == id_b:
        raise ApiError(422, "validation_error", "transaction_ids must be two distinct ids")
    txns = db.execute(
        select(Transaction).where(Transaction.id.in_((id_a, id_b)))
    ).scalars().all()
    if len(txns) != 2:
        found = {t.id for t in txns}
        missing = sorted({id_a, id_b} - found)
        raise ApiError(404, "transaction_not_found", f"unknown transaction ids: {missing}")
    a, b = txns
    if a.transfer_pair_id is not None or b.transfer_pair_id is not None:
        raise ApiError(409, "already_paired", "one of the transactions is already paired")
    if a.account_id == b.account_id:
        raise ApiError(422, "validation_error", "transfer legs must be in different accounts")
    if a.amount == 0 or b.amount == 0 or (a.amount > 0) == (b.amount > 0):
        raise ApiError(422, "validation_error", "transfer legs must have opposite signs")
    pair_id = min(a.id, b.id)
    a.transfer_pair_id = pair_id
    b.transfer_pair_id = pair_id
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
    db.flush()
    return Response(status_code=204)
