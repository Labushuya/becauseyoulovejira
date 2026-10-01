@echo off
setlocal
rem wiederherstellen.bat - stellt eine Sicherung wieder her (ADR-0046): Liste der Sicherungen im
rem Ordner app und im Zielverzeichnis oder der volle Pfad einer Sicherung (neuer Rechner),
rem Passphrase, Pruefung, Rueckfrage, Sicherheitskopie der jetzigen Daten, Start; startet die App
rem mit der Sicherung nicht, gilt wieder der alte Stand. Logik: byl-control.ps1 restore.
"%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File "%~dp0byl-control.ps1" restore
set "BYL_EXIT=%ERRORLEVEL%"
pause
exit /b %BYL_EXIT%
