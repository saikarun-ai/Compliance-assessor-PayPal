@echo off
rem ---------------------------------------------------------------------------
rem Readiness probe: llama.cpp, PayPal Sandbox and the Agent Reach channels.
rem ---------------------------------------------------------------------------
setlocal
cd /d "%~dp0"
call npm run --silent health
exit /b 0