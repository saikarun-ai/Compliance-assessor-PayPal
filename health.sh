#!/usr/bin/env sh
# ---------------------------------------------------------------------------
# Readiness probe: llama.cpp, PayPal Sandbox and the Agent Reach channels.
# ---------------------------------------------------------------------------
set -eu
cd "$(dirname "$0")"
npm run --silent health