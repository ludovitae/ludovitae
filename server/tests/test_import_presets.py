"""T-009 — import mapping presets, sign-convention detection, split
debit/credit mappings, and trailing-summary tolerance (docs/API.md v1.2.2)."""

from __future__ import annotations

import hashlib

import pytest

from gol.importers import csv as csv_importer

CARD_CSV = (
    "Date,Description,Amount\n"
    "06/02/2026,COFFEE SHOP,4.50\n"
    "06/03/2026,GAS STATION,51.40\n"
    "06/05/2026,GROCERY STORE,84.12\n"
    "06/08/2026,STREAMING SVC,17.99\n"
    "06/09/2026,BURGER PLACE,12.00\n"
    "06/12/2026,PAYMENT - THANK YOU,-100.00\n"
)

SPLIT_CSV = (
    "Date,Description,Debit,Credit\n"
    "2026-06-01,PAYROLL,,4900.00\n"
    "2026-06-02,MORTGAGE,2350.00,\n"
    "2026-06-05,GROCERIES,96.40,\n"
)


@pytest.fixture()
def checking(authed):
    return authed.post("/api/v1/accounts", json={"name": "Chk", "type": "checking"}).json()


@pytest.fixture()
def card(authed):
    return authed.post("/api/v1/accounts", json={"name": "Card", "type": "credit_card"}).json()


def _preview(authed, account, data: str):
    resp = authed.post(
        "/api/v1/import/preview",
        files={"file": ("t.csv", data, "text/csv")},
        data={"kind": "csv", "account_id": str(account["id"])},
    )
    assert resp.status_code == 200
    return resp.json()


def _commit(authed, account, data: str, mapping: str, **fields):
    resp = authed.post(
        "/api/v1/import/commit",
        files={"file": ("t.csv", data, "text/csv")},
        data={"kind": "csv", "account_id": str(account["id"]), "mapping": mapping, **fields},
    )
    assert resp.status_code == 200, resp.text
    return resp.json()


# ------------------------------ fingerprint ---------------------------------


def test_header_fingerprint_is_sha256_of_lowered_sorted_headers():
    fp = csv_importer.header_fingerprint(["Date", "Description", "Amount"])
    expected = hashlib.sha256(b"amount,date,description").hexdigest()
    assert fp == expected
    # order- and case-insensitive; whitespace trimmed
    assert csv_importer.header_fingerprint([" amount ", "DESCRIPTION", "date"]) == expected


# ------------------------------- presets ------------------------------------


def test_presets_empty_then_saved_on_commit_then_deleted(authed, card):
    assert authed.get("/api/v1/import/presets").json() == []

    mapping = '{"date": "Date", "amount": "Amount", "payee": "Description"}'
    _commit(authed, card, CARD_CSV, mapping, flip_signs="true", save_preset="My Card")

    presets = authed.get("/api/v1/import/presets").json()
    assert len(presets) == 1
    p = presets[0]
    assert set(p) == {"id", "name", "header_fingerprint", "mapping", "flip_signs", "created_at"}
    assert p["name"] == "My Card"
    assert p["flip_signs"] is True
    assert p["mapping"] == {"date": "Date", "amount": "Amount", "payee": "Description"}
    assert p["header_fingerprint"] == csv_importer.header_fingerprint(
        ["Date", "Description", "Amount"]
    )

    assert authed.delete(f"/api/v1/import/presets/{p['id']}").status_code == 204
    assert authed.get("/api/v1/import/presets").json() == []
    assert authed.delete(f"/api/v1/import/presets/{p['id']}").status_code == 404


def test_save_preset_upserts_by_fingerprint(authed, card):
    mapping = '{"date": "Date", "amount": "Amount", "payee": "Description"}'
    _commit(authed, card, CARD_CSV, mapping, save_preset="First name")
    mapping2 = '{"date": "Date", "amount": "Amount"}'
    _commit(authed, card, CARD_CSV, mapping2, flip_signs="true", save_preset="Renamed")

    presets = authed.get("/api/v1/import/presets").json()
    assert len(presets) == 1  # same header shape -> one preset
    assert presets[0]["name"] == "Renamed"
    assert presets[0]["flip_signs"] is True
    assert presets[0]["mapping"] == {"date": "Date", "amount": "Amount"}


def test_commit_without_save_preset_saves_nothing(authed, card):
    mapping = '{"date": "Date", "amount": "Amount", "payee": "Description"}'
    _commit(authed, card, CARD_CSV, mapping)
    _commit(authed, card, CARD_CSV, mapping, save_preset="   ")  # blank name: no save
    assert authed.get("/api/v1/import/presets").json() == []


def test_preview_matches_preset_by_fingerprint(authed, card, checking):
    mapping = '{"date": "Date", "amount": "Amount", "payee": "Description"}'
    _commit(authed, card, CARD_CSV, mapping, flip_signs="true", save_preset="My Card")

    pv = _preview(authed, card, CARD_CSV)
    mp = pv["matched_preset"]
    assert set(mp) == {"id", "name", "mapping", "flip_signs"}
    assert mp["name"] == "My Card"
    assert mp["flip_signs"] is True
    assert mp["mapping"]["amount"] == "Amount"

    # a different header shape does not match
    pv2 = _preview(authed, checking, SPLIT_CSV)
    assert pv2["matched_preset"] is None


# ------------------------------ sign hints -----------------------------------


def test_sign_hint_fires_for_mostly_positive_card_csv(authed, card):
    pv = _preview(authed, card, CARD_CSV)
    hint = pv["sign_hint"]
    assert hint is not None
    assert hint["looks_flipped"] is True
    assert "5 of 6" in hint["reason"]  # 5/6 > 80%; exactly 80% must NOT fire


