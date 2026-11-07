@echo off
REM Instala Watchlist en este PC con un doble clic. No hace falta instalar nada antes:
REM pregunta donde instalar, descarga lo necesario y crea los accesos directos.
REM Despues la app se actualiza sola desde GitHub al abrirse.
title Instalar Watchlist
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0instalar.ps1"
if errorlevel 1 (
  echo.
  echo  Algo ha fallado. Revisa los mensajes de arriba.
)
echo.
pause
