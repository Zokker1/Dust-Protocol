@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Install Node.js first, then run start.bat again.
  pause
  exit /b 1
)
if not exist "node_modules\ws\package.json" (
  call npm.cmd ci --omit=dev
  if errorlevel 1 (
    pause
    exit /b 1
  )
)
node server.mjs
pause
