"""T-007 pure-function tests: gol.analytics (no ORM, no app)."""

from __future__ import annotations

import datetime as dt

from gol.analytics.categorize import categorize
from gol.analytics.freshness import compute_freshness
from gol.analytics.recurring import (
    Occurrence,
    detect_recurring,
    normalize_payee,
)
from gol.analytics.transfers import TxnRef, auto_pair, candidates, score

D = dt.date


# --- transfers ---------------------------------------------------------------


def _t(id_, acct, date, amount):
    return TxnRef(id=id_, account_id=acct, date=date, amount=amount)


def test_auto_pair_exact_cross_account_within_window():
    txns = [
        _t(1, 1, D(2026, 6, 1), -1200.0),
        _t(2, 2, D(2026, 6, 3), 1200.0),
    ]
    assert auto_pair(txns) == [(1, 2)]


def test_auto_pair_rejects_same_account_same_sign_and_wide_window():
    base = D(2026, 6, 1)
    assert auto_pair([_t(1, 1, base, -50.0), _t(2, 1, base, 50.0)]) == []  # same account
    assert auto_pair([_t(1, 1, base, -50.0), _t(2, 2, base, -50.0)]) == []  # same sign
    assert auto_pair([_t(1, 1, base, -50.0), _t(2, 2, base + dt.timedelta(days=5), 50.0)]) == []
    assert auto_pair([_t(1, 1, base, -50.0), _t(2, 2, base, 50.01)]) == []  # not exact
    assert auto_pair([_t(1, 1, base, 0.0), _t(2, 2, base, 0.0)]) == []  # zero amounts


def test_auto_pair_prefers_closest_date_then_lowest_id_deterministically():
    txns = [
        _t(10, 1, D(2026, 6, 5), -75.0),
        _t(11, 2, D(2026, 6, 8), 75.0),  # 3 days away
        _t(12, 3, D(2026, 6, 6), 75.0),  # 1 day away — wins
    ]
    assert auto_pair(txns) == [(10, 12)]
    # order of the input list must not matter
    assert auto_pair(list(reversed(txns))) == [(10, 12)]


def test_auto_pair_each_txn_used_once_oldest_first():
    txns = [
        _t(1, 1, D(2026, 6, 1), -100.0),
        _t(2, 1, D(2026, 6, 2), -100.0),
        _t(3, 2, D(2026, 6, 2), 100.0),  # single counterpart
    ]
    # oldest-first: txn 1 claims txn 3 (1 day apart) before txn 2 can
    assert auto_pair(txns) == [(1, 3)]


def test_candidates_near_miss_scored_and_exclusive():
    txns = [
        _t(1, 1, D(2026, 6, 1), -1000.0),
        _t(2, 2, D(2026, 6, 7), 1000.0),  # exact amount, 6 days: candidate
        _t(3, 3, D(2026, 6, 1), 995.0),  # 0.5% off, same day: candidate
    ]
    result = candidates(txns)
    assert len(result) == 1  # txn 1 can only appear once
    sc, a, b = result[0]
    assert (a.id, b.id) == (1, 3)  # 0.5%/0d scores 0.7 > exact/6d 0.657
    assert sc == score(a, b) == 0.7


def test_candidate_score_bounds():
    a = _t(1, 1, D(2026, 6, 1), -100.0)
    assert score(a, _t(2, 2, D(2026, 6, 1), 100.0)) == 1.0
    assert 0.0 <= score(a, _t(3, 2, D(2026, 6, 8), 101.0)) <= 1.0


def test_blocked_pairs_never_auto_pair_or_surface_as_candidates():
    """Tombstoned (user-unpaired) pairs are skipped by both matchers."""
    txns = [
        _t(1, 1, D(2026, 6, 1), -1200.0),
        _t(2, 2, D(2026, 6, 3), 1200.0),
    ]
    blocked = frozenset({(1, 2)})
    assert auto_pair(txns, blocked=blocked) == []
    assert candidates(txns, blocked=blocked) == []
    # a different counterpart is still fair game
    txns.append(_t(3, 3, D(2026, 6, 2), 1200.0))
    assert auto_pair(txns, blocked=blocked) == [(1, 3)]


def test_candidates_out_of_tolerance_excluded():
    assert candidates([
        _t(1, 1, D(2026, 6, 1), -100.0),
        _t(2, 2, D(2026, 6, 1), 102.0),  # 2% off
    ]) == []
    assert candidates([
        _t(1, 1, D(2026, 6, 1), -100.0),
        _t(2, 2, D(2026, 6, 9), 100.0),  # 8 days
    ]) == []


# --- payee normalization ------------------------------------------------------


def test_normalize_payee_strips_case_whitespace_and_trailing_ids():
    assert normalize_payee("  NETFLIX.COM   ") == "netflix.com"
    assert normalize_payee("SPOTIFY P12345678") == "spotify"
    assert normalize_payee("GREEN BASKET MARKET #442") == "green basket market"
    assert normalize_payee("SQ *COFFEE CART 0042 1234") == "sq *coffee cart"
    assert normalize_payee("7-ELEVEN 32233") == "7-eleven"  # first token survives


# --- recurring detection --------------------------------------------------------


def _monthly(payee, amounts, day=15, category=None, start=None):
    out = []
    start = start or D(2025, 1, 1)
    year, month = start.year, start.month
    for amount in amounts:
        out.append(Occurrence(date=D(year, month, day), amount=amount,
                              payee=payee, category=category))
        month += 1
        if month == 13:
            year, month = year + 1, 1
    return out


