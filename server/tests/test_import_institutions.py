"""T-009 — synthetic institution fixtures: CSVs modeled on common real-world
export shapes (charges-positive cards, split debit/credit columns, quoted
payees with embedded commas, MM/DD/YYYY dates, a UTF-8 BOM, trailing summary
rows). Every fixture goes through preview, commit, preset save/rematch, and
the sign-hint flow. These stand in until the owner's real exports arrive in
data/first-mile/ (never committed)."""

from __future__ import annotations

import json
import pathlib

import pytest

FIXTURES = pathlib.Path(__file__).parent / "fixtures" / "institutions"

# fixture file -> (account type, mapping, expected imported rows,
#                  expect sign hint, spot checks {payee: amount})
CASES = {
    "card_charges_positive.csv": {
        "account_type": "credit_card",
        "mapping": {"date": "Date", "amount": "Amount", "payee": "Description"},
        "imported": 10,
        "sign_hint": True,  # 9 of 10 positive on a card
        "flip_signs": True,
        "spot": {"NETFLIX.COM 866-579-7172": -17.99, "PAYMENT RECEIVED - THANK YOU": 450.00},
        "first_date": "2026-06-02",  # MM/DD/YYYY parsed
    },
    "bank_split_debit_credit.csv": {
        "account_type": "checking",
        "mapping": {"date": "Date", "debit": "Debit", "credit": "Credit",
                    "payee": "Description"},
        "imported": 9,
        "sign_hint": False,
        "flip_signs": False,
        "spot": {"ACME CORP PAYROLL": 4900.00, "ROCKET MORTGAGE PAYMENT": -2350.00,
                 "INTEREST PAID": 1.12},
        "first_date": "2026-06-01",
    },
    "card_quoted_payees.csv": {
        "account_type": "credit_card",
        "mapping": {"date": "Transaction Date", "amount": "Amount",
                    "payee": "Description", "category": "Category"},
        "imported": 7,
        "sign_hint": False,  # charges already negative
        "flip_signs": False,
        "spot": {"AMAZON.COM, INC SEATTLE WA": -38.99,
                 "ALASKA AIR 0272315685272": -1254.20,  # quoted "1,254.20"
                 "Payment Thank You - Web": 1367.39},
        "first_date": "2026-06-01",
    },
    "bank_bom_mmddyyyy.csv": {
        "account_type": "checking",
        "mapping": {"date": "Posted Date", "amount": "Amount", "payee": "Payee"},
        "imported": 7,
        "sign_hint": False,
        "flip_signs": False,
        "spot": {"PAYROLL ACME CORP": 2450.00, "SAFEWAY STORE 1442": -72.15},
        "first_date": "2026-06-01",
    },
    "bank_trailing_summary.csv": {
        "account_type": "checking",
        "mapping": {"date": "Date", "amount": "Amount", "payee": "Description"},
        "imported": 6,  # 3 summary footer rows skipped
        "sign_hint": False,
        "flip_signs": False,
        "spot": {"DIRECT DEPOSIT ACME CORP": 4900.00, "ATM WITHDRAWAL": -100.00},
        "first_date": "2026-06-01",
    },
}


def _account(authed, account_type: str) -> dict:
    return authed.post(
        "/api/v1/accounts", json={"name": f"T {account_type}", "type": account_type}
    ).json()


def _upload(authed, path: str, data: bytes, account_id: int, **fields):
    return authed.post(
        f"/api/v1/import/{path}",
        files={"file": ("export.csv", data, "text/csv")},
        data={"kind": "csv", "account_id": str(account_id), **fields},
    )


@pytest.mark.parametrize("name", sorted(CASES))
def test_institution_fixture_full_flow(authed, name):
    """preview → sign hint → commit (+preset) → preset rematch, per fixture."""
    case = CASES[name]
    data = (FIXTURES / name).read_bytes()
    account = _account(authed, case["account_type"])

    # --- preview: columns parse, suggested mapping covers date + an amount ---
    pv = _upload(authed, "preview", data, account["id"]).json()
    assert set(pv) == {"columns", "sample_rows", "suggested_mapping",
                       "matched_preset", "sign_hint", "account_groups",
                       "pending_rows"}
    assert pv["matched_preset"] is None
    suggested = pv["suggested_mapping"]
    assert "date" in suggested
    assert "amount" in suggested or ("debit" in suggested and "credit" in suggested)
    # BOM never leaks into the first column name
    assert not pv["columns"][0].startswith("﻿")

    # --- sign hint matches the fixture's convention ---
    if case["sign_hint"]:
        assert pv["sign_hint"] is not None and pv["sign_hint"]["looks_flipped"] is True
        assert pv["sign_hint"]["reason"]  # plain-language, non-empty
    else:
        assert pv["sign_hint"] is None

    # --- commit with the institution's real mapping, saving a preset ---
    result = _upload(
        authed, "commit", data, account["id"],
        mapping=json.dumps(case["mapping"]),
        flip_signs=str(case["flip_signs"]).lower(),
        save_preset=f"Preset {name}",
    ).json()
    assert result == {"imported": case["imported"], "skipped_duplicates": 0, "skipped_pending": 0}

    rows = authed.get(f"/api/v1/transactions?account_id={account['id']}").json()
    assert len(rows) == case["imported"]
    by_payee = {r["payee"]: r["amount"] for r in rows}
    for payee, amount in case["spot"].items():
        assert by_payee[payee] == amount, (name, payee)
    assert min(r["date"] for r in rows) == case["first_date"]

    # --- re-import is fully deduped ---
    again = _upload(
        authed, "commit", data, account["id"], mapping=json.dumps(case["mapping"]),
        flip_signs=str(case["flip_signs"]).lower(),
    ).json()
    assert again == {"imported": 0, "skipped_duplicates": case["imported"],
                     "skipped_pending": 0}

    # --- preview now matches the saved preset (fingerprint round-trip) ---
    pv2 = _upload(authed, "preview", data, account["id"]).json()
    assert pv2["matched_preset"] is not None
    assert pv2["matched_preset"]["name"] == f"Preset {name}"
    assert pv2["matched_preset"]["mapping"] == case["mapping"]
    assert pv2["matched_preset"]["flip_signs"] is case["flip_signs"]


def test_charges_positive_card_sign_hint_counts():
    """The canned card fixture really is 9-of-10 positive."""
    text = (FIXTURES / "card_charges_positive.csv").read_text()
    amounts = [float(line.rsplit(",", 1)[1]) for line in text.splitlines()[1:]]
    assert sum(1 for a in amounts if a > 0) == 9 and len(amounts) == 10


def test_preset_from_one_account_matches_on_another(authed):
    """Presets are institution-shaped, not account-bound: a preset saved while
    importing into one card matches the same header shape on any account."""
    data = (FIXTURES / "card_charges_positive.csv").read_bytes()
    card_a = _account(authed, "credit_card")
    card_b = _account(authed, "credit_card")
    _upload(
        authed, "commit", data, card_a["id"],
        mapping=json.dumps(CASES["card_charges_positive.csv"]["mapping"]),
        flip_signs="true", save_preset="Shared Card",
    )
    pv = _upload(authed, "preview", data, card_b["id"]).json()
    assert pv["matched_preset"]["name"] == "Shared Card"
