"""#26 — multi-account CSV routing, built-in presets, investment semantics,
status/pending columns, multiline quoted fields, and split-column sign
conventions. Fixtures are synthesized with fake data, modeled on the shapes
of the owner's real Fidelity / Amex / Citi / Commerce exports."""

from __future__ import annotations

import json
import pathlib

from gol.importers import csv as csv_importer
from gol.importers.builtin_presets import BUILTIN_PRESETS

FIXTURES = pathlib.Path(__file__).parent / "fixtures" / "institutions"

PRESET = {spec["name"]: spec["mapping"] for spec in BUILTIN_PRESETS}
FIDELITY = (FIXTURES / "brokerage_multi_account.csv").read_bytes()
AMEX = (FIXTURES / "card_multiline_details.csv").read_bytes()
CITI = (FIXTURES / "card_split_status_pending.csv").read_bytes()
COMMERCE = (FIXTURES / "bank_quoted_unpadded_dates.csv").read_bytes()


def _preview(authed, data: bytes, account_id: int | None = None, **fields):
    form = {"kind": "csv", **fields}
    if account_id is not None:
        form["account_id"] = str(account_id)
    resp = authed.post(
        "/api/v1/import/preview",
        files={"file": ("t.csv", data, "text/csv")},
        data=form,
    )
    assert resp.status_code == 200, resp.text
    return resp.json()


def _commit(authed, data: bytes, **fields):
    return authed.post(
        "/api/v1/import/commit",
        files={"file": ("t.csv", data, "text/csv")},
        data={"kind": "csv", **fields},
    )


def _txns(authed, account_id: int) -> list[dict]:
    return authed.get(f"/api/v1/transactions?account_id={account_id}").json()


# ------------------------- Fidelity-shaped fixture ---------------------------


def test_fidelity_shape_matches_builtin_preset_and_groups(authed):
    pv = _preview(authed, FIDELITY)
    # BOM + two blank preamble lines skipped; 18 true columns
    assert pv["columns"][0] == "Run Date"
    assert len(pv["columns"]) == 18
    assert pv["matched_preset"]["name"] == "Fidelity — Accounts History"

    groups = pv["account_groups"]
    assert [g["name"] for g in groups] == [
        "Roth IRA - Alex", "Brokerage - Alex", "HSA - Sam",
    ]
    assert [g["number_masked"] for g in groups] == ["···2222", "···4444", "···6666"]
    assert all(g["account_id"] is None for g in groups)  # nothing linked yet
    assert [g["rows"] for g in groups] == [3, 2, 2]
    # keys are hashes, not raw numbers
    assert all(len(g["key"]) == 64 for g in groups)


def test_fidelity_multi_commit_creates_routes_and_rematches(authed):
    groups = _preview(authed, FIDELITY)["account_groups"]
    account_map = {
        groups[0]["key"]: {"new_account": {"name": "Roth IRA - Alex", "type": "retirement"}},
        groups[1]["key"]: {"new_account": {"name": "Brokerage - Alex", "type": "brokerage"}},
        groups[2]["key"]: {"new_account": {"name": "HSA - Sam", "type": "hsa"}},
    }
    result = _commit(
        authed, FIDELITY,
        mapping=json.dumps(PRESET["Fidelity — Accounts History"]),
        account_map=json.dumps(account_map),
    ).json()
    assert result["imported"] == 7
    assert result["skipped_duplicates"] == 0
    assert result["skipped_pending"] == 0
    assert len(result["accounts"]) == 3
    assert all(a["created"] for a in result["accounts"])
    by_name = {a["name"]: a for a in result["accounts"]}
    assert by_name["Roth IRA - Alex"]["imported"] == 3
    assert by_name["Brokerage - Alex"]["imported"] == 2
    assert by_name["HSA - Sam"]["imported"] == 2

    # quoted negative amounts parsed; investment auto-category applied
    roth = _txns(authed, by_name["Roth IRA - Alex"]["account_id"])
    assert any(t["amount"] == -0.51 for t in roth)
    assert all(t["category"] == "investment-activity" for t in roth)
    assert all(t["category_source"] == "heuristic" for t in roth)

    # re-import: groups auto-match by hashed number, no account_map needed
    pv2 = _preview(authed, FIDELITY)
    assert [g["account_id"] for g in pv2["account_groups"]] == [
        by_name["Roth IRA - Alex"]["account_id"],
        by_name["Brokerage - Alex"]["account_id"],
        by_name["HSA - Sam"]["account_id"],
    ]
    again = _commit(
        authed, FIDELITY, mapping=json.dumps(PRESET["Fidelity — Accounts History"])
    ).json()
    assert again["imported"] == 0
    assert again["skipped_duplicates"] == 7
    assert not any(a["created"] for a in again["accounts"])


