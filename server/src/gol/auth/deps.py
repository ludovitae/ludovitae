"""FastAPI dependencies for authentication."""

from __future__ import annotations

from typing import Annotated

from fastapi import Depends, Request
from sqlalchemy.orm import Session as DbSession

from gol.auth.sessions import SESSION_COOKIE, lookup_session
from gol.db import get_db
from gol.errors import ApiError
from gol.models import AuthSession


def require_auth(
    request: Request, db: Annotated[DbSession, Depends(get_db)]
) -> AuthSession:
    session = lookup_session(db, request.cookies.get(SESSION_COOKIE))
    if session is None:
        raise ApiError(401, "unauthenticated", "authentication required")
    return session


Authenticated = Annotated[AuthSession, Depends(require_auth)]
