"""Import-freshness computation (docs/API.md v1.2).

States: "off" (track_freshness false), "never" (no imports AND no
transactions), then by days since the last import (falling back to the
newest transaction date when the account has transactions that never came
through an import — e.g. seeded data): fresh < 2/3·threshold ≤ aging ≤
threshold < stale. Threshold = staleness_days override or 35.
"""

from __future__ import annotations

import datetime as dt

DEFAULT_STALENESS_DAYS = 35


def compute_freshness(
    track_freshness: bool,
    last_import_at: dt.datetime | None,
    newest_transaction_date: dt.date | None,
    staleness_days: int | None,
    today: dt.date,
) -> tuple[str, int | None]:
    """Return (freshness, days_since_import). days is None for off/never."""
    if not track_freshness:
        return ("off", None)
    reference = last_import_at.date() if last_import_at else newest_transaction_date
    if reference is None:
        return ("never", None)
    days = max(0, (today - reference).days)
    threshold = staleness_days if staleness_days is not None else DEFAULT_STALENESS_DAYS
    if days > threshold:
        return ("stale", days)
    if 3 * days >= 2 * threshold:
        return ("aging", days)
    return ("fresh", days)
