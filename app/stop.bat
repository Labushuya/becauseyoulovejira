@echo off
setlocal
rem stop.bat - beendet nur die eigene PocketBase-Instanz dieses Ordners (pocketbase.exe aus diesem
rem Ordner mit serve, --http=127.0.0.1:8090 und --dir auf pb_data). Logik in byl-control.ps1.
"%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File "%~dp0byl-control.ps1" -Action Stop
set "BYL_EXIT=%ERRORLEVEL%"
if not "%BYL_EXIT%"=="0" pause
exit /b %BYL_EXIT%
