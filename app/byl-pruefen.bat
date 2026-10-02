@echo off
setlocal
rem byl-pruefen.bat - von den anderen .bat-Dateien aufgerufen, wenn byl-control.ps1 nicht mit 0
rem endet (ADR-0048). Die Exit-Codes 2 bis 6 und eine 1 nach einer eigenen Meldung kommen vom
rem Skript selbst. Ob PowerShell das Skript ueberhaupt ausfuehren kann (Richtlinie, fehlende oder
rem beschaedigte Datei), zeigt ein Aufruf von "help"; geht der nicht, steht hier, was zu tun ist:
rem der Eintrag script-blocked des Fehlerkatalogs byl-problems.ps1 in ASCII (gleich dem Katalog,
rem tests/unit/script-problems.test.mjs). Ohne Argument (Doppelklick) prueft es nur.
set "BYL_CODE=%~1"
for %%c in (2 3 4 5 6) do if "%BYL_CODE%"=="%%c" exit /b 0
"%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File "%~dp0byl-control.ps1" help >nul 2>&1
if "%ERRORLEVEL%"=="0" goto laeuft
rem Der Ordner nur verzoegert erweitert: ein & oder ^ im Pfad bleibt Text, statt Befehl zu werden;
rem BYL_DIRQ verdoppelt ' fuer die Zeichenkette in einfachen Anfuehrungszeichen von PowerShell.
set "BYL_DIR=%~dp0"
setlocal EnableDelayedExpansion
set "BYL_DIRQ=!BYL_DIR:'=''!"
echo.
echo X Problem:   byl-control.ps1 konnte nicht ausgefuehrt werden.
echo              Ordner: !BYL_DIR!
echo   Ursache:   Eine Richtlinie fuer PowerShell-Skripte blockiert es, oder Dateien im Ordner app fehlen
echo              oder sind beschaedigt.
echo   So geht's: 1. Pruefen, ob byl-control.ps1, byl-functions.ps1 und byl-problems.ps1 im Ordner app
echo                 liegen.
echo              2. Stammt der Ordner aus einem Download (ZIP): die Dateien entsperren (Befehl unten).
echo              3. Die Richtlinie anzeigen: powershell -NoProfile -Command Get-ExecutionPolicy -List.
echo                 Steht bei MachinePolicy oder UserPolicy etwas anderes als Undefined, legt eine
echo                 Richtlinie fest, dass Skripte nicht laufen; dann bei ihrem Verwalter um Freigabe
echo                 bitten.
echo              Befehl zum Kopieren:
echo                powershell -NoProfile -Command "Get-ChildItem -LiteralPath '!BYL_DIRQ!' | Unblock-File"
if "%BYL_CODE%"=="" pause
exit /b 1
:laeuft
if not "%BYL_CODE%"=="" exit /b 0
echo PowerShell kann byl-control.ps1 ausfuehren; die .bat-Dateien in diesem Ordner funktionieren.
pause
exit /b 0
