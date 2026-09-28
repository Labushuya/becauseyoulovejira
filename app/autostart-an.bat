@echo off
setlocal
rem autostart-an.bat - legt die Verknuepfung becauseyoulovejira.lnk im Windows-Autostart-Ordner an.
rem Ziel: wscript.exe mit start-hidden.vbs (Start ohne Fenster). Logik in byl-control.ps1.
"%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File "%~dp0byl-control.ps1" autostart-on
set "BYL_EXIT=%ERRORLEVEL%"
pause
exit /b %BYL_EXIT%
