@echo off
chcp 65001 >nul
title DeepSeek Harness Phone Remote - One-Click Deploy
echo ============================================
echo   DeepSeek Harness Phone Remote 一键部署
echo ============================================
echo.
echo 建议:如果读取 Tailscale IP 或配置 Serve 失败,
echo 请右键本文件选择"以管理员身份运行"。
echo.
echo NOTE: A normal double-click is RECOMMENDED. Running this file as
echo administrator installs into the ADMIN account profile (paths under
echo the admin USERPROFILE), so the harness, its data and the desktop
echo shortcut end up in that account instead of yours. Use "Run as
echo administrator" ONLY when the Tailscale CLI pipe check below fails.
echo.
pause
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install.ps1"
if errorlevel 1 (
  echo.
  echo [失败] 部署未完成。请保留本窗口中的错误信息，不要把上面的步骤当作安装成功。
  pause
  exit /b 1
)
echo.
echo [成功] 部署和在线验活均已通过。
pause
