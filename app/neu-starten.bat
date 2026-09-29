@echo off
setlocal
rem neu-starten.bat - startet becauseyoulovejira nur neu, wenn es noetig ist: nach einem Update mit
rem neuer Migration oder Server-Logik, nach einer neuen oder geaenderten BYL_-Variable oder einem
rem neuen Mail-Hilfsprozess; antwortet die App nicht, ebenfalls. Sonst meldet es "kein Neustart
rem noetig" (nur die Oberflaeche neu gebaut: F5 im offenen Tab). Laeuft die App nicht, startet es
rem sie. Logik: byl-control.ps1 reload (mit -Force: immer neu starten).
rem Die Meldung bleibt 5 Sekunden stehen (Taste beendet sofort), bei Fehlern bis zu einem Tastendruck.
"%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File "%~dp0byl-control.ps1" reload
set "BYL_EXIT=%ERRORLEVEL%"
if "%BYL_EXIT%"=="0" (timeout /t 5 2>nul) else (pause)
exit /b %BYL_EXIT%
