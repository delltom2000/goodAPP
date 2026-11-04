@echo off
cd /d "%~dp0"
echo Jianjin IELTS: http://localhost:4173
python -m http.server 4173 --bind 127.0.0.1 --directory dist
