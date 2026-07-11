#!/usr/bin/env bash
# Build the ludovitae wheel with the web UI bundled inside it (#13).
#
# Builds the SPA, copies it into server/src/gol/_webdist/ (gitignored, force-
# included into the wheel by hatchling), then builds the wheel. The resulting
# wheel serves the UI out of the box — `gol-serve` needs no separate frontend
# and GOL_WEB_DIST is not required (it still overrides when set).
#
# Usage: scripts/build-wheel.sh   (run from the repo root)
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
webdist="$repo_root/server/src/gol/_webdist"

echo "==> Building web UI"
cd "$repo_root/web"
npm ci
npm run build

echo "==> Staging web/dist into server/src/gol/_webdist"
rm -rf "$webdist"
cp -r "$repo_root/web/dist" "$webdist"

echo "==> Building wheel"
cd "$repo_root/server"
uv build

echo "==> Done. Wheel(s) in server/dist/:"
ls -1 "$repo_root/server/dist/"*.whl
