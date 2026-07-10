"""FastAPI app factory. `uvicorn gol.main:app` serves the API on localhost."""

from __future__ import annotations

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


@asynccontextmanager
async def _lifespan(app: FastAPI):
    run_migrations()
    yield


def create_app() -> FastAPI:
    app = FastAPI(title="Game of Life API", lifespan=_lifespan, docs_url=None, redoc_url=None)
    app.state.login_throttle = LoginThrottle()

    install_error_handlers(app)
    app.add_middleware(CsrfMiddleware)
    app.add_middleware(BodyLimitMiddleware)
    app.add_middleware(SecurityHeadersMiddleware)

    from gol.api import (
        accounts,
        dashboard,
        flows,
        goals,
        importer,
        profile,
        scenarios,
        settings,
        simulate,
        transactions,
    )

    prefix = "/api/v1"
    app.include_router(auth_router, prefix=prefix)
    for module in (
        profile, accounts, flows, goals, transactions,
        scenarios, simulate, dashboard, settings, importer,
    ):
        app.include_router(module.router, prefix=prefix)

    _mount_spa(app)
    return app


def _mount_spa(app: FastAPI) -> None:
    """Serve the built frontend (web/dist) with an SPA fallback to index.html.

    Registered after the API routers, so /api/v1 always wins. No-op when the
    frontend hasn't been built (dev setups use the Vite proxy instead).
    """
    dist = Path(os.environ.get("GOL_WEB_DIST", _DEFAULT_DIST)).resolve()
    index = dist / "index.html"
    if not index.is_file():
        return

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
