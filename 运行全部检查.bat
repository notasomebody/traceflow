@echo off
setlocal
set "ROOT=%~dp0"
set "JAVA_HOME=C:\Program Files\Microsoft\jdk-21.0.12.8-hotspot"
set "PATH=%JAVA_HOME%\bin;%PATH%"

cd /d "%ROOT%backend"
call mvnw.cmd test
if errorlevel 1 exit /b %errorlevel%

cd /d "%ROOT%frontend"
call npm.cmd run build
if errorlevel 1 exit /b %errorlevel%
call npm.cmd run lint
if errorlevel 1 exit /b %errorlevel%

echo.
echo 全部检查通过。
pause
