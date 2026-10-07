@echo off
rem ---------------------------------------------------------------------------
rem Compliance Assessor - one-command start (Windows Command Prompt)
rem   run.bat            start llama.cpp + the web app
rem   run.bat rules-only skip the model and classify with the RBI rules alone
rem   run.bat no-browser do not open a browser window
rem ---------------------------------------------------------------------------
setlocal enabledelayedexpansion
cd /d "%~dp0"

set "RULES_ONLY=0"
set "OPEN_BROWSER=1"
:parse
if "%~1"=="" goto parsed
if /i "%~1"=="rules-only" set "RULES_ONLY=1"
if /i "%~1"=="no-browser" set "OPEN_BROWSER=0"
shift
goto parse
:parsed

echo.
echo  Compliance Assessor
echo  ===================
echo.

if not exist "node_modules\express" (
  echo [setup] dependencies missing - running npm install
  call npm install --silent
  if errorlevel 1 (
    echo [fail] npm install failed
    exit /b 1
  )
)

for /f %%p in ('node --env-file-if-exists=.env -p "process.env.PORT||3000"') do set "PORT=%%p"
for /f %%l in ('node --env-file-if-exists=.env -p "process.env.LLAMA_SERVER_URL||'http://127.0.0.1:8081'"') do set "LLAMA_URL=%%l"

if "%RULES_ONLY%"=="0" (
  echo [1/3] starting local inference - llama.cpp on %LLAMA_URL%
  call npm run --silent llama -- --detach
  if errorlevel 1 echo [warn] llama.cpp did not launch - continuing rules-only
  echo [2/3] loading the model
  node scripts\wait-for.js "%LLAMA_URL%/health" 180 "llama.cpp"
) else (
  echo [1/3] rules-only mode - skipping the model
)

echo [3/3] starting the web app on http://localhost:%PORT%
echo.
if "%OPEN_BROWSER%"=="1" start "" "http://localhost:%PORT%"

call npm start

echo.
echo [stop] shutting down
taskkill /IM llama.exe /T /F >nul 2>&1
taskkill /IM llama-server.exe /T /F >nul 2>&1
echo [stop] done
exit /b 0