@echo off
rem Double-click to start libby-shelf. Installs what is missing, then opens the app in your browser.
cd /d "%~dp0"
where node >/dev/null 2>nul
if errorlevel 1 (
  echo libby-shelf needs Node.js. The download page opens now.
  echo Install Node.js, then double-click this file again.
  start "" https://nodejs.org/
  pause
  exit /b 1
)
if not exist node_modules call npm ci || goto failed
if not exist ui\node_modules call npm ci --prefix ui || goto failed
call npm run live || goto failed
exit /b 0
:failed
echo libby-shelf could not start. Read the message above.
pause
exit /b 1
