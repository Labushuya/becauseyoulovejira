@echo off
setlocal
rem autostart-aus.bat - entfernt die Verknuepfung becauseyoulovejira.lnk aus dem Autostart-Ordner.
"%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File "%~dp0byl-control.ps1" autostart-off
set "BYL_EXIT=%ERRORLEVEL%"
if not "%BYL_EXIT%"=="0" call "%~dp0byl-pruefen.bat" %BYL_EXIT%
pause
exit /b %BYL_EXIT%
