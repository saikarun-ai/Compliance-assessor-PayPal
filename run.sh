#!/usr/bin/env sh
# ---------------------------------------------------------------------------
# Compliance Assessor - one-command start (bash: Git Bash, WSL, Linux, macOS)
#   ./run.sh            start llama.cpp + the web app
#   ./run.sh rules-only skip the model and classify with the RBI rules alone
#   NO_BROWSER=1 ./run.sh   do not open a browser
# ---------------------------------------------------------------------------
set -eu
cd "$(dirname "$0")"

RULES_ONLY=0
for arg in "$@"; do
  case "$arg" in
    rules-only) RULES_ONLY=1 ;;
    *) echo "unknown option: $arg" >&2; exit 2 ;;
  esac
done

echo
echo " Compliance Assessor"
echo " ==================="
echo

if [ ! -d node_modules/express ]; then
  echo "[setup] dependencies missing - running npm install"
  npm install --silent
fi

PORT=$(node --env-file-if-exists=.env -p "process.env.PORT||3000")
LLAMA_URL=$(node --env-file-if-exists=.env -p "process.env.LLAMA_SERVER_URL||'http://127.0.0.1:8081'")

stop_llama() {
  echo
  echo "[stop] shutting down"
  pkill -f 'llama-server' 2>/dev/null || true
  pkill -f 'llama\.cpp' 2>/dev/null || true
  echo "[stop] done"
}
trap stop_llama EXIT INT TERM

if [ "$RULES_ONLY" -eq 0 ]; then
  echo "[1/3] starting local inference - llama.cpp on $LLAMA_URL"
  npm run --silent llama -- --detach || echo "[warn] llama.cpp did not launch - continuing rules-only"
  echo "[2/3] loading the model"
  node scripts/wait-for.js "$LLAMA_URL/health" 180 "llama.cpp"
else
  echo "[1/3] rules-only mode - skipping the model"
fi

echo "[3/3] starting the web app on http://localhost:$PORT"
echo
if [ "${NO_BROWSER:-0}" != "1" ]; then
  (command -v xdg-open >/dev/null 2>&1 && xdg-open "http://localhost:$PORT" >/dev/null 2>&1) || \
  (command -v open >/dev/null 2>&1 && open "http://localhost:$PORT" >/dev/null 2>&1) || true
fi

npm start