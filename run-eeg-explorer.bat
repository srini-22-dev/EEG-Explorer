@echo off
rem Starts the EEG simulator and opens it in your browser (http://localhost:5173).
rem Close this window, or press Ctrl+C in it, to stop the simulator.
cd /d "%~dp0"

where pnpm >nul 2>nul
if errorlevel 1 (
  echo pnpm was not found. Install Node.js, then run:  npm install -g pnpm
  pause
  exit /b 1
)

rem Already running? Then just open it.
netstat -ano | findstr /r /c:":5173 .*LISTENING" >nul
if not errorlevel 1 (
  echo The simulator is already running. Opening it in your browser.
  start "" http://localhost:5173/
  exit /b 0
)

if not exist node_modules (
  echo Installing dependencies, first run only...
  call pnpm install
  if errorlevel 1 (
    pause
    exit /b 1
  )
)

call pnpm run dev
pause
