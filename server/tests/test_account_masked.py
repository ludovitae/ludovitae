"""#30 — external_account_masked: the display mask captured at link time
alongside the hashed external-account id (migration 0008), served read-only
on the Account resource. Covers OFX + multi-account CSV capture, the
pre-0008 hash-but-no-mask back-compat ("···"), collision moves, self-heal,
and the migration itself."""

from __future__ import annotations

import json

import pytest
from alembic import command
from alembic.config import Config as AlembicConfig
from sqlalchemy import select, text

from gol import config
from gol.db import get_engine, reset_engine, session_factory
from gol.importers.base import hash_external_id
from gol.models import Account

OFX = """OFXHEADER:100
DATA:OFXSGML

<OFX>
<BANKMSGSRSV1><STMTTRNRS><STMTRS>
<BANKACCTFROM>
<BANKID>111000
<ACCTID>555777999
<ACCTTYPE>CHECKING
</BANKACCTFROM>
<BANKTRANLIST>
<STMTTRN>
<DTPOSTED>20260601
<TRNAMT>-42.50
<NAME>COFFEE SHOP
</STMTTRN>
</BANKTRANLIST>
<LEDGERBAL>
<BALAMT>900.00
<DTASOF>20260615
</LEDGERBAL>
</STMTRS></STMTTRNRS></BANKMSGSRSV1>
</OFX>
"""

MULTI_CSV = (
    "Date,Amount,Description,Account,Account Number\n"
    "2026-06-01,-10.00,Green Basket,Checking A,11112222\n"
    "2026-06-02,-20.00,Taqueria Luna,Checking A,11112222\n"
    "2026-06-02,-30.00,Bike Shop,Card B,33334444\n"
)
MULTI_MAPPING = (
    '{"date": "Date", "amount": "Amount", "payee": "Description",'
    ' "account_column": "Account", "account_id_column": "Account Number"}'
)


def _commit(authed, kind: str, data: str, **fields):
    return authed.post(
        "/api/v1/import/commit",
        files={"file": (f"t.{kind}", data, "application/octet-stream")},
        data={"kind": kind, **fields},
    )


@pytest.fixture()
def checking(authed):
    return authed.post(
        "/api/v1/accounts", json={"name": "Chk", "type": "checking"}
    ).json()


def _get_account(authed, account_id: int) -> dict:
    return authed.get(f"/api/v1/accounts/{account_id}").json()


# ------------------------------ capture -------------------------------------


def test_unlinked_account_serves_null_mask(authed, checking):
    assert checking["external_account_masked"] is None


def test_ofx_commit_captures_mask_at_link_time(authed, checking):
    resp = _commit(authed, "ofx", OFX, account_id=str(checking["id"]))
    assert resp.status_code == 200, resp.text
    assert _get_account(authed, checking["id"])["external_account_masked"] == "···7999"
    # also present on the list serialization
    listed = {a["id"]: a for a in authed.get("/api/v1/accounts").json()}
    assert listed[checking["id"]]["external_account_masked"] == "···7999"


def test_ofx_new_account_response_carries_mask(authed):
    result = _commit(
        authed, "ofx", OFX,
        new_account='{"name": "Fresh Checking", "type": "checking"}',
    ).json()
    assert result["account"]["external_account_masked"] == "···7999"


def test_multi_account_csv_commit_captures_masks(authed, checking):
    pv = authed.post(
        "/api/v1/import/preview",
        files={"file": ("t.csv", MULTI_CSV, "text/csv")},
        data={"kind": "csv", "mapping": MULTI_MAPPING},
    ).json()
    key_a, key_b = (g["key"] for g in pv["account_groups"])
    result = _commit(
        authed, "csv", MULTI_CSV,
        mapping=MULTI_MAPPING,
        account_map=json.dumps({
            key_a: {"account_id": checking["id"]},
            key_b: {"new_account": {"name": "Card B", "type": "credit_card"}},
        }),
    ).json()
    assert _get_account(authed, checking["id"])["external_account_masked"] == "···2222"
    created_id = next(a["account_id"] for a in result["accounts"] if a["created"])
    assert _get_account(authed, created_id)["external_account_masked"] == "···4444"