def test_fidelity_unknown_groups_fail_closed(authed):
    resp = _commit(authed, FIDELITY, mapping=json.dumps(PRESET["Fidelity — Accounts History"]))
    assert resp.status_code == 422
    body = resp.json()["error"]
    assert body["code"] == "unknown_account"
    # masked numbers only — never raw ids
    assert "···2222" in body["message"]
    assert "Z1111" not in body["message"]


def test_multi_mode_rejects_single_target_fields(authed, ):
    acc = authed.post(
        "/api/v1/accounts", json={"name": "X", "type": "brokerage"}
    ).json()
    resp = _commit(
        authed, FIDELITY,
        mapping=json.dumps(PRESET["Fidelity — Accounts History"]),
        account_id=str(acc["id"]),
    )
    assert resp.status_code == 422


def test_investment_activity_excluded_from_spending_analytics(authed):
    groups = _preview(authed, FIDELITY)["account_groups"]
    account_map = {
        g["key"]: {"new_account": {"name": g["name"], "type": "brokerage"}}
        for g in groups
    }
    _commit(
        authed, FIDELITY,
        mapping=json.dumps(PRESET["Fidelity — Accounts History"]),
        account_map=json.dumps(account_map),
    )
    observed = authed.get("/api/v1/spending/observed?months=60").json()
    assert observed["by_category"] == []  # a -500 reinvestment is not spending
    summary = authed.get("/api/v1/spending/summary").json()
    assert summary["grand_total"] == 0


# --------------------------- Amex-shaped fixture -----------------------------


def test_amex_multiline_quoted_fields_parse_as_records(authed):
    pv = _preview(authed, AMEX)
    assert len(pv["columns"]) == 13
    assert pv["matched_preset"]["name"] == "American Express — Activity"
    assert pv["matched_preset"]["flip_signs"] is True
    # 7 logical records despite embedded newlines + escaped quotes
    assert pv["account_groups"][0]["rows"] == 7
    assert pv["account_groups"][0]["number_masked"] == "···7001"


def test_amex_commit_flip_normalize_and_heuristic_categories(authed):
    key = _preview(authed, AMEX)["account_groups"][0]["key"]
    result = _commit(
        authed, AMEX,
        mapping=json.dumps(PRESET["American Express — Activity"]),
        flip_signs="true",
        account_map=json.dumps(
            {key: {"new_account": {"name": "Demo Card", "type": "credit_card"}}}
        ),
    ).json()
    assert result["imported"] == 7
    account_id = result["accounts"][0]["account_id"]
    rows = _txns(authed, account_id)
    by_payee = {t["payee"]: t for t in rows}
    # padded payees normalized to single spaces
    assert "BULLSEYE MART SPRINGFIELD OR" in by_payee
    # escaped quotes inside quoted fields survive parsing
    assert 'THE "CORNER" DELI PORTLAND OR' in by_payee
    # charges flipped negative; the payment flipped positive
    assert by_payee["BULLSEYE MART SPRINGFIELD OR"]["amount"] == -84.12
    assert by_payee["ONLINE PAYMENT - THANK YOU"]["amount"] == 250.00
    # #26 ruling: merchant-derived file categories are heuristic, not manual
    groceries = by_payee["BULLSEYE MART SPRINGFIELD OR"]
    assert groceries["category"] == "Merchandise & Supplies-Groceries"
    assert groceries["category_source"] == "heuristic"


def test_amex_sign_hint_fires_for_card_target(authed):
    card = authed.post(
        "/api/v1/accounts", json={"name": "Card", "type": "credit_card"}
    ).json()
    pv = _preview(authed, AMEX, card["id"])
    # preset flips at commit; the hint still reflects the file's convention
    assert pv["sign_hint"] is not None
    assert pv["sign_hint"]["looks_flipped"] is True


# --------------------------- Citi-shaped fixture -----------------------------


