"""#26 — import account matching & creation: hashed external-account links
(OFX ACCTID), preview account_match, commit-side new_account, preset
last_account_id, and idempotent re-imports. Multi-account CSV routing lives
in test_import_multi_account.py."""

from __future__ import annotations

import pytest

from gol.importers.base import hash_external_id, mask_external_id, normalize_payee

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
<NAME>COFFEE   SHOP     0042
</STMTTRN>
<STMTTRN>
<DTPOSTED>20260610
<TRNAMT>1250.00
<NAME>PAYROLL
</STMTTRN>
</BANKTRANLIST>
<LEDGERBAL>
<BALAMT>900.00
<DTASOF>20260615
</LEDGERBAL>
</STMTRS></STMTTRNRS></BANKMSGSRSV1>
</OFX>
"""

CSV_DATA = (
    "Date,Amount,Description\n"
    "2026-06-01,-10.00,Green Basket\n"
    "2026-06-02,-20.00,Taqueria Luna\n"
)


def _preview(authed, kind: str, data: str, account_id: int | None = None, **fields):
    form = {"kind": kind, **fields}
    if account_id is not None:
        form["account_id"] = str(account_id)
    resp = authed.post(
        "/api/v1/import/preview",
        files={"file": (f"t.{kind}", data, "application/octet-stream")},
        data=form,
    )
    return resp


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


# ------------------------------ helpers -------------------------------------


def test_hash_and_mask_external_id():
    assert hash_external_id(" 555777999 ") == hash_external_id("555777999")
    assert len(hash_external_id("555777999")) == 64
    assert mask_external_id("555777999") == "···7999"
    assert normalize_payee("COFFEE   SHOP \t 0042") == "COFFEE SHOP 0042"


# ------------------------- OFX match / link / create ------------------------


def test_ofx_unknown_then_link_then_match(authed, checking):
    # unknown id: preview reports the masked id with no match
    pv = _preview(authed, "ofx", OFX, checking["id"]).json()
    assert pv["account_match"] == {"account_id": None, "acctid_masked": "···7999"}

    # committing into an account links the hashed ACCTID to it
    result = _commit(authed, "ofx", OFX, account_id=str(checking["id"])).json()
    assert result == {"imported": 2, "skipped_duplicates": 0, "skipped_pending": 0}

    # ...so the next preview auto-matches, even without a target account
    pv2 = _preview(authed, "ofx", OFX).json()
    assert pv2["account_match"] == {
        "account_id": checking["id"], "acctid_masked": "···7999",
    }

    # idempotent re-import into the matched account
    again = _commit(authed, "ofx", OFX, account_id=str(checking["id"])).json()
    assert again == {"imported": 0, "skipped_duplicates": 2, "skipped_pending": 0}


def test_ofx_commit_new_account_creates_and_links(authed):
    result = _commit(
        authed, "ofx", OFX,
        new_account='{"name": "Fresh Checking", "type": "checking"}',
    ).json()
    assert result["imported"] == 2
    account = result["account"]
    assert account["name"] == "Fresh Checking"
    assert account["type"] == "checking"
    assert account["track_freshness"] is True  # type-appropriate default
    assert account["freshness"] == "fresh"  # commit counts as an import
    # the created account is linked: preview matches it
    pv = _preview(authed, "ofx", OFX).json()
    assert pv["account_match"]["account_id"] == account["id"]
    # payee whitespace was normalized on import
    rows = authed.get(f"/api/v1/transactions?account_id={account['id']}").json()
    assert {r["payee"] for r in rows} == {"COFFEE SHOP 0042", "PAYROLL"}


def test_link_collision_moves_last_write_wins(authed, checking):
    _commit(authed, "ofx", OFX, account_id=str(checking["id"]))
    other = authed.post(
        "/api/v1/accounts", json={"name": "Other", "type": "checking"}
    ).json()
    # re-importing the same file into another account moves the link
    _commit(authed, "ofx", OFX, account_id=str(other["id"]))
    pv = _preview(authed, "ofx", OFX).json()
    assert pv["account_match"]["account_id"] == other["id"]


# --------------------------- commit validation ------------------------------


def test_commit_requires_exactly_one_target(authed, checking):
    neither = _commit(authed, "csv", CSV_DATA,
                      mapping='{"date": "Date", "amount": "Amount"}')
    assert neither.status_code == 422
    assert neither.json()["error"]["code"] == "validation_error"

    both = _commit(
        authed, "csv", CSV_DATA,
        mapping='{"date": "Date", "amount": "Amount"}',
        account_id=str(checking["id"]),
        new_account='{"name": "X", "type": "checking"}',
    )
    assert both.status_code == 422


def test_new_account_validation_envelope(authed):
    bad_type = _commit(
        authed, "csv", CSV_DATA,
        mapping='{"date": "Date", "amount": "Amount"}',
        new_account='{"name": "X", "type": "yacht"}',
    )
    assert bad_type.status_code == 422
    assert bad_type.json()["error"]["code"] == "validation_error"

    bad_json = _commit(
        authed, "csv", CSV_DATA,
        mapping='{"date": "Date", "amount": "Amount"}',
        new_account="not json",
    )
    assert bad_json.status_code == 422

    missing_name = _commit(
        authed, "csv", CSV_DATA,
        mapping='{"date": "Date", "amount": "Amount"}',
        new_account='{"type": "checking"}',
    )
    assert missing_name.status_code == 422
    assert "new_account" in missing_name.json()["error"]["message"]

    bad_member = _commit(
        authed, "csv", CSV_DATA,
        mapping='{"date": "Date", "amount": "Amount"}',
        new_account='{"name": "X", "type": "checking", "member_id": 999}',
    )
    assert bad_member.status_code == 404


def test_csv_commit_new_account_and_property_freshness_default(authed):
    result = _commit(
        authed, "csv", CSV_DATA,
        mapping='{"date": "Date", "amount": "Amount", "payee": "Description"}',
        new_account='{"name": "Beach House", "type": "property"}',
    ).json()
    assert result["imported"] == 2
    assert result["account"]["track_freshness"] is False  # property default


def test_preview_account_id_now_optional(authed):
    pv = _preview(authed, "csv", CSV_DATA).json()
    assert pv["sign_hint"] is None  # no account, no sign convention to check
    assert pv["suggested_mapping"]["date"] == "Date"
    # a bogus account id still 404s when provided
    assert _preview(authed, "csv", CSV_DATA, account_id=9999).status_code == 404


# ----------------------- preset last_account_id -----------------------------


def test_preset_remembers_last_account(authed, checking):
    mapping = '{"date": "Date", "amount": "Amount", "payee": "Description"}'
    _commit(authed, "csv", CSV_DATA, mapping=mapping,
            account_id=str(checking["id"]), save_preset="Green Bank")
    pv = _preview(authed, "csv", CSV_DATA, checking["id"]).json()
    assert pv["matched_preset"]["last_account_id"] == checking["id"]

    # a later commit into a different account moves the default
    other = authed.post(
        "/api/v1/accounts", json={"name": "Other", "type": "checking"}
    ).json()
    _commit(authed, "csv", CSV_DATA, mapping=mapping, account_id=str(other["id"]))
    pv2 = _preview(authed, "csv", CSV_DATA, checking["id"]).json()
    assert pv2["matched_preset"]["last_account_id"] == other["id"]

    # deleting the account nulls the served default (loose reference)
    authed.delete(f"/api/v1/accounts/{other['id']}")
    pv3 = _preview(authed, "csv", CSV_DATA, checking["id"]).json()
    assert pv3["matched_preset"]["last_account_id"] is None
