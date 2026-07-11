"""FastAPI app factory. `uvicorn gol.main:app` serves the API on localhost."""

from __future__ import annotations

import asyncio
import contextlib
import os
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.responses import FileResponse

from gol.auth.middleware import (
    BodyLimitMiddleware,
    CsrfMiddleware,
    SecurityHeadersMiddleware,
)
from gol.auth.router import router as auth_router
from gol.auth.throttle import LoginThrottle
from gol.db import run_migrations
from gol.errors import ApiError, install_error_handlers

# repo_root/web/dist, overridable for tests/packaging
_DEFAULT_DIST = Path(__file__).resolve().parents[3] / "web" / "dist"
# Built SPA bundled into the wheel (#13); populated by the build step in README.
_PACKAGED_DIST = Path(__file__).resolve().parent / "_webdist"


async def _snapshot_loop() -> None:
    """T-010: daily DB snapshot — once at startup, then every 24h.

    safe_daily_snapshot never raises, so this task can only end by
    cancellation at shutdown.
    """
    from gol.backup import safe_daily_snapshot

    while True:
        await asyncio.to_thread(safe_daily_snapshot)
        await asyncio.sleep(24 * 60 * 60)


@asynccontextmanager
async def _lifespan(app: FastAPI):
    run_migrations()
    snapshots = asyncio.create_task(_snapshot_loop())
    try:
        yield
    finally:
        snapshots.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await snapshots


def create_app() -> FastAPI:
    app = FastAPI(title="Game of Life API", lifespan=_lifespan, docs_url=None, redoc_url=None)
    app.state.login_throttle = LoginThrottle()

    install_error_handlers(app)
    app.add_middleware(CsrfMiddleware)
    app.add_middleware(BodyLimitMiddleware)
    app.add_middleware(SecurityHeadersMiddleware)

    from gol.api import (
        accounts,
        ai_admin,
        dashboard,
        export,
        flows,
        goals,
        household,
        importer,
        profile,
        rules,
        scenarios,
        settings,
        simulate,
        spending,
        spending_analytics,
        transactions,
        transfers,
    )

    prefix = "/api/v1"
    app.include_router(auth_router, prefix=prefix)
    for module in (
        profile, household, spending, spending_analytics, accounts, flows,
        goals, transactions, transfers, rules, scenarios, simulate, dashboard,
        settings, ai_admin, importer, export,
    ):
        app.include_router(module.router, prefix=prefix)

    _mount_spa(app)
    return app


def _resolve_dist() -> Path | None:
    """Locate the built SPA (#13). Search order: the GOL_WEB_DIST override, the
    repo's web/dist (source checkout), then gol/_webdist bundled into the wheel.

    GOL_WEB_DIST is authoritative when set — it is used exclusively (an explicit
    override should not silently fall through to a different build), so a set but
    missing path yields API-only mode. Only when it is UNSET do we fall back to
    web/dist and then the packaged bundle. Returns the first directory that has
    an index.html, else None.
    """
    env = os.environ.get("GOL_WEB_DIST")
    candidates = [Path(env)] if env else [_DEFAULT_DIST, _PACKAGED_DIST]
    for candidate in candidates:
        resolved = candidate.resolve()
        if (resolved / "index.html").is_file():
            return resolved
    return None


def _mount_spa(app: FastAPI) -> None:
    """Serve the built frontend (web/dist) with an SPA fallback to index.html.

    Registered after the API routers, so /api/v1 always wins. No-op when the
    frontend hasn't been built (dev setups use the Vite proxy instead) —
    API-only mode.
    """
    dist = _resolve_dist()
    if dist is None:
        return
    index = dist / "index.html"

    @app.get("/{path:path}", include_in_schema=False)
    async def spa(path: str) -> FileResponse:
        # Unknown API paths must 404 as JSON, not fall through to index.html
        # (a client would otherwise try to parse HTML as an API response).
        if path == "api" or path.startswith("api/"):
            raise ApiError(404, "not_found", "no such API route")
        candidate = (dist / path).resolve() if path else index
        if candidate.is_file() and candidate.is_relative_to(dist):
            return FileResponse(candidate)
        return FileResponse(index)


app = create_app()
