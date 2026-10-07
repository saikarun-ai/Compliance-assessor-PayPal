@echo off
rem ---------------------------------------------------------------------------
rem Full verification: RBI rules, PayPal invoice path, then the live end-to-end
rem suite. Expect a few minutes - the last stage loads the model.
rem ---------------------------------------------------------------------------
setlocal
cd /d "%~dp0"

echo.
echo  Compliance Assessor - test suite
echo  ==============================
echo.

echo [1/3] RBI classification rules
call npm run --silent verify || exit /b 1

echo [2/3] PayPal invoice path (mock Sandbox)
call npm run --silent verify:invoice || exit /b 1

echo [3/3] end-to-end with the live model
call npm run --silent e2e || exit /b 1

echo.
echo [done] all suites passed
exit /b 0