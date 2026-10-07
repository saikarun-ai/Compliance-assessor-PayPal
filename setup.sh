#!/usr/bin/env sh
# ---------------------------------------------------------------------------
# First-time setup: Node check, dependencies, .env, model and llama binaries.
# Read-only apart from npm install - it never edits your .env.
# ---------------------------------------------------------------------------
set -eu
cd "$(dirname "$0")"

echo
echo " Compliance Assessor - setup"
echo " ========================"
echo

if ! command -v node >/dev/null 2>&1; then
  echo "[fail] Node.js not found. Install Node 20.6 or newer: https://nodejs.org"
  exit 1
fi
echo "[ok]   node $(node -v)"
echo "[ok]   npm  $(npm -v)"

if [ ! -d node_modules/express ]; then
  echo "[run]  npm install"
  npm install
else
  echo "[ok]   dependencies already installed"
fi

if [ -f .env ]; then
  echo "[ok]   .env present"
else
  echo "[warn] .env missing - copying .env.example"
  cp .env.example .env
fi

echo "[info] configuration"
node scripts/setup-check.js || {
  echo
  echo "[warn] some optional pieces are missing - the app still runs, degraded."
  echo "[info] see README.md for what each missing piece disables."
}

echo
echo "[done] start the app with:  ./run.sh"