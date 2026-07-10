"""Configuration: data directory resolution and derived paths.

GOL_DATA_DIR overrides the data directory; the default is ``<repo root>/data``
(repo root found by walking up from the current working directory looking for
``.git``), falling back to ``./data``. The directory is created with mode 0700.
"""

from __future__ import annotations

import os
from pathlib import Path


def _find_repo_root(start: Path) -> Path | None:
    cur = start.resolve()
    for candidate in (cur, *cur.parents):
        if (candidate / ".git").exists():
            return candidate
    return None


def data_dir() -> Path:
    env = os.environ.get("GOL_DATA_DIR")
    if env:
        path = Path(env)
    else:
        root = _find_repo_root(Path.cwd())
        path = (root / "data") if root else (Path.cwd() / "data")
    path.mkdir(mode=0o700, parents=True, exist_ok=True)
    return path


def db_path() -> Path:
    return data_dir() / "gol.db"


def db_url() -> str:
    return f"sqlite:///{db_path()}"


def tls_dir() -> Path:
    path = data_dir() / "tls"
    path.mkdir(mode=0o700, parents=True, exist_ok=True)
    return path
