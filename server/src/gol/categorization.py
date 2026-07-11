"""Layered categorization service (DECISIONS 2026-07-11 #3):
manual > rules > heuristics > ai. Rules apply priority asc (then id asc),
first match wins; matching is case-insensitive on the transaction payee.

File-supplied categories (a user-mapped CSV category column) are recorded as
category_source="manual": the user chose that mapping deliberately, and rules
must never clobber manual data.
"""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from gol.analytics.categorize import categorize as heuristic_categorize
from gol.models import CategoryRule, Transaction

# Sources that retroactive rule application may overwrite (docs/API.md:
# "uncategorized + rule/heuristic-sourced ... never overwrites manual").
OVERWRITABLE_SOURCES = ("none", "rule", "heuristic")


def load_rules(db: Session) -> list[CategoryRule]:
    return list(
        db.execute(
            select(CategoryRule).order_by(CategoryRule.priority, CategoryRule.id)
        ).scalars()
    )


def rule_matches(rule: CategoryRule, payee: str) -> bool:
    text = payee.strip().lower()
    pattern = rule.pattern.strip().lower()
    if not pattern:
        return False
    if rule.match == "exact":
        return text == pattern
    return pattern in text


def first_matching_rule(rules: list[CategoryRule], payee: str) -> CategoryRule | None:
    return next((r for r in rules if rule_matches(r, payee)), None)


def categorize_new_transaction(
    txn: Transaction, rules: list[CategoryRule], account_type: str, file_category: str | None
) -> None:
    """Set category + category_source on a freshly imported transaction."""
    if file_category is not None:
        txn.category, txn.category_source = file_category, "manual"
        return
    rule = first_matching_rule(rules, txn.payee)
    if rule is not None:
        txn.category, txn.category_source = rule.category, "rule"
        return
    hit = heuristic_categorize(txn.payee, account_type)
    if hit is not None:
        txn.category, txn.category_source = hit[0], "heuristic"
        return
    txn.category, txn.category_source = None, "none"


def apply_rules_retroactively(db: Session) -> int:
    """POST /rules/apply — re-run rules over every non-manual, non-ai
    transaction; returns how many rows actually changed. Rows whose rule was
    deleted keep their current category (rules add, they don't garbage-collect).
    """
    rules = load_rules(db)
    changed = 0
    rows = db.execute(
        select(Transaction).where(Transaction.category_source.in_(OVERWRITABLE_SOURCES))
    ).scalars()
    for txn in rows:
        rule = first_matching_rule(rules, txn.payee)
        if rule is None:
            continue
        if txn.category != rule.category or txn.category_source != "rule":
            txn.category, txn.category_source = rule.category, "rule"
            changed += 1
    return changed