def test_citi_status_pending_and_signed_credits(authed):
    card = authed.post(
        "/api/v1/accounts", json={"name": "Citi Card", "type": "credit_card"}
    ).json()
    pv = _preview(authed, CITI, card["id"])
    assert pv["matched_preset"]["name"] == "Citi — Credit Card"
    assert pv["pending_rows"] == 2
    assert pv["sign_hint"] is None  # split columns carry role-based signs

    result = _commit(
        authed, CITI,
        mapping=json.dumps(PRESET["Citi — Credit Card"]),
        account_id=str(card["id"]),
    ).json()
    assert result == {"imported": 5, "skipped_duplicates": 0, "skipped_pending": 2}

    rows = _txns(authed, card["id"])
    by_payee = {t["payee"]: t["amount"] for t in rows}
    # signed-credit trap: -2705.58 in the Credit column is an inflow
    assert by_payee["ONLINE PAYMENT, THANK YOU"] == 2705.58
    assert by_payee["STATEMENT CREDIT"] == 25.00
    # debits are outflows
    assert by_payee["BIG BOX STORE #0442"] == -96.40
    # pending rows never imported
    assert not any("HOLD" in p for p in by_payee)


# ------------------------- Commerce-shaped fixture ---------------------------


def test_commerce_quoted_unpadded_dates_and_classic_split(authed):
    chk = authed.post(
        "/api/v1/accounts", json={"name": "Commerce Chk", "type": "checking"}
    ).json()
    pv = _preview(authed, COMMERCE, chk["id"])
    assert pv["matched_preset"]["name"] == "Commerce Bank — Checking"
    # the always-empty "No." column is never suggested for any role
    assert "No." not in pv["suggested_mapping"].values()
    assert pv["pending_rows"] is None  # no status column in this shape

    result = _commit(
        authed, COMMERCE,
        mapping=json.dumps(PRESET["Commerce Bank — Checking"]),
        account_id=str(chk["id"]),
    ).json()
    assert result == {"imported": 6, "skipped_duplicates": 0, "skipped_pending": 0}

    rows = _txns(authed, chk["id"])
    # non-zero-padded M/D/YYYY dates parsed
    assert {t["date"] for t in rows} == {
        "2026-01-15", "2026-01-09", "2026-01-06", "2026-01-02",
    }
    by_payee = {t["payee"]: t["amount"] for t in rows}
    # classic all-positive split: debit -> outflow, credit -> inflow
    assert by_payee["ACH Debit PAYMENT CITI AUTOPAY 091426531234567"] == -2705.58
    assert by_payee["ACH Credit DEPOSIT ACME CORP PAYROLL 22042219876"] == 4900.00
    assert by_payee["Interest Paid"] == 0.42


def test_date_parsing_accepts_padded_and_unpadded():
    assert csv_importer.parse_date("1/15/2026").isoformat() == "2026-01-15"
    assert csv_importer.parse_date("01/15/2026").isoformat() == "2026-01-15"
    assert csv_importer.parse_date("1/2/2026").isoformat() == "2026-01-02"


def test_cross_file_transfer_pairing_citi_commerce_shapes(authed):
    """The checking-side CITI AUTOPAY leg auto-pairs with the card-side
    payment (exact cents, opposite sign, within ±4 days) — synthesized
    mirror of the owner's real cross-file case."""
    card = authed.post(
        "/api/v1/accounts", json={"name": "Citi Card", "type": "credit_card"}
    ).json()
    chk = authed.post(
        "/api/v1/accounts", json={"name": "Commerce Chk", "type": "checking"}
    ).json()
    # Citi first (payment +2705.58 on 07/01), then Commerce. The synthesized
    # commerce fixture's autopay leg is dated 1/15 — too far to pair — so
    # import a nearby leg to model the real adjacency.
    _commit(authed, CITI, mapping=json.dumps(PRESET["Citi — Credit Card"]),
            account_id=str(card["id"]))
    near_leg = (
        '"Date","No.","Description","Debit","Credit"\n'
        '"6/29/2026","","ACH Debit  PAYMENT    CITI AUTOPAY  0914","2705.58",""\n'
    )
    _commit(authed, near_leg.encode(), mapping=json.dumps(PRESET["Commerce Bank — Checking"]),
            account_id=str(chk["id"]))
    card_rows = _txns(authed, card["id"])
    chk_rows = _txns(authed, chk["id"])
    payment = next(t for t in card_rows if t["amount"] == 2705.58)
    autopay = next(t for t in chk_rows if t["amount"] == -2705.58)
    assert payment["transfer_pair_id"] is not None
    assert payment["transfer_pair_id"] == autopay["transfer_pair_id"]
