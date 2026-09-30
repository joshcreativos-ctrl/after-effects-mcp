@echo off
chcp 65001 >nul
title After Effects MCP - Desinstalador
node "%~dp0install.mjs" --uninstall
echo.
pause
