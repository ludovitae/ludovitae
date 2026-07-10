"""Alembic environment; url comes from config (set programmatically) or GOL config."""

from __future__ import annotations

from alembic import context
from sqlalchemy import create_engine

from gol import config as gol_config
from gol.db import Base
from gol.models import *  # noqa: F401,F403 — register all tables on Base.metadata

target_metadata = Base.metadata


def _url() -> str:
    return context.config.get_main_option("sqlalchemy.url") or gol_config.db_url()


def run_migrations_offline() -> None:
    context.configure(url=_url(), target_metadata=target_metadata, literal_binds=True)
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    engine = create_engine(_url())
    with engine.connect() as connection:
        context.configure(
            connection=connection,
            target_metadata=target_metadata,
            render_as_batch=True,
        )
        with context.begin_transaction():
            context.run_migrations()
    engine.dispose()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
