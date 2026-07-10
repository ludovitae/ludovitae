"""SQLAlchemy engine/session plumbing.

The engine is created lazily against the configured data dir so tests can
point GOL_DATA_DIR at a temp directory before the app starts.
"""

from __future__ import annotations

from collections.abc import Iterator
from decimal import ROUND_HALF_UP, Decimal

from sqlalchemy import Integer, create_engine, event
from sqlalchemy.engine import Engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker
from sqlalchemy.types import TypeDecorator

from gol import config


class Base(DeclarativeBase):
    pass


class Money(TypeDecorator):
    """Dollars in the API, integer cents in the database (lossless)."""

    impl = Integer
    cache_ok = True

    def process_bind_param(self, value, dialect):
        if value is None:
            return None
        cents = (Decimal(str(value)) * 100).quantize(Decimal("1"), rounding=ROUND_HALF_UP)
        return int(cents)

    def process_result_value(self, value, dialect):
        if value is None:
            return None
        return value / 100.0


_engine: Engine | None = None
_engine_url: str | None = None
_sessionmaker: sessionmaker[Session] | None = None


def get_engine() -> Engine:
    global _engine, _engine_url, _sessionmaker
    url = config.db_url()
    if _engine is None or _engine_url != url:
        _engine = create_engine(url, connect_args={"check_same_thread": False})
        _engine_url = url

        @event.listens_for(_engine, "connect")
        def _set_sqlite_pragma(dbapi_connection, connection_record):
            cursor = dbapi_connection.cursor()
            cursor.execute("PRAGMA foreign_keys=ON")
            cursor.close()

        _sessionmaker = sessionmaker(bind=_engine, expire_on_commit=False)
    return _engine


def reset_engine() -> None:
    """Dispose the cached engine (used by tests when GOL_DATA_DIR changes)."""
    global _engine, _engine_url, _sessionmaker
    if _engine is not None:
        _engine.dispose()
    _engine = None
    _engine_url = None
    _sessionmaker = None


def session_factory() -> sessionmaker[Session]:
    get_engine()
    assert _sessionmaker is not None
    return _sessionmaker


def get_db() -> Iterator[Session]:
    db = session_factory()()
    try:
        yield db
        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


def run_migrations() -> None:
    """Apply alembic migrations up to head against the configured database."""
    from alembic import command
    from alembic.config import Config as AlembicConfig

    cfg = AlembicConfig()
    cfg.set_main_option("script_location", "gol:migrations")
    cfg.set_main_option("sqlalchemy.url", config.db_url())
    command.upgrade(cfg, "head")
