#!/bin/sh
# Python tests, Ruff and the TypeScript/Vite build (macOS/Linux).
# --browser also runs the Playwright scenarios; they expect the API on :8000 and Vite on :5173.
# Uses .venv/bin/python when present, otherwise python3; override with PYTHON=...
set -eu
cd "$(dirname "$0")/../.."

if [ -z "${PYTHON:-}" ]; then
  if [ -x .venv/bin/python ]; then PYTHON=.venv/bin/python; else PYTHON=python3; fi
fi

"$PYTHON" -X utf8 -m pytest -q
"$PYTHON" -X utf8 -m ruff check services tests scripts
npm run build

if [ "${1:-}" = "--browser" ]; then
  npm run test:ui
fi

echo "All requested checks passed."
