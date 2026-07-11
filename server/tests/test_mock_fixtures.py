"""Drift guard for the web mock's real-engine golden fixtures (#8).

`server/scripts/gen_mock_fixtures.py` generates
`web/src/api/mock/fixtures/sim-fixtures.json` from the pinned engine. This test
regenerates in-memory and asserts the committed file is byte-identical — so any
engine behavior/version change makes CI fail until the fixtures are regenerated
and committed (the counterpart to the web-side engine_version guard).
"""

from __future__ import annotations

import importlib.util
from pathlib import Path

import pytest

_SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "gen_mock_fixtures.py"


def _load_generator():
    spec = importlib.util.spec_from_file_location("gen_mock_fixtures", _SCRIPT)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@pytest.fixture(scope="module")
def gen():
    return _load_generator()


def test_committed_fixtures_are_a_clean_regeneration(gen):
    """Regenerating the fixtures is a no-op vs the committed file."""
    committed = gen.FIXTURES_PATH
    assert committed.exists(), (
        f"{committed} is missing — run `uv run python scripts/gen_mock_fixtures.py`"
    )
    regenerated = gen.serialize(gen.build_fixtures())
    if committed.read_text(encoding="utf-8") != regenerated:
        raise AssertionError(
            "mock sim fixtures are stale — regenerate with "
            "`cd server && uv run python scripts/gen_mock_fixtures.py` and commit "
            "web/src/api/mock/fixtures/sim-fixtures.json"
        )


def test_generator_smoke(gen):
    """The generator's own structural checks pass (also runs under `uv run`)."""
    doc = gen.build_fixtures()
    gen._smoke_test(doc)
    from gol import ENGINE_VERSION

    assert doc["engine_version"] == ENGINE_VERSION
    assert doc["seed"] == 42 and doc["n_paths"] == 1000
