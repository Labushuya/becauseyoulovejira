@echo off
setlocal
rem status.bat - zeigt, ob becauseyoulovejira laeuft, unter welcher Adresse, ob der
rem Mail-Hilfsprozess laeuft und ob ein Neustart noetig ist (dann neu-starten.bat). Aendert nichts.
rem Logik: byl-control.ps1 status. Das Fenster bleibt bis zu einem Tastendruck offen.
"%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File "%~dp0byl-control.ps1" status
set "BYL_EXIT=%ERRORLEVEL%"
if not "%BYL_EXIT%"=="0" call "%~dp0byl-pruefen.bat" %BYL_EXIT%
pause
exit /b %BYL_EXIT%
