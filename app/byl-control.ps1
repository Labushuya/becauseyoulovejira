# Start, stop and autostart of becauseyoulovejira (E1 plan, package 8). Called by start.bat,
# start-hidden.vbs, stop.bat, autostart-an.bat and autostart-aus.bat, always with
# -NoProfile -ExecutionPolicy Bypass (script execution is disabled on the target machine).
#
# Exit codes: 0 = done, 1 = error (message shown), 2 = first run (hint shown; start.bat pauses so
# the hint stays readable).
#
# -Hidden (autostart via start-hidden.vbs): no console exists, so hints and errors appear as a
# message box, and a normal start does not open the browser (silent start at logon). In the first
# run PocketBase opens the installer itself; the message box explains the next steps.
#
# Saved as UTF-8 with BOM: Windows PowerShell 5.1 reads BOM-less files as ANSI (umlauts).

[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][ValidateSet('Start')][string]$Action,
    [switch]$Hidden
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 2.0

$AppDir = $PSScriptRoot
. ([System.IO.Path]::Combine($PSScriptRoot, 'byl-functions.ps1'))

$Title = 'becauseyoulovejira'
$HealthTimeoutSeconds = 30

$FirstRunHint = @"
Erster Start: Im Browser öffnet sich einmalig die PocketBase-Einrichtung.
  1. Lege dort dein Admin-Konto an.
  2. Lege danach im Admin-Bereich ($($BylAppUrl)_/) unter „users“ dein App-Konto an (E-Mail und Passwort).
  3. Öffne $BylAppUrl und melde dich mit dem App-Konto an.
Der Einrichtungslink ist 30 Minuten gültig – ist er abgelaufen, starte die App neu (stop.bat, dann start.bat).
"@

function Show-Message {
    param([Parameter(Mandatory = $true)][string]$Text, [ValidateSet('Info', 'Error')][string]$Kind = 'Info')

    if ($Hidden) {
        # WScript.Shell.Popup: 0 = no timeout; 64 = information icon, 16 = error icon.
        $icon = if ($Kind -eq 'Error') { 16 } else { 64 }
        [void](New-Object -ComObject WScript.Shell).Popup($Text, 0, $Title, $icon)
        return
    }
    if ($Kind -eq 'Error') { Write-Host $Text -ForegroundColor Red } else { Write-Host $Text }
}

function Write-Status {
    param([Parameter(Mandatory = $true)][string]$Text)
    if (-not $Hidden) { Write-Host $Text }
}

function Read-ServerLog {
    $log = Get-ServerLogPath -AppDir $AppDir
    try {
        return (Read-SharedText -Path $log.Output) + "`n" + (Read-SharedText -Path $log.Error)
    }
    catch {
        return ''
    }
}

function Get-LogTail {
    # Last lines of the server output for error messages (never contains credentials: the
    # installer link is a one-time token for the local machine, printed by PocketBase itself).
    $lines = @((Read-ServerLog) -split "`r?`n" | Where-Object { $_.Trim() -ne '' })
    if ($lines.Count -eq 0) { return '' }
    return "`n`nLetzte Log-Zeilen:`n" + (($lines | Select-Object -Last 8) -join "`n")
}

function Open-App {
    Start-Process -FilePath $BylAppUrl
}

