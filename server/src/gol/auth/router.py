"""Auth endpoints: /auth/session, /auth/setup, /auth/login, /auth/logout."""

from __future__ import annotations

import math
from typing import Annotated

from fastapi import APIRouter, Depends, Request, Response
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session as DbSession

from gol.auth.passwords import MIN_PASSWORD_LENGTH, hash_password, verify_password
from gol.auth.sessions import (
    ABSOLUTE_TIMEOUT,
    CSRF_COOKIE,
    SESSION_COOKIE,
    create_session,
    destroy_session,
    lookup_session,
)
from gol.db import get_db
from gol.errors import ApiError
from gol.models import AuthCredential

router = APIRouter(prefix="/auth", tags=["auth"])

Db = Annotated[DbSession, Depends(get_db)]


class PasswordBody(BaseModel):
    password: str


def _credential(db: DbSession) -> AuthCredential | None:
    return db.execute(select(AuthCredential)).scalar_one_or_none()


def _client_ip(request: Request) -> str:
    return request.client.host if request.client else "unknown"


def _set_auth_cookies(request: Request, response: Response, token: str, csrf: str) -> None:
    secure = request.url.scheme == "https"
    max_age = int(ABSOLUTE_TIMEOUT.total_seconds())
    response.set_cookie(
        SESSION_COOKIE, token, max_age=max_age, httponly=True, secure=secure,
        samesite="lax", path="/",
    )
    # Double-submit companion: readable by the frontend, never trusted alone —
    # the server compares the header against the session-bound token.
    response.set_cookie(
        CSRF_COOKIE, csrf, max_age=max_age, httponly=False, secure=secure,
        samesite="lax", path="/",
    )


@router.get("/session")
def get_session(request: Request, db: Db):
    setup_required = _credential(db) is None
    session = lookup_session(db, request.cookies.get(SESSION_COOKIE))
    body: dict = {"authenticated": session is not None, "setup_required": setup_required}
    if session is not None:
        body["csrf_token"] = session.csrf_token
    return body


@router.post("/setup", status_code=204)
def setup(body: PasswordBody, db: Db):
    if _credential(db) is not None:
        raise ApiError(409, "already_setup", "a password has already been configured")
    if len(body.password) < MIN_PASSWORD_LENGTH:
        raise ApiError(
            400, "password_too_short",
            f"password must be at least {MIN_PASSWORD_LENGTH} characters",
        )
    db.add(AuthCredential(password_hash=hash_password(body.password)))
    db.flush()
    return Response(status_code=204)


@router.post("/login")
def login(body: PasswordBody, request: Request, response: Response, db: Db):
    throttle = request.app.state.login_throttle
    ip = _client_ip(request)
    wait = throttle.retry_after(ip)
    if wait > 0:
        raise ApiError(
            429, "too_many_attempts", "too many failed login attempts; try again later",
            headers={"Retry-After": str(math.ceil(wait))},
        )
    cred = _credential(db)
    if cred is None:
        raise ApiError(400, "setup_required", "no password configured yet; call /auth/setup")
    if not verify_password(cred.password_hash, body.password):
        throttle.record_failure(ip)
        raise ApiError(401, "invalid_credentials", "invalid password")
    throttle.record_success(ip)
    # Session rotation / fixation defense: never reuse a token presented at
    # login. Drop any session the incoming cookie names, then mint a fresh one.
    destroy_session(db, request.cookies.get(SESSION_COOKIE))
    token, csrf = create_session(db)
    _set_auth_cookies(request, response, token, csrf)
    return {"csrf_token": csrf}


@router.post("/logout", status_code=204)
def logout(request: Request, db: Db):
    destroy_session(db, request.cookies.get(SESSION_COOKIE))
    response = Response(status_code=204)
    response.delete_cookie(SESSION_COOKIE, path="/")
    response.delete_cookie(CSRF_COOKIE, path="/")
    return response