def test_sign_hint_null_for_checking_or_negative_amounts(authed, checking, card):
    # asset account: heuristic never applies
    assert _preview(authed, checking, CARD_CSV)["sign_hint"] is None
    # card with charges already negative: nothing to say
    negative = (
        CARD_CSV.replace(",4.50", ",-4.50").replace(",51.40", ",-51.40")
        .replace(",84.12", ",-84.12").replace(",17.99", ",-17.99")
        .replace(",12.00", ",-12.00").replace(",-100.00", ",100.00")
    )
    assert _preview(authed, card, negative)["sign_hint"] is None


def test_sign_hint_null_for_split_debit_credit(authed, card):
    # split columns carry explicit signs — no hint even on a card account
    assert _preview(authed, card, SPLIT_CSV)["sign_hint"] is None


def test_commit_flip_signs_negates_amounts(authed, card):
    mapping = '{"date": "Date", "amount": "Amount", "payee": "Description"}'
    result = _commit(authed, card, CARD_CSV, mapping, flip_signs="true")
    assert result == {"imported": 6, "skipped_duplicates": 0}
    rows = authed.get(f"/api/v1/transactions?account_id={card['id']}").json()
    amounts = sorted(r["amount"] for r in rows)
    assert amounts == [-84.12, -51.40, -17.99, -12.00, -4.50, 100.00]


# --------------------------- split debit/credit ------------------------------


def test_suggested_mapping_detects_split_debit_credit_headers(authed, checking):
    pv = _preview(authed, checking, SPLIT_CSV)
    sm = pv["suggested_mapping"]
    assert sm["debit"] == "Debit"
    assert sm["credit"] == "Credit"
    assert "amount" not in sm


def test_single_debit_slash_credit_column_stays_amount():
    sm = csv_importer.suggest_mapping(["Date", "Description", "Debit/Credit"])
    assert sm["amount"] == "Debit/Credit"
    assert "debit" not in sm and "credit" not in sm


def test_commit_with_split_mapping_signs_amounts(authed, checking):
    mapping = '{"date": "Date", "debit": "Debit", "credit": "Credit", "payee": "Description"}'
    result = _commit(authed, checking, SPLIT_CSV, mapping)
    assert result == {"imported": 3, "skipped_duplicates": 0}
    rows = authed.get(f"/api/v1/transactions?account_id={checking['id']}").json()
    by_payee = {r["payee"]: r["amount"] for r in rows}
    assert by_payee == {"PAYROLL": 4900.00, "MORTGAGE": -2350.00, "GROCERIES": -96.40}


def test_split_mapping_row_with_neither_side_mid_file_is_parse_error(authed, checking):
    bad = (
        "Date,Description,Debit,Credit\n"
        "2026-06-01,PAYROLL,,4900.00\n"
        "2026-06-02,MYSTERY,,\n"
        "2026-06-05,GROCERIES,96.40,\n"
    )
    mapping = '{"date": "Date", "debit": "Debit", "credit": "Credit", "payee": "Description"}'
    resp = authed.post(
        "/api/v1/import/commit",
        files={"file": ("t.csv", bad, "text/csv")},
        data={"kind": "csv", "account_id": str(checking["id"]), "mapping": mapping},
    )
    assert resp.status_code == 400
    assert resp.json()["error"]["code"] == "parse_error"


# ------------------------- trailing-summary rows -----------------------------


def test_trailing_summary_rows_are_skipped(authed, checking):
    data = (
        "Date,Description,Amount\n"
        "2026-06-01,PAYROLL,4900.00\n"
        "2026-06-03,GROCERIES,-96.40\n"
        ",Total Credits,4900.00\n"
        ",Ending Balance,4803.60\n"
    )
    mapping = '{"date": "Date", "amount": "Amount", "payee": "Description"}'
    result = _commit(authed, checking, data, mapping)
    assert result == {"imported": 2, "skipped_duplicates": 0}


def test_trailing_row_with_valid_date_and_bad_amount_fails_closed(authed, checking):
    """Fail-closed (security suite rule): trailing tolerance only covers
    date-less summary footers — a dated row with a broken amount is data
    corruption even at the end of the file."""
    data = (
        "Date,Description,Amount\n"
        "2026-06-01,PAYROLL,4900.00\n"
        "2026-06-03,GLITCH," + "9" * 25 + "\n"
    )
    mapping = '{"date": "Date", "amount": "Amount", "payee": "Description"}'
    resp = authed.post(
        "/api/v1/import/commit",
        files={"file": ("t.csv", data, "text/csv")},
        data={"kind": "csv", "account_id": str(checking["id"]), "mapping": mapping},
    )
    assert resp.status_code == 400
    assert resp.json()["error"]["code"] == "parse_error"


def test_mid_file_bad_row_is_still_a_parse_error(authed, checking):
    data = (
        "Date,Description,Amount\n"
        "2026-06-01,PAYROLL,4900.00\n"
        "not-a-date,GARBAGE,1.00\n"
        "2026-06-03,GROCERIES,-96.40\n"
    )
    mapping = '{"date": "Date", "amount": "Amount", "payee": "Description"}'
    resp = authed.post(
        "/api/v1/import/commit",
        files={"file": ("t.csv", data, "text/csv")},
        data={"kind": "csv", "account_id": str(checking["id"]), "mapping": mapping},
    )
    assert resp.status_code == 400
    assert resp.json()["error"]["code"] == "parse_error"


# ------------------------------ auth guard -----------------------------------


def test_presets_require_auth(client):
    assert client.get("/api/v1/import/presets").status_code == 401
    assert client.delete("/api/v1/import/presets/1").status_code == 401
