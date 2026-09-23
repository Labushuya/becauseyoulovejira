@echo off
setlocal enabledelayedexpansion

REM stop.bat - Beendet den PocketBase-Prozess

set SCRIPT_DIR=%~dp0
set POCKETBASE_EXE=%SCRIPT_DIR%pocketbase.exe

REM Gehe zum Script-Verzeichnis
cd /d "%SCRIPT_DIR%"

REM Finde und beende alle pocketbase.exe Prozesse, die von diesem Verzeichnis aus gestartet wurden
for /f "tokens=2" %%a in ('wmic process list brief /format:csv 2^>nul ^| findstr /R /C:"pocketbase\.exe"') do (
    REM Prüfe, ob der Prozess vom aktuellen Verzeichnis aus läuft
    for /f "tokens=*" %%b in ('wmic process where processid=%%a get executablepath 2^>nul ^| findstr /R /C:"pocketbase"') do (
        if "%%b"=="%POCKETBASE_EXE%" (
            echo Beende PocketBase (PID: %%a)...
            taskkill /PID %%a /F >nul 2>&1
        )
    )
)

REM Alternative: taskkill by name (könnte andere Instanzen treffen)
taskkill /IM pocketbase.exe /F >nul 2>&1

echo PocketBase wurde beendet.
