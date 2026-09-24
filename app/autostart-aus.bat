@echo off
setlocal
rem autostart-aus.bat - entfernt die Verknuepfung becauseyoulovejira.lnk aus dem Autostart-Ordner.
"%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File "%~dp0byl-control.ps1" -Action AutostartOff
set "BYL_EXIT=%ERRORLEVEL%"
pause
exit /b %BYL_EXIT%
