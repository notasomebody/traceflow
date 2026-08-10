@echo off
echo 即将安装 Tauri Windows 构建所需的 Visual Studio C++ Build Tools。
echo Windows 弹出权限确认时请选择“是”。
echo.
winget install --id Microsoft.VisualStudio.2022.BuildTools --exact --accept-package-agreements --accept-source-agreements --override "--wait --passive --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended --norestart"
echo.
echo 安装结束后建议重新启动电脑，再运行“运行全部检查.bat”。
pause
