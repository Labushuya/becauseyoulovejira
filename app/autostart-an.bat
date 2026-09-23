@echo off
setlocal

set SCRIPT_DIR=%~dp0
set START_HIDDEN_VBS=%SCRIPT_DIR%start-hidden.vbs
set STARTUP_DIR=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup
set SHORTCUT_PATH=%STARTUP_DIR%\becauseyoulovejira.lnk

if not exist "%START_HIDDEN_VBS%" (
    echo Fehler: start-hidden.vbs nicht gefunden
    pause
    exit /b 1
)

powershell -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT_DIR%autostart-create.ps1" "%SHORTCUT_PATH%" "%START_HIDDEN_VBS%" "%SCRIPT_DIR%"

if %ERRORLEVEL% equ 0 (
    echo Autostart aktiviert.
    exit /b 0
) else (
    echo Fehler.
    pause
    exit /b 1
)
