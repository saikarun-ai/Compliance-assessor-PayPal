#!/usr/bin/env sh
# ---------------------------------------------------------------------------
# Stop every Compliance Assessor process: the web app and llama.cpp.
# Safe to run at any time; it is a no-op when nothing is running.
# ---------------------------------------------------------------------------
set -eu
cd "$(dirname "$0")"

PORT=$(node --env-file-if-exists=.env -p "process.env.PORT||3000")

echo "[stop] stopping the web app on port $PORT"
# Only kill a listener, never a random node process from another project.
if command -v lsof >/dev/null 2>&1; then
  lsof -ti tcp:"$PORT" 2>/dev/null | xargs -r kill 2>/dev/null || true
fi

echo "[stop] stopping llama.cpp"
pkill -f 'llama-server' 2>/dev/null || true
pkill -f 'llama\.cpp' 2>/dev/null || true

echo "[stop] done"