def test_collision_move_clears_losers_mask(authed, checking):
    _commit(authed, "ofx", OFX, account_id=str(checking["id"]))
    other = authed.post(
        "/api/v1/accounts", json={"name": "Other", "type": "checking"}
    ).json()
    _commit(authed, "ofx", OFX, account_id=str(other["id"]))
    assert _get_account(authed, other["id"])["external_account_masked"] == "···7999"
    assert _get_account(authed, checking["id"])["external_account_masked"] is None


# --------------------- pre-0008 back-compat + self-heal ----------------------


def _strip_mask(account_id: int) -> None:
    """Simulate an account linked before migration 0008: hash, no mask."""
    db = session_factory()()
    try:
        acc = db.get(Account, account_id)
        acc.external_account_masked = None
        db.commit()
    finally:
        db.close()


def test_legacy_hash_without_mask_serves_bare_ellipsis(authed, checking):
    _commit(authed, "ofx", OFX, account_id=str(checking["id"]))
    _strip_mask(checking["id"])
    assert _get_account(authed, checking["id"])["external_account_masked"] == "···"


def test_legacy_mask_self_heals_on_next_import(authed, checking):
    # OFX path: _link_external re-captures the mask on every commit
    _commit(authed, "ofx", OFX, account_id=str(checking["id"]))
    _strip_mask(checking["id"])
    _commit(authed, "ofx", OFX, account_id=str(checking["id"]))
    assert _get_account(authed, checking["id"])["external_account_masked"] == "···7999"


def test_legacy_mask_self_heals_on_multi_csv_hash_match(authed, checking):
    pv = authed.post(
        "/api/v1/import/preview",
        files={"file": ("t.csv", MULTI_CSV, "text/csv")},
        data={"kind": "csv", "mapping": MULTI_MAPPING},
    ).json()
    key_a, key_b = (g["key"] for g in pv["account_groups"])
    _commit(
        authed, "csv", MULTI_CSV,
        mapping=MULTI_MAPPING,
        account_map=json.dumps({
            key_a: {"account_id": checking["id"]},
            key_b: {"new_account": {"name": "Card B", "type": "credit_card"}},
        }),
    )
    _strip_mask(checking["id"])
    # re-import with no account_map: group A resolves by hash match and heals
    _commit(authed, "csv", MULTI_CSV, mapping=MULTI_MAPPING)
    assert _get_account(authed, checking["id"])["external_account_masked"] == "···2222"


# ------------------------------ read-only -----------------------------------


def test_mask_is_read_only_on_patch_and_create(authed, checking):
    resp = authed.patch(
        f"/api/v1/accounts/{checking['id']}",
        json={"name": "Renamed", "external_account_masked": "···9999"},
    )
    assert resp.status_code == 200
    assert resp.json()["name"] == "Renamed"
    assert resp.json()["external_account_masked"] is None  # unknown field ignored

    created = authed.post(
        "/api/v1/accounts",
        json={"name": "New", "type": "checking", "external_account_masked": "···9999"},
    ).json()
    assert created["external_account_masked"] is None


# ------------------------------ migration -----------------------------------


def _upgrade(revision: str) -> None:
    cfg = AlembicConfig()
    cfg.set_main_option("script_location", "gol:migrations")
    cfg.set_main_option("sqlalchemy.url", config.db_url())
    command.upgrade(cfg, revision)


def test_migration_0008_adds_mask_and_preserves_links(tmp_path, monkeypatch):
    monkeypatch.setenv("GOL_DATA_DIR", str(tmp_path / "data"))
    reset_engine()
    try:
        _upgrade("0007")
        digest = hash_external_id("555777999")
        with get_engine().begin() as conn:
            cols = {r[1] for r in conn.execute(text("PRAGMA table_info(accounts)"))}
            assert "external_account_masked" not in cols
            conn.execute(text(
                "INSERT INTO accounts (name, type, include_in_net_worth, notes,"
                " created_at, track_freshness, external_account_id)"
                " VALUES ('Legacy', 'checking', 1, '', '2026-07-01', 1, :d)"
            ), {"d": digest})
        _upgrade("head")
        db = session_factory()()
        try:
            acc = db.execute(select(Account)).scalar_one()
            # the hash survives; the mask cannot be backfilled (hash is one-way)
            assert acc.external_account_id == digest
            assert acc.external_account_masked is None
        finally:
            db.close()
    finally:
        reset_engine()
