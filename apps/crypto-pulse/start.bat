@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo.
echo   ============================================
echo    币市脉搏 · 本地服务启动中
echo   ============================================
echo    市场脉搏 : http://127.0.0.1:8420/index.html
echo    新币雷达 : http://127.0.0.1:8420/newcoins.html
echo.
echo    两个页面顶部可互相切换，自选库共用
echo    按 Ctrl+C 停止服务
echo   ============================================
echo.
start "" http://127.0.0.1:8420/index.html
where python >nul 2>nul
if %errorlevel%==0 (
  python -m http.server 8420 --bind 127.0.0.1
) else (
  py -m http.server 8420 --bind 127.0.0.1
)
pause
