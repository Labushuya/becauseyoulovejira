@echo off
setlocal
rem admin-zuruecksetzen.bat - legt ein Admin-Konto (PocketBase-Superuser) an oder setzt sein
rem Passwort neu, ohne Tickets oder App-Konten zu aendern. Funktioniert auch, waehrend die App
rem laeuft. Fragt E-Mail und Passwort ab; Logik: byl-control.ps1 reset-admin.
"%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File "%~dp0byl-control.ps1" reset-admin
set "BYL_EXIT=%ERRORLEVEL%"
pause
exit /b %BYL_EXIT%
