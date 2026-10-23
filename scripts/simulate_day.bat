@echo off
rem Fallback scheduler for Windows Task Scheduler (see docs/recruiting/runbook.md).
rem Reads DATABASE_URL from .env at the repo root; appends output to logs\simulate_day.log
rem (*.log is git-ignored).
cd /d "%~dp0.."
if not exist logs mkdir logs
echo ==== %DATE% %TIME% >> logs\simulate_day.log
".venv\Scripts\python.exe" scripts\simulate_day.py >> logs\simulate_day.log 2>&1
exit /b %ERRORLEVEL%
