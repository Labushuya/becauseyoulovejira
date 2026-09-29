@echo off
setlocal
rem stop.bat - beendet geordnet nur die eigene Instanz dieses Ordners: erst den eigenen
rem Mail-Hilfsprozess (byl-mail.exe aus diesem Ordner), dann PocketBase (pocketbase.exe aus diesem
rem Ordner mit serve und --dir auf pb_data). Offene Tabs der App bekommen vorher den Hinweis
rem "wurde beendet". Logik: byl-control.ps1 stop.
rem Die Meldung bleibt 5 Sekunden stehen (Taste beendet sofort), bei Fehlern bis zu einem Tastendruck.
"%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File "%~dp0byl-control.ps1" stop
set "BYL_EXIT=%ERRORLEVEL%"
if "%BYL_EXIT%"=="0" (timeout /t 5 2>nul) else (pause)
exit /b %BYL_EXIT%
