"""T-005 /household endpoint tests: exactly-one-self invariant, validation
envelopes, ownership wiring on accounts/flows."""

from __future__ import annotations


def _self(authed) -> dict:
    return next(m for m in authed.get("/api/v1/household").json() if m["role"] == "self")


def test_get_household_auto_creates_self(authed):
    members = authed.get("/api/v1/household").json()
    assert len(members) == 1
    m = members[0]
    assert m["role"] == "self"
    assert m["name"] == "You"
    assert m["birth_year"] == 1980
    assert m["life_expectancy"] == 92


def test_create_partner_and_child(authed):
    partner = authed.post(
        "/api/v1/household",
        json={"name": "Dana", "role": "partner", "birth_year": 1983,
              "life_expectancy": 94, "retirement_age": 67,
              "ss_monthly_at_fra": 1900.0, "ss_claim_age": 65},
    )
    assert partner.status_code == 201
    assert partner.json()["ss_claim_age"] == 65

    child = authed.post(
        "/api/v1/household",
        json={"name": "Riley", "role": "child", "birth_year": 2014,
              "life_expectancy": 92},
    )
    assert child.status_code == 201
    body = child.json()
    assert body["retirement_age"] is None
    assert body["ss_monthly_at_fra"] is None
    assert body["ss_claim_age"] is None

    assert len(authed.get("/api/v1/household").json()) == 3


def test_second_self_rejected(authed):
    authed.get("/api/v1/household")  # materialize the self member
    resp = authed.post(
        "/api/v1/household",
        json={"name": "Also me", "role": "self", "birth_year": 1985,
              "life_expectancy": 90},
    )
    assert resp.status_code == 409
    assert resp.json()["error"]["code"] == "self_member_exists"


def test_bad_role_rejected(authed):
    resp = authed.post(
        "/api/v1/household",
        json={"name": "Rex", "role": "dog", "birth_year": 2020, "life_expectancy": 15},
    )
    assert resp.status_code == 422
    assert resp.json()["error"]["code"] == "validation_error"


def test_claim_age_bounds(authed):
    for bad_age in (61, 71):
        resp = authed.post(
            "/api/v1/household",
            json={"name": "X", "role": "partner", "birth_year": 1980,
                  "life_expectancy": 90, "ss_claim_age": bad_age},
        )
        assert resp.status_code == 422, bad_age


def test_patch_member_and_role_invariants(authed):
    self_id = _self(authed)["id"]
    patched = authed.patch(
        f"/api/v1/household/{self_id}",
        json={"name": "Brian", "retirement_age": 60},
    )
    assert patched.status_code == 200
    assert patched.json()["name"] == "Brian"
    assert patched.json()["retirement_age"] == 60

    # self's role is immutable
    resp = authed.patch(f"/api/v1/household/{self_id}", json={"role": "partner"})
    assert resp.status_code == 409
    assert resp.json()["error"]["code"] == "self_role_immutable"

    # nobody else can become self
    partner_id = authed.post(
        "/api/v1/household",
        json={"name": "Dana", "role": "partner", "birth_year": 1983,
              "life_expectancy": 94},
    ).json()["id"]
    resp = authed.patch(f"/api/v1/household/{partner_id}", json={"role": "self"})
    assert resp.status_code == 409
    # but partner -> other is fine
    assert authed.patch(
        f"/api/v1/household/{partner_id}", json={"role": "other"}
    ).status_code == 200


def test_self_member_undeletable(authed):
    self_id = _self(authed)["id"]
    resp = authed.delete(f"/api/v1/household/{self_id}")
    assert resp.status_code == 403
    assert resp.json()["error"]["code"] == "self_member_undeletable"