function Invoke-Start {
    $exe = [System.IO.Path]::Combine($AppDir, 'pocketbase.exe')
    if (-not (Test-Path -LiteralPath $exe -PathType Leaf)) {
        Show-Message -Kind Error -Text "pocketbase.exe fehlt in:`n$AppDir`n`nBitte zuerst scripts\fetch-pocketbase.ps1 ausführen."
        return 1
    }
    $log = Get-ServerLogPath -AppDir $AppDir
    $logHint = "Log: $($log.Output)`n     $($log.Error)"

    $processes = Get-ProcessSnapshot
    $port = Resolve-PortState -Listener (Get-ListenerSnapshot) -Process $processes -AppDir $AppDir

    if ($port.State -eq 'Foreign') {
        Show-Message -Kind Error -Text ("Port 8090 auf 127.0.0.1 ist bereits belegt durch {0} (PID {1}).`n" +
            "becauseyoulovejira wird nicht gestartet. Beende das andere Programm und starte danach erneut." -f
            $port.ProcessName, $port.ProcessId)
        return 1
    }

    if ($port.State -eq 'App') {
        Write-Status "becauseyoulovejira läuft bereits (PID $($port.ProcessId))."
        if (Test-FirstRun -LogText (Read-ServerLog) -DatabaseExisted $true) {
            Show-Message ("Die laufende Instanz wurde ohne Admin-Konto gestartet. Ist die Einrichtung noch nicht " +
                "abgeschlossen, starte die App neu (stop.bat, dann start.bat), um einen frischen Einrichtungslink zu bekommen.")
        }
        if (-not $Hidden) {
            Write-Status "Öffne $BylAppUrl ..."
            Open-App
        }
        return 0
    }

    $databaseExisted = Test-Path -LiteralPath ([System.IO.Path]::Combine($AppDir, 'pb_data', 'data.db')) -PathType Leaf
    $own = @(Select-AppProcess -Process $processes -AppDir $AppDir)
    if ($own.Count -gt 0) {
        # Own instance exists but does not listen yet (started a moment ago): no second server.
        Write-Status "becauseyoulovejira startet bereits (PID $($own[0].ProcessId)), warte auf den Server ..."
        $server = Get-Process -Id ([int]$own[0].ProcessId) -ErrorAction SilentlyContinue
        if ($null -eq $server) {
            Show-Message -Kind Error -Text 'Die gerade startende Instanz wurde wieder beendet. Bitte start.bat erneut ausführen.'
            return 1
        }
    }
    else {
        Write-Status 'Starte PocketBase ...'
        try {
            [void](New-Item -ItemType Directory -Force -Path $log.Directory)
            $server = Start-Process -FilePath $exe -ArgumentList (Get-ServerArgumentString -AppDir $AppDir) `
                -WorkingDirectory $AppDir -WindowStyle Hidden -PassThru `
                -RedirectStandardOutput $log.Output -RedirectStandardError $log.Error
        }
        catch {
            Show-Message -Kind Error -Text "PocketBase konnte nicht gestartet werden: $($_.Exception.Message)"
            return 1
        }
        # Touch the handle now; otherwise Windows PowerShell 5.1 cannot report the exit code later.
        [void]$server.Handle
    }

    Write-Status "Warte auf $BylHealthUrl (höchstens $HealthTimeoutSeconds s) ..."
    $state = Wait-ServerReady -Process $server -TimeoutSeconds $HealthTimeoutSeconds
    if ($state -eq 'Exited') {
        Show-Message -Kind Error -Text ("PocketBase wurde beim Start beendet (Exit-Code $($server.ExitCode)).`n$logHint" + (Get-LogTail))
        return 1
    }
    if ($state -eq 'Timeout') {
        Show-Message -Kind Error -Text ("PocketBase hat nach $HealthTimeoutSeconds Sekunden nicht auf /api/health geantwortet.`n" +
            "$logHint`nDer Serverprozess (PID $($server.Id)) läuft eventuell weiter; stop.bat beendet ihn." + (Get-LogTail))
        return 1
    }

    if (Wait-FirstRunSignal -ReadLog { Read-ServerLog } -DatabaseExisted $databaseExisted) {
        # PocketBase opens the installer itself; opening the app as well would mean two tabs.
        Show-Message ($FirstRunHint + "`nÖffnet sich kein Browser, steht der Einrichtungslink im Log:`n$($log.Error)`n$($log.Output)")
        return 2
    }

    Write-Status 'becauseyoulovejira läuft.'
    if (-not $Hidden) {
        Write-Status "Öffne $BylAppUrl ..."
        Open-App
    }
    return 0
}

try {
    $exitCode = switch ($Action) {
        'Start' { Invoke-Start }
    }
}
catch {
    Show-Message -Kind Error -Text "Unerwarteter Fehler: $($_.Exception.Message)"
    $exitCode = 1
}
# A function that leaks output would turn the result into an array; the last value is the code.
exit ([int](@($exitCode)[-1]))
