@echo off
setlocal
rem start.bat - startet becauseyoulovejira (PocketBase ohne sichtbares Fenster), wartet auf
rem /api/health und oeffnet den Browser, ausser die App ist schon in einem Tab offen (dort erscheint
rem dann ein Hinweis). Beim Erststart oeffnet PocketBase die Einrichtung selbst; dann erscheint nur
rem ein Hinweis. Die Logik steht in byl-control.ps1.
"%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File "%~dp0byl-control.ps1" -Action Start
set "BYL_EXIT=%ERRORLEVEL%"
if not "%BYL_EXIT%"=="0" pause
exit /b %BYL_EXIT%
