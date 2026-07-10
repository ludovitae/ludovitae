"""Server-side sessions: 256-bit random tokens, stored hashed (sha256).

Idle timeout 7 days, absolute lifetime 30 days (ARCHITECTURE.md).
"""

from __future__ import annotations

import datetime as dt
import hashlib
import secrets

from sqlalchemy import delete, select
from sqlalchemy.orm import Session as DbSession

from gol.models import AuthSession, utcnow

SESSION_COOKIE = "gol_session"
CSRF_COOKIE = "gol_csrf"
CSRF_HEADER = "X-CSRF-Token"
IDLE_TIMEOUT = dt.timedelta(days=7)
ABSOLUTE_TIMEOUT = dt.timedelta(days=30)


def _hash_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def create_session(db: DbSession) -> tuple[str, str]:
    """Create a session; returns (raw_token, csrf_token)."""
    token = secrets.token_urlsafe(32)  # 256 bits
    csrf = secrets.token_urlsafe(32)
    db.add(AuthSession(token_hash=_hash_token(token), csrf_token=csrf))
    db.flush()
    return token, csrf


def lookup_session(db: DbSession, raw_token: str | None) -> AuthSession | None:
    """Validate a raw cookie token; returns the live session or None."""
    if not raw_token:
        return None
    row = db.execute(
        select(AuthSession).where(AuthSession.token_hash == _hash_token(raw_token))
    ).scalar_one_or_none()
    if row is None:
        return None
    now = utcnow()
    if now - row.created_at > ABSOLUTE_TIMEOUT or now - row.last_seen_at > IDLE_TIMEOUT:
        db.delete(row)
        db.flush()
        return None
    row.last_seen_at = now
    db.flush()
    return row


def destroy_session(db: DbSession, raw_token: str | None) -> None:
    if not raw_token:
        return
    db.execute(delete(AuthSession).where(AuthSession.token_hash == _hash_token(raw_token)))
    db.flush()
