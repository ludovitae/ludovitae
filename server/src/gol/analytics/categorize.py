"""Heuristic payee categorizer (v1.2). AI categorization is stubbed —
`/categorize/suggest` runs exactly this table (docs/API.md, DECISIONS 3).

Matching is word-boundary based on the lowercased payee (so "coffee" never
trips the "fee" pattern and "pinterest" never trips "interest"). First match
wins, table order = precedence: interest/fee patterns come first because
they are the most specific and matter most on card imports.
"""

from __future__ import annotations

import re
from functools import lru_cache

# (category, confidence, patterns). Brand names carry higher confidence than
# generic words. Multi-word patterns match as phrases.
KEYWORD_TABLE: tuple[tuple[str, float, tuple[str, ...]], ...] = (
    ("interest-fees", 0.9, (
        "interest charge", "purchase interest", "finance charge", "late fee",
        "annual fee", "service fee", "atm fee", "overdraft", "cash advance fee",
        "membership fee", "foreign transaction fee",
    )),
    ("groceries", 0.9, (
        "kroger", "safeway", "aldi", "trader joe", "whole foods", "wegmans",
        "publix", "heb", "costco", "sams club", "instacart",
    )),
    ("groceries", 0.6, ("grocery", "groceries", "supermarket", "market")),
    ("dining", 0.9, (
        "starbucks", "chipotle", "mcdonald", "doordash", "grubhub", "ubereats",
        "dunkin", "panera", "wendys", "subway",
    )),
    ("dining", 0.6, (
        "restaurant", "cafe", "coffee", "pizza", "taqueria", "sushi", "burger",
        "grill", "diner", "bakery", "bistro", "taco", "brewery", "pub",
    )),
    ("fuel", 0.9, (
        "shell", "chevron", "exxon", "mobil", "sunoco", "speedway", "valero",
        "marathon petro", "circle k",
    )),
    ("fuel", 0.6, ("fuel", "gas station", "gasoline")),
    ("utilities", 0.9, (
        "comcast", "xfinity", "verizon", "t-mobile", "at&t", "centurylink",
        "spectrum",
    )),
    ("utilities", 0.6, (
        "electric", "power", "water", "sewer", "utility", "utilities", "energy",
        "internet", "wireless", "gas co", "gas company",
    )),
    ("subscriptions", 0.9, (
        "netflix", "spotify", "hulu", "disney plus", "disney+", "hbo", "max.com",
        "youtube premium", "audible", "patreon", "substack", "icloud", "dropbox",
        "github", "apple.com/bill", "amazon prime", "paramount", "peacock",
        "kindle unlimited", "nyt", "new york times",
    )),
    ("subscriptions", 0.6, ("subscription", "membership", "monthly plan")),
    ("insurance", 0.9, ("geico", "allstate", "state farm", "progressive ins")),
    ("insurance", 0.6, ("insurance",)),
    ("health", 0.9, ("cvs", "walgreens", "rite aid")),
    ("health", 0.6, ("pharmacy", "clinic", "dental", "medical", "urgent care")),
    ("transport", 0.9, ("uber", "lyft")),
    ("transport", 0.6, ("parking", "toll", "transit", "metro", "rideshare")),
    ("travel", 0.9, (
        "airbnb", "marriott", "hilton", "delta air", "united airlines",
        "southwest air", "expedia", "vrbo",
    )),
    ("travel", 0.6, ("airline", "airlines", "hotel", "resort", "airways")),
    ("entertainment", 0.9, ("steam games", "steampowered", "playstation", "nintendo", "xbox")),
    ("entertainment", 0.6, ("cinema", "theater", "theatre", "arcade")),
)

# On credit-card imports plain "interest"/"fee" words are unambiguous
# (DECISIONS 1: card interest/fees are real spending, auto-categorized).
CARD_EXTRA_PATTERNS: tuple[str, ...] = ("interest", "fee", "fees")
CARD_ACCOUNT_TYPES = ("credit_card",)


@lru_cache(maxsize=1024)
def _pattern_re(pattern: str) -> re.Pattern[str]:
    return re.compile(rf"(?<![a-z0-9]){re.escape(pattern)}(?![a-z0-9])")


def categorize(payee: str, account_type: str | None = None) -> tuple[str, float] | None:
    """Return (category, confidence) for a payee, or None if nothing matches."""
    text = " ".join(payee.lower().split())
    if not text:
        return None
    if account_type in CARD_ACCOUNT_TYPES and any(
        _pattern_re(p).search(text) for p in CARD_EXTRA_PATTERNS
    ):
        return ("interest-fees", 0.8)
    for category, confidence, patterns in KEYWORD_TABLE:
        if any(_pattern_re(p).search(text) for p in patterns):
            return (category, confidence)
    return None
