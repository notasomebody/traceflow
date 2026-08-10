@echo off
setlocal
set "ROOT=%~dp0"
set "JAVA_HOME=C:\Program Files\Microsoft\jdk-21.0.12.8-hotspot"
set "PATH=%JAVA_HOME%\bin;%PATH%"

start "TraceFlow Backend" /min cmd /c "cd /d "%ROOT%backend" && mvnw.cmd spring-boot:run"
start "TraceFlow Frontend" /min cmd /c "cd /d "%ROOT%frontend" && npm.cmd run dev -- --host 127.0.0.1 --port 1420"

echo.
echo 迹汇开发版正在启动：
echo http://127.0.0.1:1420
echo.
pause
