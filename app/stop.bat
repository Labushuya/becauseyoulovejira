@echo off
setlocal
rem stop.bat - beendet nur die eigene PocketBase-Instanz dieses Ordners (pocketbase.exe aus diesem
rem Ordner mit serve, --http=127.0.0.1:8090 und --dir auf pb_data) und den eigenen Mail-Hilfsprozess
rem (byl-mail.exe aus diesem Ordner mit run und --url=http://127.0.0.1:8090). Logik in byl-control.ps1.
rem Die Meldung bleibt 5 Sekunden stehen (Taste beendet sofort), bei Fehlern bis zu einem Tastendruck.
"%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File "%~dp0byl-control.ps1" -Action Stop
set "BYL_EXIT=%ERRORLEVEL%"
if "%BYL_EXIT%"=="0" (timeout /t 5 2>nul) else (pause)
exit /b %BYL_EXIT%
