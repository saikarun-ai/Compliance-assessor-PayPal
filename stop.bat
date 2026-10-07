@echo off
rem ---------------------------------------------------------------------------
rem Stop every Compliance Assessor process: the web app and llama.cpp.
rem Safe to run at any time; it is a no-op when nothing is running.
rem ---------------------------------------------------------------------------
setlocal
cd /d "%~dp0"

echo [stop] stopping the web app on port 3000
for /f "tokens=5" %%p in ('netstat -ano ^| findstr "LISTENING" ^| findstr ":3000 "') do (
  taskkill /pid %%p /T /F >nul 2>&1 && echo [stop] killed pid %%p
)

echo [stop] stopping llama.cpp
taskkill /IM llama.exe /T /F >nul 2>&1
taskkill /IM llama-server.exe /T /F >nul 2>&1

echo [stop] done
exit /b 0