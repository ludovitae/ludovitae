"""FastAPI app factory. `uvicorn gol.main:app` serves the API on localhost."""

from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI

from gol.auth.middleware import CsrfMiddleware, SecurityHeadersMiddleware
from gol.auth.router import router as auth_router
from gol.auth.throttle import LoginThrottle
from gol.db import run_migrations
from gol.errors import install_error_handlers


@asynccontextmanager
async def _lifespan(app: FastAPI):
    run_migrations()
    yield


def create_app() -> FastAPI:
    app = FastAPI(title="Game of Life API", lifespan=_lifespan, docs_url=None, redoc_url=None)
    app.state.login_throttle = LoginThrottle()

    install_error_handlers(app)
    app.add_middleware(CsrfMiddleware)
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
    return app


app = create_app()
