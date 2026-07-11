from __future__ import annotations

import pytest

from gol.importers import ofx as ofx_importer

OFX_V1_SGML = """OFXHEADER:100
DATA:OFXSGML
VERSION:102
SECURITY:NONE
ENCODING:USASCII

<OFX>
<BANKMSGSRSV1>
<STMTTRNRS>
<STMTRS>
<CURDEF>USD
<BANKACCTFROM>
<BANKID>123456789
<ACCTID>9876543210
<ACCTTYPE>CHECKING
</BANKACCTFROM>
<BANKTRANLIST>
<STMTTRN>
<TRNTYPE>DEBIT
<DTPOSTED>20260105120000[0:GMT]
<TRNAMT>-42.50
<FITID>TXN-001
<NAME>BLUE BOTTLE COFFEE
</STMTTRN>
<STMTTRN>
<TRNTYPE>CREDIT
<DTPOSTED>20260110
<TRNAMT>1250.00
<FITID>TXN-002
<MEMO>PAYROLL DEPOSIT
</STMTTRN>
<LEDGERBAL>
<BALAMT>10412.88
<DTASOF>20260201
</LEDGERBAL>
</STMTRS>
</STMTTRNRS>
</BANKMSGSRSV1>
</OFX>
"""

OFX_V2_XML = """<?xml version="1.0" encoding="UTF-8"?>
<?OFX OFXHEADER="200" VERSION="211" SECURITY="NONE"?>
<OFX>
  <BANKMSGSRSV1><STMTTRNRS><STMTRS>
    <BANKACCTFROM><BANKID>111000</BANKID><ACCTID>ACCT-22</ACCTID></BANKACCTFROM>
    <BANKTRANLIST>
      <STMTTRN>
        <TRNTYPE>DEBIT</TRNTYPE>
        <DTPOSTED>20260215</DTPOSTED>
        <TRNAMT>-99.99</TRNAMT>
        <FITID>X1</FITID>
        <NAME>HARDWARE STORE</NAME>
      </STMTTRN>
    </BANKTRANLIST>
    <LEDGERBAL><BALAMT>5000.00</BALAMT><DTASOF>20260301</DTASOF></LEDGERBAL>
  </STMTRS></STMTTRNRS></BANKMSGSRSV1>
</OFX>
"""

CSV_DATA = (
    "Date,Amount,Description,Category\n"
    "2026-01-05,-42.50,Blue Bottle Coffee,dining\n"
    "01/10/2026,\"1,250.00\",Payroll,income\n"
    "2026-01-12,($15.00),Parking,transport\n"
)


@pytest.fixture()
def account(authed):
    return authed.post("/api/v1/accounts", json={"name": "Chk", "type": "checking"}).json()


def test_ofx_v1_sgml_parses():
    stmt = ofx_importer.parse(OFX_V1_SGML.encode())
    assert stmt.account_ids == ["9876543210"]
    assert len(stmt.transactions) == 2
    assert stmt.transactions[0].amount == -42.50
    assert stmt.transactions[0].payee == "BLUE BOTTLE COFFEE"
    assert stmt.transactions[0].date.isoformat() == "2026-01-05"
    assert stmt.transactions[1].payee == "PAYROLL DEPOSIT"
    assert stmt.balance == 10412.88
    assert stmt.balance_date.isoformat() == "2026-02-01"


def test_ofx_v2_xml_parses():
    stmt = ofx_importer.parse(OFX_V2_XML.encode())
    assert stmt.account_ids == ["ACCT-22"]
    assert len(stmt.transactions) == 1
    assert stmt.transactions[0].amount == -99.99
    assert stmt.balance == 5000.00


def test_csv_preview_suggests_mapping(authed, account):
    resp = authed.post(
        "/api/v1/import/preview",
        files={"file": ("t.csv", CSV_DATA, "text/csv")},
        data={"kind": "csv", "account_id": str(account["id"])},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["columns"] == ["Date", "Amount", "Description", "Category"]
    assert len(body["sample_rows"]) == 3
    assert body["suggested_mapping"] == {
        "date": "Date", "amount": "Amount", "payee": "Description", "category": "Category",
    }


def test_ofx_preview_shape(authed, account):
    resp = authed.post(
        "/api/v1/import/preview",
        files={"file": ("t.ofx", OFX_V1_SGML, "application/x-ofx")},
        data={"kind": "ofx", "account_id": str(account["id"])},
    )
    assert resp.status_code == 200
    assert resp.json() == {
        "accounts_found": ["9876543210"], "transaction_count": 2, "balance": 10412.88,
        # #26: matched by hashed ACCTID; nothing linked yet -> null id
        "account_match": {"account_id": None, "acctid_masked": "···3210"},
    }


def test_csv_commit_parses_messy_values_and_dedupes(authed, account):
    mapping = '{"date": "Date", "amount": "Amount", "payee": "Description", "category": "Category"}'
    data = {"kind": "csv", "account_id": str(account["id"]), "mapping": mapping}
    first = authed.post(
        "/api/v1/import/commit", files={"file": ("t.csv", CSV_DATA, "text/csv")}, data=data
    ).json()
    assert first == {"imported": 3, "skipped_duplicates": 0, "skipped_pending": 0}

    again = authed.post(
        "/api/v1/import/commit", files={"file": ("t.csv", CSV_DATA, "text/csv")}, data=data
    ).json()
    assert again == {"imported": 0, "skipped_duplicates": 3, "skipped_pending": 0}

    rows = authed.get(f"/api/v1/transactions?account_id={account['id']}").json()
    assert len(rows) == 3
    amounts = sorted(r["amount"] for r in rows)
    assert amounts == [-42.50, -15.00, 1250.00]  # $, commas, parens handled


def test_ofx_commit_updates_balance(authed, account):
    resp = authed.post(
        "/api/v1/import/commit",
        files={"file": ("t.ofx", OFX_V1_SGML, "application/x-ofx")},
        data={"kind": "ofx", "account_id": str(account["id"]), "update_balance": "true"},
    )
    assert resp.json() == {"imported": 2, "skipped_duplicates": 0, "skipped_pending": 0}
    balances = authed.get(f"/api/v1/accounts/{account['id']}/balances").json()
    assert {"date": "2026-02-01", "amount": 10412.88} in balances


def test_import_size_limit(authed, account):
    big = b"Date,Amount\n" + b"2026-01-01,1.00\n" * 400_000  # > 5 MB
    resp = authed.post(
        "/api/v1/import/preview",
        files={"file": ("big.csv", big, "text/csv")},
        data={"kind": "csv", "account_id": str(account["id"])},
    )
    assert resp.status_code == 413
    assert resp.json()["error"]["code"] == "file_too_large"


def test_import_bad_kind(authed, account):
    resp = authed.post(
        "/api/v1/import/preview",
        files={"file": ("t.qfx", "x", "text/plain")},
        data={"kind": "qif", "account_id": str(account["id"])},
    )
    assert resp.status_code == 422
