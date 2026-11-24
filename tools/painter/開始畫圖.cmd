@echo off
title Onion Painter
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Please install Node.js first: https://nodejs.org/
  pause
  exit /b 1
)
if not exist node_modules\qrcode-terminal (
  echo Installing, please wait...
  call npm install --no-audit --no-fund
  if errorlevel 1 (
    pause
    exit /b 1
  )
)
node painter.mjs %*
pause
