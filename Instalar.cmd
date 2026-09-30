@echo off
chcp 65001 >nul
title After Effects MCP - Instalador
echo.
where node >nul 2>nul
if errorlevel 1 (
  echo Necesitas Node.js para instalar esto.
  set /p RESP="Quieres que lo instale ahora con winget? (S/N): "
  if /i "%RESP%"=="S" (
    winget install OpenJS.NodeJS.LTS
    echo.
    echo Listo. Cierra esta ventana y vuelve a hacer doble clic en Instalar.cmd.
  ) else (
    echo Instalalo desde https://nodejs.org y vuelve a intentar.
  )
  echo.
  pause
  exit /b 1
)
node "%~dp0install.mjs"
echo.
pause
