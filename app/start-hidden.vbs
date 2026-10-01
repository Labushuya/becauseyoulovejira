' start-hidden.vbs - startet becauseyoulovejira ohne sichtbares Fenster (Ziel der Autostart-
' Verknuepfung). Ruft byl-control.ps1 start -Hidden auf: Hinweise und Fehler erscheinen
' dann als Meldungsfenster, bei normalem Start oeffnet sich kein Browser. Endet es mit 1 oder einem
' fremden Code, prueft ein Aufruf von "help", ob PowerShell das Skript ueberhaupt ausfuehren kann;
' geht das nicht, erscheint der Eintrag script-blocked-hidden des Fehlerkatalogs byl-problems.ps1
' in ASCII (ADR-0048; gleich dem Katalog, tests/unit/script-problems.test.mjs).
Option Explicit

Dim shell, fso, appDir, script, powershell, prefix, code, problem

Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

appDir = fso.GetParentFolderName(WScript.ScriptFullName)
script = fso.BuildPath(appDir, "byl-control.ps1")
problem = Array( _
    "X Problem:   becauseyoulovejira konnte ohne Fenster nicht starten: byl-control.ps1 liess sich nicht", _
    "             ausfuehren.", _
    "  Ursache:   Eine Richtlinie fuer PowerShell-Skripte blockiert es, oder Dateien im Ordner app fehlen", _
    "             oder sind beschaedigt.", _
    "  So geht's: start.bat im Ordner {app} doppelklicken: Das Fenster zeigt, was zu tun ist, mit", _
    "             Befehlen zum Kopieren.")

Sub ShowProblem()
    MsgBox Replace(Join(problem, vbCrLf), "{app}", appDir), vbCritical, "becauseyoulovejira"
End Sub

If Not fso.FileExists(script) Then
    ShowProblem
    WScript.Quit 1
End If

powershell = shell.ExpandEnvironmentStrings("%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe")
prefix = Chr(34) & powershell & Chr(34) & " -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File " & _
    Chr(34) & script & Chr(34)

' 0 = kein Fenster, True = auf das Ende warten und den Exit-Code weitergeben.
code = shell.Run(prefix & " start -Hidden", 0, True)
If code = 1 Or code < 0 Or code > 6 Then
    If shell.Run(prefix & " help", 0, True) <> 0 Then ShowProblem
End If
WScript.Quit code
