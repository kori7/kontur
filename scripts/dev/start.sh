#!/bin/sh
# Start the API on 127.0.0.1:8000 and serve the built frontend (macOS/Linux).
# --dev skips the frontend build; run `npm run dev` in another terminal for 127.0.0.1:5173.
# Uses .venv/bin/python when present, otherwise python3; override with PYTHON=...
set -eu
cd "$(dirname "$0")/../.."

if [ -z "${PYTHON:-}" ]; then
  if [ -x .venv/bin/python ]; then PYTHON=.venv/bin/python; else PYTHON=python3; fi
fi

if [ "${1:-}" = "--dev" ]; then
  echo "API: http://127.0.0.1:8000. Run npm run dev in another terminal for http://127.0.0.1:5173."
elif [ ! -f apps/web/dist/index.html ]; then
  npm run build
fi

exec "$PYTHON" -X utf8 -m uvicorn app.main:create_app --factory --app-dir services/api \
  --host 127.0.0.1 --port 8000
