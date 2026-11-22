@echo off
setlocal
if not exist "%~dp0runtime\pythonw.exe" (
    echo Extract the entire Xread package before launching.
    pause
    exit /b 1
)
if not exist "%~dp0launch.py" (
    echo Extract the entire Xread package before launching.
    pause
    exit /b 1
)
start "" "%~dp0runtime\pythonw.exe" -B -X utf8 "%~dp0launch.py"
