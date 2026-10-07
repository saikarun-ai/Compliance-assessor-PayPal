@echo off
rem ---------------------------------------------------------------------------
rem First-time setup: Node check, dependencies, .env, model and llama binaries.
rem Read-only apart from npm install - it never edits your .env.
rem ---------------------------------------------------------------------------
setlocal
cd /d "%~dp0"

echo.
echo  Compliance Assessor - setup
echo  ========================
echo.

where node >nul 2>&1 || (
  echo [fail] Node.js not found. Install Node 20.6 or newer: https://nodejs.org
  exit /b 1
)
for /f "tokens=*" %%v in ('node -v') do echo [ok]   node %%v
for /f "tokens=*" %%v in ('npm -v') do echo [ok]   npm  %%v

if not exist "node_modules\express" (
  echo [run]  npm install
  call npm install
  if errorlevel 1 ( echo [fail] npm install failed & exit /b 1 )
) else (
  echo [ok]   dependencies already installed
)

if exist ".env" ( echo [ok]   .env present ) else (
  echo [warn] .env missing - copying .env.example
  copy /y ".env.example" ".env" >nul
)

echo [info] configuration
node scripts\setup-check.js
set "SETUP_CODE=%ERRORLEVEL%"
echo.

if not "%SETUP_CODE%"=="0" (
  echo [warn] some optional pieces are missing - the app still runs, degraded.
  echo [info] see README.md for what each missing piece disables.
)
echo [done] start the app with:  run.bat
exit /b 0