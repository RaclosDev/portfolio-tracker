@echo off
setlocal
REM Instala Watchlist en este PC con un doble clic. No hace falta instalar nada antes:
REM descarga su propio Node.js (portatil, sin permisos de administrador), copia el
REM programa, instala lo necesario y crea el acceso directo. Una vez en cada PC.
REM Despues la app se actualiza sola desde GitHub al abrirse.
cd /d "%~dp0"
title Instalar Watchlist

set "NODE_VERSION=24.16.0"
if not defined WATCHLIST_HOME set "WATCHLIST_HOME=%LOCALAPPDATA%\Watchlist"
set "NODE_DIR=%WATCHLIST_HOME%\node"

echo.
echo  ==============================
echo   Instalando Watchlist
echo  ==============================

if exist "%NODE_DIR%\node.exe" goto :node_ok

echo.
echo  Descargando Node.js %NODE_VERSION% (solo la primera vez, unos 35 MB)...
set "ARCH=x64"
if /i "%PROCESSOR_ARCHITECTURE%"=="ARM64" set "ARCH=arm64"
set "NODE_PKG=node-v%NODE_VERSION%-win-%ARCH%"
set "NODE_ZIP=%TEMP%\%NODE_PKG%.zip"
if not exist "%WATCHLIST_HOME%" mkdir "%WATCHLIST_HOME%"
"%SystemRoot%\System32\curl.exe" -L --fail --progress-bar -o "%NODE_ZIP%" "https://nodejs.org/dist/v%NODE_VERSION%/%NODE_PKG%.zip"
if errorlevel 1 goto :no_internet
"%SystemRoot%\System32\tar.exe" -xf "%NODE_ZIP%" -C "%WATCHLIST_HOME%"
if errorlevel 1 goto :error
if exist "%NODE_DIR%" rmdir /s /q "%NODE_DIR%"
move "%WATCHLIST_HOME%\%NODE_PKG%" "%NODE_DIR%" >nul
if errorlevel 1 goto :error
del "%NODE_ZIP%" >nul 2>nul

:node_ok
set "PATH=%NODE_DIR%;%PATH%"
"%NODE_DIR%\node.exe" "%~dp0apps\desktop\launch\install.mjs"
if errorlevel 1 goto :error
pause
exit /b 0

:no_internet
echo.
echo  No se pudo descargar. Comprueba la conexion a internet y vuelve a ejecutar instalar.bat.
goto :fail

:error
echo.
echo  Algo ha fallado. Revisa los mensajes de arriba.

:fail
echo.
pause
exit /b 1
