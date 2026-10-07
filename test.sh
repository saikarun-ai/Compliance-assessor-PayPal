#!/usr/bin/env sh
# ---------------------------------------------------------------------------
# Full verification: RBI rules, PayPal invoice path, then the live end-to-end
# suite. Expect a few minutes - the last stage loads the model.
# ---------------------------------------------------------------------------
set -eu
cd "$(dirname "$0")"

echo
echo " Compliance Assessor - test suite"
echo " =============================="
echo

echo "[1/3] RBI classification rules"
npm run --silent verify

echo "[2/3] PayPal invoice path (mock Sandbox)"
npm run --silent verify:invoice

echo "[3/3] end-to-end with the live model"
npm run --silent e2e

echo
echo "[done] all suites passed"