@echo off
chcp 65001 >nul
title Free After Effects MCP
node "%~dp0install.mjs" --uninstall %*
echo.
pause