def test_delete_partner_nulls_ownership(authed):
    partner_id = authed.post(
        "/api/v1/household",
        json={"name": "Dana", "role": "partner", "birth_year": 1983,
              "life_expectancy": 94},
    ).json()["id"]
    acc = authed.post(
        "/api/v1/accounts",
        json={"name": "Dana's 403(b)", "type": "retirement", "balance": 50_000,
              "member_id": partner_id},
    ).json()
    assert acc["member_id"] == partner_id
    flow = authed.post(
        "/api/v1/flows",
        json={"name": "Dana's salary", "kind": "income", "amount_monthly": 6_000,
              "member_id": partner_id, "ends_at_retirement": True},
    ).json()
    assert flow["member_id"] == partner_id

    assert authed.delete(f"/api/v1/household/{partner_id}").status_code == 204
    assert authed.get(f"/api/v1/accounts/{acc['id']}").json()["member_id"] is None
    assert [f for f in authed.get("/api/v1/flows").json() if f["id"] == flow["id"]][0][
        "member_id"] is None


def test_unknown_member_on_account_and_flow_404(authed):
    resp = authed.post(
        "/api/v1/accounts",
        json={"name": "X", "type": "retirement", "member_id": 999},
    )
    assert resp.status_code == 404
    assert resp.json()["error"]["code"] == "member_not_found"
    resp = authed.post(
        "/api/v1/flows",
        json={"name": "X", "kind": "income", "amount_monthly": 1, "member_id": 999},
    )
    assert resp.status_code == 404


def test_member_not_found_envelope(authed):
    resp = authed.get("/api/v1/household/999")
    assert resp.status_code == 404
    assert resp.json()["error"]["code"] == "member_not_found"


# --- #7: person-data consistency rejected at write time --------------------
# Mirrors the invalid_plan_horizon simulate guard: birth_year in the future,
# or life_expectancy below current age. Error code invalid_person_data.


def test_create_future_birth_year_rejected(authed):
    resp = authed.post(
        "/api/v1/household",
        json={"name": "Timelord", "role": "partner", "birth_year": 2100,
              "life_expectancy": 90},
    )
    assert resp.status_code == 422
    assert resp.json()["error"]["code"] == "invalid_person_data"


def test_create_life_expectancy_below_current_age_rejected(authed):
    # born 1980 → current age ~46; life_expectancy 10 is degenerate.
    resp = authed.post(
        "/api/v1/household",
        json={"name": "Methuselah", "role": "partner", "birth_year": 1980,
              "life_expectancy": 10},
    )
    assert resp.status_code == 422
    assert resp.json()["error"]["code"] == "invalid_person_data"


def test_patch_future_birth_year_rejected(authed):
    self_id = _self(authed)["id"]
    resp = authed.patch(f"/api/v1/household/{self_id}", json={"birth_year": 2100})
    assert resp.status_code == 422
    assert resp.json()["error"]["code"] == "invalid_person_data"


def test_patch_life_expectancy_below_current_age_rejected(authed):
    # self born 1980; existing birth_year makes life_expectancy=5 inconsistent
    # even though only life_expectancy is sent (merged-state validation).
    self_id = _self(authed)["id"]
    resp = authed.patch(f"/api/v1/household/{self_id}", json={"life_expectancy": 5})
    assert resp.status_code == 422
    assert resp.json()["error"]["code"] == "invalid_person_data"


def test_retirement_age_below_current_age_still_accepted(authed):
    # The simulate guard only CLAMPS retirement_age (never rejects it), so
    # write-time validation must not reject it either.
    self_id = _self(authed)["id"]
    resp = authed.patch(f"/api/v1/household/{self_id}", json={"retirement_age": 18})
    assert resp.status_code == 200
    assert resp.json()["retirement_age"] == 18


def test_valid_person_writes_still_succeed(authed):
    created = authed.post(
        "/api/v1/household",
        json={"name": "Dana", "role": "partner", "birth_year": 1983,
              "life_expectancy": 94},
    )
    assert created.status_code == 201
    member_id = created.json()["id"]
    patched = authed.patch(
        f"/api/v1/household/{member_id}",
        json={"birth_year": 1985, "life_expectancy": 96},
    )
    assert patched.status_code == 200
    assert patched.json()["life_expectancy"] == 96
