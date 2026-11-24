@echo off
chcp 65001 >nul
title JOSEPP - Servidor de turnos
cd /d "%~dp0"
set "NODE_EXE="
for %%I in (node.exe) do if not "%%~$PATH:I"=="" set "NODE_EXE=%%~$PATH:I"
if not defined NODE_EXE if exist "%ProgramFiles%\nodejs\node.exe" set "NODE_EXE=%ProgramFiles%\nodejs\node.exe"
if not defined NODE_EXE if exist "%ProgramFiles(x86)%\nodejs\node.exe" set "NODE_EXE=%ProgramFiles(x86)%\nodejs\node.exe"
if not defined NODE_EXE if exist "%LOCALAPPDATA%\Programs\nodejs\node.exe" set "NODE_EXE=%LOCALAPPDATA%\Programs\nodejs\node.exe"
if not defined NODE_EXE if exist "%~dp0runtime\node.exe" set "NODE_EXE=%~dp0runtime\node.exe"
if not defined NODE_EXE (
  echo.
  echo No se encontró Node.js ni el runtime portátil del servidor.
  echo Verifica que exista la carpeta runtime junto a este archivo.
  echo.
  pause
  exit /b 1
)
echo Usando Node.js: "%NODE_EXE%"
set "SALON_OPEN_BROWSER=1"
"%NODE_EXE%" server.mjs
echo.
if errorlevel 1 (
  echo Revisa el mensaje anterior. Si el puerto esta en uso, el servidor ya funciona en otra ventana.
) else (
  echo El servidor se detuvo.
)
pause