def test_detect_monthly_with_price_change():
    today = D(2026, 7, 1)
    occs = _monthly("Netflix.com", [15.49] * 15 + [17.99] * 3, category="subscriptions")
    (charge,) = detect_recurring(occs, today)
    assert charge.cadence == "monthly"
    assert charge.typical_amount == 15.49
    assert charge.last_amount == 17.99
    assert charge.price_change_pct == 16.1
    assert charge.occurrences == 18
    assert charge.active is True
    assert charge.monthly_equivalent == 17.99
    assert charge.category == "subscriptions"
    # pstdev([15.49]*15 + [17.99]*3) / median 15.49 * 100
    assert charge.amount_variability_pct == 6.0


def test_detect_weekly_and_annual_cadences_with_monthly_equivalent():
    today = D(2026, 7, 1)
    weekly = [Occurrence(D(2026, 5, 1) + dt.timedelta(days=7 * i), 12.0, "GymCo")
              for i in range(8)]
    annual = [Occurrence(D(2023 + i, 6, 10), 120.0, "DomainCo") for i in range(3)]
    charges = {c.key: c for c in detect_recurring(weekly + annual, today)}
    assert charges["gymco"].cadence == "weekly"
    assert charges["gymco"].monthly_equivalent == 52.0
    assert charges["domainco"].cadence == "annual"
    assert charges["domainco"].monthly_equivalent == 10.0


def test_detect_requires_three_occurrences_and_regular_gaps():
    today = D(2026, 7, 1)
    assert detect_recurring(_monthly("TwoTimer", [9.99] * 2), today) == []
    irregular = [Occurrence(D(2026, 1, 1), 9.99, "Chaos"),
                 Occurrence(D(2026, 1, 20), 9.99, "Chaos"),
                 Occurrence(D(2026, 3, 25), 9.99, "Chaos")]
    assert detect_recurring(irregular, today) == []


def test_detect_amount_variance_beyond_20pct_disqualifies():
    today = D(2026, 7, 1)
    occs = _monthly("Wild", [50.0, 50.0, 50.0, 80.0])  # 60% above typical
    assert detect_recurring(occs, today) == []


def test_inactive_when_last_seen_beyond_1_5x_cadence():
    occs = _monthly("Cancelled", [9.99] * 5, start=D(2025, 1, 1))  # ends 2025-05-15
    (charge,) = detect_recurring(occs, D(2026, 7, 1))
    assert charge.active is False


def test_gap_tolerance_allows_calendar_month_wobble():
    dates = [D(2026, 1, 31), D(2026, 2, 28), D(2026, 3, 31), D(2026, 4, 30)]
    occs = [Occurrence(d, 20.0, "Wobble") for d in dates]
    (charge,) = detect_recurring(occs, D(2026, 5, 15))
    assert charge.cadence == "monthly"


def test_amount_variability_zero_for_flat_charges():
    (charge,) = detect_recurring(_monthly("Flat", [9.99] * 6), D(2026, 7, 1))
    assert charge.amount_variability_pct == 0.0


# --- heuristic categorizer -----------------------------------------------------


def test_categorize_brands_and_generics():
    assert categorize("NETFLIX.COM 866-579-7172") == ("subscriptions", 0.9)
    assert categorize("TRADER JOE'S #553") == ("groceries", 0.9)
    assert categorize("Corner Market") == ("groceries", 0.6)
    assert categorize("City Power & Water") == ("utilities", 0.6)
    assert categorize("Some Unknown Payee") is None
    assert categorize("") is None


def test_categorize_word_boundaries_avoid_false_hits():
    assert categorize("COFFEE HOUSE") == ("dining", 0.6)  # "coffee", not "fee"
    assert categorize("PINTEREST ADS") is None  # not "interest"
    assert categorize("QUICKFUEL") is None  # "fuel" embedded in a word


def test_categorize_interest_fees_and_card_extras():
    assert categorize("PURCHASE INTEREST CHARGE") == ("interest-fees", 0.9)
    assert categorize("ANNUAL FEE") == ("interest-fees", 0.9)
    # plain "interest" only counts on card accounts
    assert categorize("INTEREST 06/26") is None
    assert categorize("INTEREST 06/26", account_type="credit_card") == ("interest-fees", 0.8)
    assert categorize("LATE FEE", account_type="credit_card") == ("interest-fees", 0.8)


# --- freshness -----------------------------------------------------------------


def test_freshness_states():
    today = D(2026, 7, 11)
    ts = dt.datetime(2026, 7, 1, 12, 0)
    assert compute_freshness(False, ts, None, None, today) == ("off", None)
    assert compute_freshness(True, None, None, None, today) == ("never", None)
    assert compute_freshness(True, ts, None, None, today) == ("fresh", 10)
    aging = dt.datetime(2026, 6, 11)  # 30 days: past 2/3 of 35
    assert compute_freshness(True, aging, None, None, today) == ("aging", 30)
    stale = dt.datetime(2026, 6, 1)  # 40 days
    assert compute_freshness(True, stale, None, None, today) == ("stale", 40)


def test_freshness_threshold_override_and_txn_fallback():
    today = D(2026, 7, 11)
    ten_ago = dt.datetime(2026, 7, 1)
    # override threshold 7: 10 days out is stale
    assert compute_freshness(True, ten_ago, None, 7, today) == ("stale", 10)
    # no imports, but transactions exist -> newest txn date is the reference
    assert compute_freshness(True, None, D(2026, 7, 9), None, today) == ("fresh", 2)
    # boundary: exactly threshold days is aging, not stale
    at_threshold = dt.datetime(2026, 6, 6)  # 35 days
    assert compute_freshness(True, at_threshold, None, None, today) == ("aging", 35)
