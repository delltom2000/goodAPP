@echo off
setlocal
cd /d "%~dp0"
set "PYTHONUTF8=1"
set "PYTHONDONTWRITEBYTECODE=1"
echo Xread Web - opening http://127.0.0.1:8765/
echo Keep this window open while using Xread. Press Ctrl+C to stop.
"%~dp0runtime\python.exe" -B -X utf8 "%~dp0server.py" --open
if errorlevel 1 pause
