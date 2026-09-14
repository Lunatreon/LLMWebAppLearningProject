@echo off
setlocal
cd /d "%~dp0"
title FeelY
if not exist ".venv\Scripts\python.exe" (
  echo Missing .venv. Follow the first-time setup in README.md.
  pause
  exit /b 1
)
".venv\Scripts\python.exe" "scripts\start_feely.py" %*
if errorlevel 1 pause
