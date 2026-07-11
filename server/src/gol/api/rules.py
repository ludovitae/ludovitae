"""Category rules CRUD + retroactive apply, and the heuristics-only
/categorize/suggest stub (v1.2 — the Claude-backed version lands behind the
same endpoint later and must respect the AI budget)."""

from __future__ import annotations

from fastapi import APIRouter, Response
from pydantic import BaseModel, Field

from gol.analytics.categorize import categorize as heuristic_categorize
from gol.api.common import Db, get_or_404
from gol.auth.deps import Authenticated
from gol.categorization import apply_rules_retroactively, load_rules
from gol.errors import ApiError
from gol.models import RULE_FIELDS, RULE_MATCHES, CategoryRule

router = APIRouter(tags=["rules"])


class RuleCreate(BaseModel):
    pattern: str = Field(min_length=1, max_length=300)
    match: str = "contains"
    field: str = "payee"
    category: str = Field(min_length=1, max_length=100)
    priority: int = 100


class RulePatch(BaseModel):
    pattern: str | None = Field(default=None, min_length=1, max_length=300)
    match: str | None = None
    field: str | None = None
    category: str | None = Field(default=None, min_length=1, max_length=100)
    priority: int | None = None


def _validate_enums(match: str | None, field: str | None) -> None:
    if match is not None and match not in RULE_MATCHES:
        raise ApiError(422, "validation_error", f"match must be one of {', '.join(RULE_MATCHES)}")
    if field is not None and field not in RULE_FIELDS:
        raise ApiError(422, "validation_error", f"field must be one of {', '.join(RULE_FIELDS)}")


def _serialize(rule: CategoryRule) -> dict:
    return {
        "id": rule.id,
        "pattern": rule.pattern,
        "match": rule.match,
        "field": rule.field,
        "category": rule.category,
        "priority": rule.priority,
    }


@router.get("/rules")
def list_rules(db: Db, _: Authenticated):
    return [_serialize(r) for r in load_rules(db)]


@router.post("/rules", status_code=201)
def create_rule(body: RuleCreate, db: Db, _: Authenticated):
    _validate_enums(body.match, body.field)
    rule = CategoryRule(**body.model_dump())
    db.add(rule)
    db.flush()
    return _serialize(rule)


@router.patch("/rules/{rule_id}")
def patch_rule(rule_id: int, body: RulePatch, db: Db, _: Authenticated):
    rule = get_or_404(db, CategoryRule, rule_id, "rule_not_found")
    data = body.model_dump(exclude_unset=True)
    _validate_enums(data.get("match"), data.get("field"))
    for key, value in data.items():
        setattr(rule, key, value)
    db.flush()
    return _serialize(rule)


@router.delete("/rules/{rule_id}", status_code=204)
def delete_rule(rule_id: int, db: Db, _: Authenticated):
    rule = get_or_404(db, CategoryRule, rule_id, "rule_not_found")
    db.delete(rule)
    db.flush()
    return Response(status_code=204)


@router.post("/rules/apply")
def apply_rules(db: Db, _: Authenticated):
    changed = apply_rules_retroactively(db)
    db.flush()
    return {"recategorized": changed}


class SuggestBody(BaseModel):
    payees: list[str] = Field(min_length=1, max_length=500)


@router.post("/categorize/suggest")
def categorize_suggest(body: SuggestBody, _: Authenticated):
    """Heuristics only (AI stub, DECISIONS 2026-07-11 #3). Unmatched payees
    come back with category null / confidence 0 so the response is positional
    with the request. No AI call happens; the ledger is untouched."""
    suggestions = []
    for payee in body.payees:
        hit = heuristic_categorize(payee)
        suggestions.append({
            "payee": payee,
            "category": hit[0] if hit else None,
            "confidence": hit[1] if hit else 0.0,
        })
    return {"suggestions": suggestions, "source": "heuristic"}
