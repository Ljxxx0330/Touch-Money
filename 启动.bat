@echo off
rem TouchMoney launcher - double-click this file.
rem Starts a local static server (tools\serve.cjs) if one is not already running,
rem then opens http://127.0.0.1:4173/ in your default browser.
rem You can close this window after the browser opens; the server keeps running.
rem To stop the server later:  node tools\open.cjs --stop
chcp 65001 >nul
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo [TouchMoney] Node.js not found in PATH.
  echo Install Node.js, or open a terminal in this folder and run:  node tools\serve.cjs
  echo then visit  http://127.0.0.1:4173/
  pause
  exit /b 1
)
node tools\open.cjs
if errorlevel 1 pause
endlocal
