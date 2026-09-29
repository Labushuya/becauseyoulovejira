' start-hidden.vbs - startet becauseyoulovejira ohne sichtbares Fenster (Ziel der Autostart-
' Verknuepfung). Ruft byl-control.ps1 start -Hidden auf: Hinweise und Fehler erscheinen
' dann als Meldungsfenster, bei normalem Start oeffnet sich kein Browser.
Option Explicit

Dim shell, fso, appDir, script, powershell, command

Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

appDir = fso.GetParentFolderName(WScript.ScriptFullName)
script = fso.BuildPath(appDir, "byl-control.ps1")
If Not fso.FileExists(script) Then
    MsgBox "byl-control.ps1 wurde nicht gefunden in:" & vbCrLf & appDir, vbCritical, "becauseyoulovejira"
    WScript.Quit 1
End If

powershell = shell.ExpandEnvironmentStrings("%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe")
command = Chr(34) & powershell & Chr(34) & " -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File " & _
    Chr(34) & script & Chr(34) & " start -Hidden"

' 0 = kein Fenster, True = auf das Ende warten und den Exit-Code weitergeben.
WScript.Quit shell.Run(command, 0, True)
