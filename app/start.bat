@echo off
setlocal

REM start.bat - Startet PocketBase und oeffnet Browser

set SCRIPT_DIR=%~dp0
set POCKETBASE_EXE=%SCRIPT_DIR%pocketbase.exe
set BROWSER_URL=http://127.0.0.1:8090

if not exist "%POCKETBASE_EXE%" (
    echo Fehler: pocketbase.exe nicht gefunden
    echo Bitte fuehren Sie scripts\fetch-pocketbase.ps1 aus
    pause
    exit /b 1
)

REM Pruefe, ob Port bereits verwendet wird
netstat -ano 2>nul | findstr "127.0.0.1:8090" >nul
if %ERRORLEVEL% equ 0 (
    echo Port 8090 ist bereits in Gebrauch - oeffne Browser
    start "" "%BROWSER_URL%"
    exit /b 0
)

REM Starte PocketBase im Hintergrund
echo Starte PocketBase...
cscript.exe //nologo "%SCRIPT_DIR%start-hidden.vbs"

REM Warte auf Hochfahren (4 Sekunden sollten reichen)
echo Warte auf Initialisierung...
timeout /t 4 /nobreak

REM Oeffne Browser
echo Oeffne Browser auf %BROWSER_URL%...
start "" "%BROWSER_URL%"

exit /b 0
