@echo off
setlocal
rem start.bat - startet becauseyoulovejira (PocketBase ohne sichtbares Fenster), wartet auf
rem /api/health und oeffnet den Browser, ausser die App ist schon in einem Tab offen (dort erscheint
rem dann ein Hinweis). Laeuft die App schon, startet nichts doppelt. Beim Erststart oeffnet
rem PocketBase die Einrichtung selbst; dann erscheint nur ein Hinweis. Logik: byl-control.ps1 start.
"%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File "%~dp0byl-control.ps1" start
set "BYL_EXIT=%ERRORLEVEL%"
if not "%BYL_EXIT%"=="0" pause
exit /b %BYL_EXIT%
