@echo off
setlocal

set STARTUP_DIR=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup
set SHORTCUT_PATH=%STARTUP_DIR%\becauseyoulovejira.lnk

if exist "%SHORTCUT_PATH%" (
    del "%SHORTCUT_PATH%" >nul 2>&1
    if %ERRORLEVEL% equ 0 (
        echo Autostart deaktiviert.
    ) else (
        echo Fehler beim L?schen.
        pause
        exit /b 1
    )
) else (
    echo Autostart ist nicht aktiviert.
)
