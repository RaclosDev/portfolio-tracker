@echo off
REM Instala la Watchlist en este PC y crea el acceso directo "Watchlist".
REM Hazlo una vez en cada PC. Despues la app se actualiza sola desde GitHub al abrirse.
cd /d "%~dp0"
title Instalar Watchlist

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo  Falta Node.js. Instala la version LTS desde https://nodejs.org
  echo  y vuelve a ejecutar este fichero.
  echo.
  pause
  exit /b 1
)

node "%~dp0apps\desktop\launch\install.mjs" || goto :error
pause
exit /b 0

:error
echo.
echo  Algo ha fallado. Revisa los mensajes de arriba.
echo.
pause
exit /b 1
