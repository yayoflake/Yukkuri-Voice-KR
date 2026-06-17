@echo off
cd /d "%~dp0"
title Yukkuri Voice (KR)
echo.
echo  Starting Yukkuri Voice server...
echo  Your browser will open automatically. Close this window to stop.
echo.
where node >nul 2>nul
if errorlevel 1 (
  echo  [ERROR] Node.js is required. Install from https://nodejs.org
  echo.
  pause
  exit /b 1
)
node serve.mjs
if errorlevel 1 (
  echo.
  echo  Server stopped with an error.
  pause
)
