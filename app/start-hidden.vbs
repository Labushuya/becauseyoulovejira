' start-hidden.vbs - Startet PocketBase ohne sichtbares Konsolenfenster

Dim objShell, strCommand, objFSO, strScriptDir, strPBExe

Set objShell = CreateObject("WScript.Shell")
Set objFSO = CreateObject("Scripting.FileSystemObject")

' Ermittle das Skriptverzeichnis
strScriptDir = objFSO.GetParentFolderName(WScript.ScriptFullName)

' Prüfe, ob pocketbase.exe existiert
strPBExe = objFSO.BuildPath(strScriptDir, "pocketbase.exe")
if not objFSO.FileExists(strPBExe) then
    MsgBox "Fehler: pocketbase.exe nicht gefunden in " & strScriptDir, vbCritical, "becauseyoulovejira"
    WScript.Quit 1
end if

' Baue den Befehl zusammen
strCommand = Chr(34) & strPBExe & Chr(34) & " serve " & _
    "--http=127.0.0.1:8090 " & _
    "--dir=" & Chr(34) & objFSO.BuildPath(strScriptDir, "pb_data") & Chr(34) & " " & _
    "--hooksDir=" & Chr(34) & objFSO.BuildPath(strScriptDir, "pb_hooks") & Chr(34) & " " & _
    "--migrationsDir=" & Chr(34) & objFSO.BuildPath(strScriptDir, "pb_migrations") & Chr(34) & " " & _
    "--publicDir=" & Chr(34) & objFSO.BuildPath(strScriptDir, "pb_public") & Chr(34) & " " & _
    "--automigrate=false " & _
    "--indexFallback=true"

' Starte den Prozess im Hintergrund (Fenster 0 = versteckt)
objShell.Run strCommand, 0, False

' Keine weitere Wartezeit - wird von start.bat abgefragt
WScript.Quit 0
