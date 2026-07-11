"""T-010: GET /export — full-fidelity JSON export of the database.

One schema-versioned document with every ORM table (alembic internals
excluded). ai_settings is included but its api_key is always exported as
null — the secret must never leave the server, even in the owner's own
export. Money columns serialize as dollars (float), matching the API
convention, because rows are read through the ORM's Money type.

Restore in this phase is file-level, not import: stop the server and replace
data/gol.db with a backup (README "Backups & restore"). POST /import/restore
is deferred.
"""

from __future__ import annotations

import datetime as dt
import json
from collections.abc import Iterator
from typing import Any

from fastapi import APIRouter
from fastapi.responses import StreamingResponse
from sqlalchemy import select
from sqlalchemy.orm import Mapper

from gol.api.common import Db
from gol.auth.deps import Authenticated
from gol.db import Base

router = APIRouter(tags=["export"])

EXPORT_FORMAT = "gol-export"
# columns whose *values* are secrets: exported as null, never the real value
REDACTED_COLUMNS = {("ai_settings", "api_key")}


def _mappers_by_table() -> dict[str, Mapper]:
    return dict(
        sorted(
            (mapper.persist_selectable.name, mapper)
            for mapper in Base.registry.mappers
        )
    )


def _dump_rows(db, table_name: str, mapper: Mapper) -> list[dict[str, Any]]:
    model = mapper.class_
    pk = mapper.primary_key[0]
    rows = db.execute(select(model).order_by(pk)).scalars().all()
    out = []
    for row in rows:
        record = {
            attr.key: None
            if (table_name, attr.key) in REDACTED_COLUMNS
            else getattr(row, attr.key)
            for attr in mapper.column_attrs
        }
        out.append(record)
    return out


def _json_default(value: Any) -> str:
    if isinstance(value, dt.datetime | dt.date):
        return value.isoformat()
    raise TypeError(f"not JSON serializable: {type(value).__name__}")


def _stream(head: str, exported_at: str, tables: dict[str, list]) -> Iterator[str]:
    """Encode the document one table at a time (bounded encoding memory).

    Rows are already materialized — the DB session closes before FastAPI
    consumes a StreamingResponse body, so nothing here may touch the ORM.
    """
    yield (
        "{"
        f'"format": {json.dumps(EXPORT_FORMAT)}, '
        f'"schema_version": {json.dumps(head)}, '
        f'"exported_at": {json.dumps(exported_at)}, '
        '"tables": {'
    )
    for i, (name, rows) in enumerate(tables.items()):
        prefix = ", " if i else ""
        yield f"{prefix}{json.dumps(name)}: {json.dumps(rows, default=_json_default)}"
    yield "}}"


@router.get("/export")
def export_database(db: Db, _: Authenticated) -> StreamingResponse:
    from gol.backup import _head_revision

    exported_at = dt.datetime.now(dt.UTC).strftime("%Y-%m-%dT%H:%M:%SZ")
    tables = {
        name: _dump_rows(db, name, mapper)
        for name, mapper in _mappers_by_table().items()
    }
    filename = f"gol-export-{exported_at[:10]}.json"
    return StreamingResponse(
        _stream(_head_revision(), exported_at, tables),
        media_type="application/json",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
