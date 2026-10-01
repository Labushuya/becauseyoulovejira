# Operation of becauseyoulovejira (ADR-0039): start, stop, restart, reload, status, open, logs,
# doctor and port of the app, the autostart (E1 plan, package 8), the admin reset (E1.1) and the
# mail helper byl-mail.exe next to PocketBase (E4 plan, package 11). The page "Einstellungen →
# System" of the app (ADR-0043) calls fixed commands of it: status, doctor and logs with -Json,
# restart -Detach, mail-restart, autostart-on and autostart-off; the page "Einstellungen →
# Sicherung" (ADR-0046) the commands backup-* and restore -Detach.
# Called by start.bat, start-hidden.vbs, stop.bat, neu-starten.bat, status.bat, autostart-an.bat,
# autostart-aus.bat, admin-zuruecksetzen.bat and wiederherstellen.bat, always with -NoProfile
# -ExecutionPolicy Bypass (script execution is disabled on the target machine):
#   powershell -NoProfile -ExecutionPolicy Bypass -File byl-control.ps1 <command> [options]
# "help" lists the commands, options and exit codes.
#
# Exit codes: 0 = done, 1 = error (message shown), 2 = setup pending (first-run hint, or a running
# instance whose installer link still works; start.bat pauses so the hint stays readable),
# 3 = not running (status, open), 4 = the port is used by another program, 5 = the app runs but
# does not answer, 6 = the app runs but needs a restart (status).
#
# -Hidden (autostart via start-hidden.vbs): no console exists, so hints and errors appear as a
# message box, and a normal start does not open the browser (silent start at logon). In the first
# run PocketBase opens the installer itself; the message box explains the next steps.
#
# Safety rule (ADR-0039 section 4): stop and restart end only processes whose program lies in this
# folder (Select-AppProcess, Select-MailHelperProcess), never by name alone, and first in order
# (console break, then waiting), only then hard.
#
# Saved as UTF-8 with BOM: Windows PowerShell 5.1 reads BOM-less files as ANSI (umlauts).

[CmdletBinding()]
param(
    [Parameter(Position = 0)]
    [ValidateSet('start', 'stop', 'restart', 'reload', 'status', 'open', 'logs', 'doctor', 'port', 'autostart-on', 'autostart-off', 'mail-restart', 'reset-admin',
        'backup-info', 'backup-configure', 'backup-passphrase', 'backup-export', 'backup-verify', 'restore', 'help')]
    [string]$Command = 'help',
    [Parameter(Position = 1)][string]$Value,
    [switch]$Force,
    [switch]$Hidden,
    [switch]$NoBrowser,
    [switch]$Quiet,
    [switch]$Json,
    [switch]$Follow,
    [ValidateRange(1, 10000)][int]$Lines = 30,
    [switch]$Detach,
    [ValidateRange(0, 2147483647)][int]$WaitForProcess = 0
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 2.0

$AppDir = $PSScriptRoot
. ([System.IO.Path]::Combine($PSScriptRoot, 'byl-functions.ps1'))

$Title = 'becauseyoulovejira'
$HealthTimeoutSeconds = 30
# PocketBase ends about 1 s after the console break (1 s for open requests, then the database).
$StopGraceSeconds = 15
# The child that sends the console break: about 0.5 s, up to about 12 s on a busy CI runner.
$BreakSenderSeconds = 30
$PortFreeTimeoutSeconds = 10
# restart -WaitForProcess: how long the detached restart waits for its caller to end.
$CallerExitSeconds = 10
$ControlCall = 'powershell -NoProfile -ExecutionPolicy Bypass -File "{0}"' -f ([System.IO.Path]::Combine($AppDir, 'byl-control.ps1'))

$MissedLinkHint = 'Link verpasst oder abgelaufen? admin-zuruecksetzen.bat legt ein Admin-Konto an, ohne Daten zu löschen.'

$FirstRunHint = @"
Erster Start: Im Browser öffnet sich einmalig die Einrichtung.
  1. Lege dort dein Admin-Konto an.
  2. Lege danach im Admin-Bereich ({0}_/) unter „users“ dein App-Konto an (E-Mail und Passwort).
  3. Öffne {0} und melde dich mit dem App-Konto an.
Der Einrichtungslink ist 30 Minuten gültig – ist er abgelaufen, erst stop.bat, dann start.bat (erzeugt einen neuen Link).
$MissedLinkHint
"@

# {0} = expiry time (HH:mm), {1} = installer URL.
$PendingSetupHint = @"
becauseyoulovejira läuft, aber die Einrichtung ist noch nicht abgeschlossen: Es gibt noch kein Admin-Konto.
Der Einrichtungslink öffnet sich jetzt im Browser (gültig bis {0} Uhr):
{1}
  1. Lege dort dein Admin-Konto an.
  2. Lege danach im Admin-Bereich unter „users“ dein App-Konto an (E-Mail und Passwort).
$MissedLinkHint
"@

$HelpText = @"
becauseyoulovejira – Steuerung (Ordner: $AppDir)

Aufruf: $ControlCall <Befehl> [Optionen]

Befehle:
  start           Startet die App (läuft sie schon, öffnet es nur den Browser). Doppelklick: start.bat
  stop            Beendet die App geordnet: erst den Mail-Hilfsprozess, dann PocketBase. Doppelklick: stop.bat
  restart         Beendet die App und startet sie neu (immer).
  reload          Startet nur neu, wenn es nötig ist (neue Migration, geänderte Hooks, …). Doppelklick: neu-starten.bat
  status          Zeigt, ob die App läuft, ihre Adresse und ob ein Neustart nötig ist. Doppelklick: status.bat
  open            Öffnet die laufende App im Browser.
  logs [Log]      Letzte Zeilen der Logs: server, mail, skript oder alle.
  doctor          Prüft Dateien, Port, Schreibrechte, Plattenplatz und andere Kopien.
  port [Zahl]     Zeigt den Port oder stellt ihn um (1024–65535, Standard $BylDefaultPort; gespeichert in $BylConfigName).
  autostart-on    Startet die App künftig bei der Anmeldung (autostart-an.bat).
  autostart-off   Nimmt die App aus dem Autostart (autostart-aus.bat).
  mail-restart    Startet den Mail-Hilfsprozess neu (beendet ihn geordnet und startet ihn, wenn ein Postfach eingeschaltet ist).
  reset-admin     Legt ein Admin-Konto an oder setzt sein Passwort neu (admin-zuruecksetzen.bat).
  backup-info     Zustand der Sicherung: Zielverzeichnis, Passphrase, Hilfsprogramm, Namen der BYL_*-Variablen.
  backup-configure [Pfad]
                  Stellt das Zielverzeichnis der verschlüsselten Sicherungen ein (leer: keins).
  backup-passphrase
                  Legt die Passphrase der Sicherungen fest (zweimal eingeben; an dieses Windows-Konto gebunden).
  backup-export <Sicherung>
                  Verschlüsselt eine Sicherung aus pb_data\backups ins Zielverzeichnis.
  backup-verify <Sicherung oder Pfad>
                  Prüft eine Sicherung: entschlüsseln, entpacken, Datenbank, Originaldateien, Probe-Start.
  restore [Sicherung oder Pfad]
                  Stellt eine Sicherung wieder her (wiederherstellen.bat): prüfen, Rückfrage, Sicherheits-
                  kopie der jetzigen Daten, austauschen, starten; startet sie nicht, gilt wieder der alte Stand.
  help            Diese Hilfe.

Optionen:
  -Force          start: eine laufende App, die nicht antwortet, neu starten; reload: immer neu starten.
  -NoBrowser      start/restart/reload/open: keinen Browser öffnen.
  -Quiet          nur Fehler und das Ergebnis ausgeben.
  -Json           status/doctor/logs/backup-*: Ergebnis als JSON (logs ohne Werte der BYL_*-Variablen).
  -Follow         logs: dem Log folgen (Strg+C beendet); nur mit server, mail oder skript.
  -Lines <Zahl>   logs: Anzahl der Zeilen (Standard 30).
  -Hidden         ohne Fenster (Autostart): Hinweise als Meldungsfenster.
  -Detach         restart, restore: startet den Neustart bzw. die Wiederherstellung als eigenen Prozess
                  im Hintergrund und endet sofort (für die Seiten „System“ und „Sicherung“ der App;
                  Ergebnis in logs\byl-control.log).

Exit-Codes:
  0  erledigt (status: läuft und ist aktuell)
  1  Fehler (siehe Meldung)
  2  Einrichtung offen (erster Start)
  3  läuft nicht (status, open)
  4  Port belegt durch ein anderes Programm
  5  App läuft, antwortet aber nicht
  6  läuft, aber ein Neustart ist nötig (status)
"@

# Reasons for a restart (Compare-BylFingerprint) as the user reads them.
$RestartReasonText = @{
    unknown     = 'Startstand unbekannt (gestartet ohne diese Skripte)'
    server      = 'neue PocketBase-Version (pocketbase.exe)'
    migrations  = 'neue oder geänderte Migration'
    hooks       = 'geänderte Server-Logik (pb_hooks)'
    port        = "anderer Port eingestellt ($BylConfigName)"
    environment = 'BYL_*-Variable angelegt, geändert oder entfernt'
    mailHelper  = 'neuer Mail-Hilfsprozess (byl-mail.exe)'
}

# Log detail of the current command for byl-control.log (numbers and fixed words only).
$script:LogDetail = ''
# Exit codes of the senders of console breaks of this command (Stop-Gracefully), in order; the log
# line ends with them ("break=0" or "break=1,0"), so a hard stop tells why (plan test-haertung T-3).
$script:BreakCodes = New-Object System.Collections.Generic.List[int]
# What the last Start-MailHelper decided (Get-MailHelperDecision, or Failed); mail-restart logs it.
$script:MailHelperDecision = 'None'

function Show-Message {
    param([Parameter(Mandatory = $true)][string]$Text, [ValidateSet('Info', 'Warning', 'Error')][string]$Kind = 'Info')

    if ($Hidden) {
        # WScript.Shell.Popup: 0 = no timeout; 64 = information, 48 = warning, 16 = error icon.
        $icon = switch ($Kind) { 'Error' { 16 } 'Warning' { 48 } default { 64 } }
        [void](New-Object -ComObject WScript.Shell).Popup($Text, 0, $Title, $icon)
        return
    }
    switch ($Kind) {
        'Error' { Write-Host $Text -ForegroundColor Red }
        'Warning' { Write-Host $Text -ForegroundColor Yellow }
        default { Write-Host $Text }
    }
}

function Write-Status {
    # Progress and hints; silent with -Hidden (no console), -Quiet and -Json (only the JSON).
    param([Parameter(Mandatory = $true)][AllowEmptyString()][string]$Text)
    if (-not $Hidden -and -not $Quiet -and -not $Json) { Write-Host $Text }
}

function Write-Notice {
    # A warning that stays visible with -Quiet (yellow); silent with -Hidden and -Json.
    param([Parameter(Mandatory = $true)][string]$Text)
    if (-not $Hidden -and -not $Json) { Write-Host $Text -ForegroundColor Yellow }
}

function Write-JsonLine {
    # The one line of JSON of -Json on standard output. A program that reads it (the page System of
    # the app, ADR-0043) gets UTF-8 without BOM, whatever the code page of the console; in a console
    # window it goes through the console as before.
    param([Parameter(Mandatory = $true)][string]$Text)

    if (-not [Console]::IsOutputRedirected) {
        [Console]::Out.WriteLine($Text)
        return
    }
    $bytes = (New-Object System.Text.UTF8Encoding($false)).GetBytes($Text + "`n")
    $stream = [Console]::OpenStandardOutput()
    $stream.Write($bytes, 0, $bytes.Length)
    $stream.Flush()
}

function Write-ControlLog {
    # One line per command in logs\byl-control.log (Format-ControlLogLine: time, command, exit code
    # and $script:LogDetail, never values, passwords or e-mail addresses). Never fails the command.
    param([Parameter(Mandatory = $true)][string]$Name, [Parameter(Mandatory = $true)][int]$ExitCode)

    try {
        $path = Get-ControlLogPath -AppDir $AppDir
        [void][System.IO.Directory]::CreateDirectory([System.IO.Path]::GetDirectoryName($path))
        Invoke-LogRotation -Path $path -LimitBytes $BylControlLogLimitBytes
        $detail = $script:LogDetail
        if ($script:BreakCodes.Count -gt 0) { $detail = ("$detail break=" + ($script:BreakCodes -join ',')).Trim() }
        $line = Format-ControlLogLine -TimeUtc ([DateTime]::UtcNow) -Command $Name -ExitCode $ExitCode -Detail $detail
        [System.IO.File]::AppendAllText($path, "$line`r`n", (New-Object System.Text.UTF8Encoding($false)))
    }
    catch {
        $null = $_
    }
}

# Disposable copies of the tests only (tests/integration/control-script.test.mjs, ADR-0039
# addendum): with BYL_TEST_ISOLATED=1 in the environment of this process, the BYL_* variables come
# from this process instead of the Windows account, and nothing is written into the account. The
# test starts the script with a clean environment, so a copy sees only the values the test set.
$IsolatedEnvironment = [Environment]::GetEnvironmentVariable('BYL_TEST_ISOLATED', 'Process') -eq '1'

function Get-BylVariableScope {
    # The user and the machine scope of the BYL_* variables (ADR-0018 section 6): those of the
    # Windows account; for an isolated test copy this process as the user scope and no machine
    # scope. The only place that reads the scopes of the account.
    if ($IsolatedEnvironment) {
        return [pscustomobject]@{ User = [Environment]::GetEnvironmentVariables('Process'); Machine = @{} }
    }
    return [pscustomobject]@{
        User    = [Environment]::GetEnvironmentVariables('User')
        Machine = [Environment]::GetEnvironmentVariables('Machine')
    }
}

function Set-BylAccountVariable {
    # Writes the BYL_* variable $Name of the Windows account (user scope; an empty $Value removes it)
    # and of this process, so a following start hands it on (Sync-BylEnvironment). The only place
    # that writes access data into the account (restore, ADR-0046 section 7). An isolated test copy
    # never reaches the account: it writes this process and the JSON file BYL_TEST_ACCOUNT_FILE of
    # the test (name -> value), and refuses without that file.
    param([Parameter(Mandatory = $true)][string]$Name, [AllowNull()][AllowEmptyString()][string]$Value)

    if ($Name -cnotmatch $BylSecretNamePattern -or $Name.StartsWith('BYL_TEST_')) { throw "Keine Variable der Zugangsdaten: $Name" }
    if ($IsolatedEnvironment) {
        $file = [Environment]::GetEnvironmentVariable('BYL_TEST_ACCOUNT_FILE', 'Process')
        if ([string]::IsNullOrWhiteSpace($file)) { throw 'Diese Testkopie hat keine Datei für das Konto (BYL_TEST_ACCOUNT_FILE).' }
        $account = [ordered]@{}
        if ([System.IO.File]::Exists($file)) {
            foreach ($property in ([System.IO.File]::ReadAllText($file) | ConvertFrom-Json).PSObject.Properties) {
                $account[$property.Name] = [string]$property.Value
            }
        }
        if ([string]::IsNullOrEmpty($Value)) { $account.Remove($Name) } else { $account[$Name] = $Value }
        [System.IO.File]::WriteAllText($file, (ConvertTo-Json -InputObject $account -Compress), (New-Object System.Text.UTF8Encoding($false)))
        [Environment]::SetEnvironmentVariable($Name, $Value, 'Process')
        return
    }
    [Environment]::SetEnvironmentVariable($Name, $Value, 'User')
    [Environment]::SetEnvironmentVariable($Name, $Value, 'Process')
}

function Get-EnvironmentFingerprint {
    # Get-EnvironmentHash of the BYL_* variables a start hands to PocketBase (names from the user and
    # the machine scope, the value of the user scope first, as Sync-BylEnvironment), with $Key.
    # The values exist only in memory here; nothing is printed or stored.
    param([Parameter(Mandatory = $true)][byte[]]$Key)

    $scope = Get-BylVariableScope
    $user = $scope.User
    $machine = $scope.Machine
    $entries = foreach ($name in (Get-BylVariableName -UserNames @($user.Keys) -MachineNames @($machine.Keys))) {
        $value = if ($user.Contains($name)) { [string]$user[$name] } else { [string]$machine[$name] }
        "$name=$value"
    }
    return Get-EnvironmentHash -Entries @($entries) -Key $Key
}

function Protect-EnvironmentKey {
    # The key of the environment hash, encrypted for this Windows account (DPAPI), as Base64.
    param([Parameter(Mandatory = $true)][byte[]]$Key)

    Add-Type -AssemblyName System.Security
    return [Convert]::ToBase64String([System.Security.Cryptography.ProtectedData]::Protect($Key, $null, 'CurrentUser'))
}

function Unprotect-EnvironmentKey {
    # The key from the state file; $null if it is missing or another account or machine wrote it
    # (then the environment counts as changed).
    param([AllowNull()][AllowEmptyString()][string]$Protected)

    if ([string]::IsNullOrEmpty($Protected)) { return $null }
    try {
        Add-Type -AssemblyName System.Security
        return , [System.Security.Cryptography.ProtectedData]::Unprotect([Convert]::FromBase64String($Protected), $null, 'CurrentUser')
    }
    catch {
        return $null
    }
}

function New-EnvironmentKey {
    # 32 random bytes for the environment hash of one start.
    $bytes = New-Object byte[] 32
    $generator = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    try {
        $generator.GetBytes($bytes)
    }
    finally {
        $generator.Dispose()
    }
    return , $bytes
}

function Get-StartupFolder {
    # The Windows startup folder of the account. An isolated test copy never uses it: only the
    # folder of the test in BYL_TEST_STARTUP_DIR, or none at all ($null), so no test can change the
    # autostart of the user (ADR-0043).
    if ($IsolatedEnvironment) {
        $folder = [Environment]::GetEnvironmentVariable('BYL_TEST_STARTUP_DIR', 'Process')
        if ([string]::IsNullOrWhiteSpace($folder)) { return $null }
        return $folder
    }
    return [Environment]::GetFolderPath('Startup')
}

function Get-AutostartState {
    # 'on' (the shortcut starts start-hidden.vbs of this folder), 'other' (it starts another
    # folder, e.g. after moving app\) or 'off' (also for a test copy without its own folder).
    $startup = Get-StartupFolder
    if ($null -eq $startup) { return 'off' }
    $spec = Get-AutostartShortcut -AppDir $AppDir -StartupDir $startup -SystemDir ([Environment]::SystemDirectory)
    if (-not (Test-Path -LiteralPath $spec.Path -PathType Leaf)) { return 'off' }
    try {
        $arguments = (New-Object -ComObject WScript.Shell).CreateShortcut($spec.Path).Arguments
    }
    catch {
        return 'other'
    }
    if (Test-SamePath -Path ([string]$arguments).Trim('"', ' ') -Expected ([System.IO.Path]::Combine($AppDir, 'start-hidden.vbs'))) { return 'on' }
    return 'other'
}

function Read-TextFile {
    # Whole text of a small file of this folder, '' if it is missing or unreadable.
    param([Parameter(Mandatory = $true)][string]$Path)

    try {
        return Read-SharedText -Path $Path
    }
    catch {
        return ''
    }
}

function Write-TextFile {
    # Writes a small file of this folder (UTF-8 without BOM) through a temporary file, so a reader
    # never sees half a file. Throws on failure.
    param([Parameter(Mandatory = $true)][string]$Path, [Parameter(Mandatory = $true)][string]$Text)

    $directory = [System.IO.Path]::GetDirectoryName($Path)
    [void][System.IO.Directory]::CreateDirectory($directory)
    $temporary = "$Path.tmp"
    [System.IO.File]::WriteAllText($temporary, $Text, (New-Object System.Text.UTF8Encoding($false)))
    if ([System.IO.File]::Exists($Path)) {
        # [NullString]: a plain $null would reach .NET as "" (no backup file wanted).
        [System.IO.File]::Replace($temporary, $Path, [NullString]::Value)
    }
    else {
        [System.IO.File]::Move($temporary, $Path)
    }
}

function Get-Config {
    # Settings of byl-config.json (ConvertFrom-BylConfig); an unreadable file counts as broken.
    $path = Get-BylConfigPath -AppDir $AppDir
    if (-not [System.IO.File]::Exists($path)) { return ConvertFrom-BylConfig -Text '' }
    try {
        $text = [System.IO.File]::ReadAllText($path)
    }
    catch {
        return [pscustomobject]@{ Port = $BylDefaultPort; Problem = 'Json' }
    }
    return ConvertFrom-BylConfig -Text $text
}

function Get-ConfigProblemText {
    param([Parameter(Mandatory = $true)][string]$Problem)

    $what = if ($Problem -eq 'Port') { "enthält keinen gültigen Port ($BylPortMin–$BylPortMax)" } else { 'ist kein gültiges JSON' }
    return ("Die Einstellungsdatei $BylConfigName $($what):`n$(Get-BylConfigPath -AppDir $AppDir)`n" +
        "Erwartet wird zum Beispiel { `"port`": $BylDefaultPort }. Reparieren mit:`n  $ControlCall port $BylDefaultPort")
}

function Update-AddressFile {
    # run\app-adresse.js for the landing page; a failure only costs the landing page its port.
    param([Parameter(Mandatory = $true)][int]$Port)

    try {
        Write-TextFile -Path (Get-BylRunPath -AppDir $AppDir).Address -Text (ConvertTo-AddressScript -Port $Port)
    }
    catch {
        Write-Notice "Hinweis: run\app-adresse.js konnte nicht geschrieben werden ($($_.Exception.GetType().Name)); becauseyoulovejira.html nimmt dann Port $BylDefaultPort an."
    }
}

function Remove-StateFile {
    $path = (Get-BylRunPath -AppDir $AppDir).State
    try {
        if ([System.IO.File]::Exists($path)) { [System.IO.File]::Delete($path) }
    }
    catch {
        Write-Notice "Hinweis: run\byl.state.json konnte nicht gelöscht werden ($($_.Exception.GetType().Name))."
    }
}

function Get-Look {
    # One look at the own instance: processes, the own server (by program path and data folder),
    # its state file (a stale one is removed), its state and the owner of the configured port.
    param([Parameter(Mandatory = $true)][int]$Port)

    $processes = Get-ProcessSnapshot
    $own = @(Select-AppProcess -Process $processes -AppDir $AppDir)
    $state = ConvertFrom-BylState -Text (Read-TextFile -Path (Get-BylRunPath -AppDir $AppDir).State)
    if ((Resolve-StateMatch -State $state -Own $own) -eq 'Stale') {
        Remove-StateFile
        $state = $null
    }
    $runningPort = $null
    $healthy = $false
    $ageSeconds = [double]::MaxValue
    if ($own.Count -gt 0) {
        $runningPort = Get-ServerProcessPort -Process $own[0]
        $healthy = Test-Health -Url "http://127.0.0.1:$runningPort/api/health"
        if ($null -ne $own[0].CreationDate) { $ageSeconds = ([DateTime]::Now - [DateTime]$own[0].CreationDate).TotalSeconds }
    }
    return [pscustomobject]@{
        Processes   = $processes
        Own         = $own
        State       = $state
        RunningPort = $runningPort
        ServerState = Resolve-ServerState -ProcessFound ($own.Count -gt 0) -Healthy $healthy -AgeSeconds $ageSeconds -StartGraceSeconds $HealthTimeoutSeconds
        PortState   = Resolve-PortState -Listener (Get-ListenerSnapshot -Port $Port) -Process $processes -AppDir $AppDir -Port $Port
    }
}

function Test-PortFree {
    # True if nothing listens on 127.0.0.1:<Port> and the port can be bound (Windows also reserves
    # port ranges, e.g. for Hyper-V). Binds for a moment only.
    param([Parameter(Mandatory = $true)][int]$Port)

    $busy = @(Get-ListenerSnapshot -Port $Port | Where-Object { @('127.0.0.1', '0.0.0.0', '::') -contains [string]$_.LocalAddress })
    if ($busy.Count -gt 0) { return $false }
    $listener = New-Object System.Net.Sockets.TcpListener([System.Net.IPAddress]::Loopback, $Port)
    try {
        $listener.Start()
        return $true
    }
    catch {
        return $false
    }
    finally {
        $listener.Stop()
    }
}

function Get-PortBusyText {
    # Message for a port that another program uses: who it is, that nothing is stopped, and the
    # command for the next free port.
    param([Parameter(Mandatory = $true)][int]$Port, [Parameter(Mandatory = $true)][object]$PortState)

    $text = "Port $Port auf 127.0.0.1 ist belegt durch $($PortState.ProcessName) (PID $($PortState.ProcessId))."
    if ($PortState.ExecutablePath) { $text += "`n  Programm: $($PortState.ExecutablePath)" }
    if ($PortState.ExecutablePath -and [System.IO.Path]::GetFileName($PortState.ExecutablePath) -ieq 'pocketbase.exe') {
        $text += "`n  Das ist vermutlich eine andere Kopie von becauseyoulovejira. Beende sie in ihrem Ordner mit stop.bat."
    }
    $text += "`nbecauseyoulovejira wird nicht gestartet; das andere Programm bleibt unberührt."
    $next = Find-NextFreePort -Start $Port -IsFree { param($Candidate) Test-PortFree -Port $Candidate }
    $text += "`n`nMöglichkeiten:`n  1. Das andere Programm beenden und start.bat erneut ausführen."
    if ($null -ne $next) {
        $text += ("`n  2. becauseyoulovejira auf den freien Port $next umstellen und danach start.bat ausführen:" +
            "`n     $ControlCall port $next" +
            "`n     Lesezeichen, die installierte App und die Browser-Erweiterung für WhatsApp Web brauchen dann die neue Adresse.")
    }
    return $text
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

function Get-Presence {
    # Open app tabs and a landing page lately (ADR-0035 section 4); $null on any failure.
    try {
        $answer = Invoke-LocalRequest -Url $BylPresenceUrl
        if ($null -eq $answer) { return $null }
        return ConvertFrom-PresenceAnswer -StatusCode $answer.StatusCode -Body $answer.Body
    }
    catch {
        return $null
    }
}

function Send-Attention {
    # Message to the open app tabs; the answer of the route or $null on any failure.
    param([Parameter(Mandatory = $true)][string]$Reason)

    try {
        $answer = Invoke-LocalRequest -Method POST -Url (Get-AttentionSendUrl -Reason $Reason)
        if ($null -eq $answer) { return $null }
        return ConvertFrom-AttentionAnswer -StatusCode $answer.StatusCode -Body $answer.Body
    }
    catch {
        return $null
    }
}

function Get-AttentionAcked {
    # Whether a tab confirmed the message $Nonce; $false on any failure.
    param([Parameter(Mandatory = $true)][string]$Nonce)

    try {
        $answer = Invoke-LocalRequest -Url (Get-AttentionUrl -Nonce $Nonce)
        if ($null -eq $answer) { return $false }
        return ConvertFrom-AttentionState -StatusCode $answer.StatusCode -Body $answer.Body
    }
    catch {
        return $false
    }
}

function Find-PwaShortcut {
    # Start menu shortcut of the installed web app (Chrome: "Chrome-Apps", Edge: directly in
    # Programs), chosen by Select-PwaShortcut; $null if there is none or anything fails.
    try {
        $programs = [Environment]::GetFolderPath('Programs')
        if ([string]::IsNullOrEmpty($programs)) { return $null }
        $files = @(Get-ChildItem -LiteralPath $programs -Filter 'becauseyoulovejira*.lnk' -Recurse -File -ErrorAction SilentlyContinue)
        if ($files.Count -eq 0) { return $null }
        $shell = New-Object -ComObject WScript.Shell
        $shortcuts = foreach ($file in $files) {
            $link = $shell.CreateShortcut($file.FullName)
            [pscustomobject]@{ Path = $file.FullName; Name = $file.BaseName; TargetPath = $link.TargetPath; Arguments = $link.Arguments }
        }
        return Select-PwaShortcut -Shortcuts @($shortcuts)
    }
    catch {
        return $null
    }
}

function Open-Browser {
    # Opens the app unless it is open already (ADR-0035 sections 7 and 8). An installed web app
    # comes first: its shortcut makes the browser focus the open app window (launch_handler
    # focus-existing) or open it. Otherwise an awake tab confirms the message and shows a hint, a
    # landing page (file://) opens the app itself, and after a cold start the tabs get up to 3 s
    # to reconnect. Every doubt opens the tab (fail-open).
    param([Parameter(Mandatory = $true)][bool]$ColdStart)

    $shortcut = Find-PwaShortcut
    if ($null -ne $shortcut) {
        try {
            Start-Process -FilePath $shortcut
            Write-Status 'Öffne die installierte App becauseyoulovejira ...'
            return
        }
        catch {
            Write-Status 'Die installierte App ließ sich nicht starten; öffne den Browser.'
        }
    }
    $action = Resolve-BrowserAction -ColdStart $ColdStart -GetPresence { Get-Presence } `
        -SendAttention { Send-Attention -Reason 'start' } -GetAcked { param($Nonce) Get-AttentionAcked -Nonce $Nonce }
    if ($action -eq 'Skip') {
        Write-Status 'becauseyoulovejira ist bereits in einem Browser-Tab offen; dort erscheint ein Hinweis.'
        return
    }
    Write-Status "Öffne $BylAppUrl ..."
    Open-App
}

function Send-StopNotice {
    # Tells the open tabs that the app ends (stop), without waiting for them; the stop never
    # depends on it.
    try {
        [void](Invoke-LocalRequest -Method POST -Url (Get-AttentionSendUrl -Reason 'stop') -TimeoutMilliseconds 1000)
    }
    catch {
        $null = $_
    }
}

function Get-ProcessStartUtc {
    # Start time of the server process; if it cannot be read, a time that makes the "issued by
    # this run" check of Get-InstallerLink accept any link that has not expired yet.
    param([AllowNull()][object]$Process)

    try {
        if ($null -ne $Process) { return $Process.StartTime.ToUniversalTime() }
    }
    catch {
        $null = $_
    }
    return [DateTime]::UtcNow.AddMinutes(-($BylInstallerLifetimeMinutes + 1))
}

function Get-PendingInstallerLink {
    # Installer link of the running instance if the setup was missed: the link was printed by this
    # run of the server, has not expired and still works (no real admin account yet). $null otherwise.
    param([Parameter(Mandatory = $true)][int]$ProcessId)

    $startUtc = Get-ProcessStartUtc -Process (Get-Process -Id $ProcessId -ErrorAction SilentlyContinue)
    $link = Get-InstallerLink -LogText (Read-ServerLog) -ProcessStartUtc $startUtc -NowUtc ([DateTime]::UtcNow)
    if ($null -eq $link -or -not (Test-InstallerPending -Token $link.Token)) { return $null }
    return $link
}

function Sync-BylEnvironment {
    # Access data of the channels (ADR-0018 section 6): a process sees environment variables only
    # as they were at its start, so the BYL_* variables are read fresh from the user scope and set
    # in this process, which Start-Process hands on to PocketBase. Removed ones are dropped. A
    # changed variable therefore works after a restart, without logging off. Nothing is printed,
    # neither names nor values. An isolated test copy keeps the variables of its process.
    $scope = Get-BylVariableScope
    $user = $scope.User
    $machine = $scope.Machine
    $process = [Environment]::GetEnvironmentVariables('Process')
    $change = Get-BylEnvironmentChange -UserNames @($user.Keys) -MachineNames @($machine.Keys) -ProcessNames @($process.Keys)
    foreach ($name in $change.Set) {
        [Environment]::SetEnvironmentVariable($name, [string]$user[$name], 'Process')
    }
    foreach ($name in $change.Remove) {
        [Environment]::SetEnvironmentVariable($name, $null, 'Process')
    }
}

function Initialize-IngestToken {
    # Ingest token of the mail helper (ADR-0018 section 8): created once in the user scope when
    # byl-mail.exe is in the app folder and the variable is missing; Sync-BylEnvironment then hands
    # it to PocketBase and the helper. Neither name nor value is printed; a failure only means that
    # the helper cannot deliver mails, the app itself starts anyway. An isolated test copy never
    # writes into the account.
    if ($IsolatedEnvironment) { return }
    $helper = [System.IO.Path]::Combine($AppDir, $BylMailHelperName)
    $current = [Environment]::GetEnvironmentVariable($BylIngestTokenName, 'User')
    if (-not (Test-IngestTokenNeeded -HelperExists (Test-Path -LiteralPath $helper -PathType Leaf) -CurrentValue $current)) { return }
    try {
        [Environment]::SetEnvironmentVariable($BylIngestTokenName, (New-IngestTokenValue), 'User')
    }
    catch {
        Write-Status "Hinweis: Der Zugang für byl-mail.exe konnte nicht angelegt werden ($($_.Exception.GetType().Name)). Postfächer werden nicht abgerufen."
    }
}

function Get-MailConnectionCount {
    # Asks the app's PocketBase how many switched-on mail connections exist (ingest route with the
    # token; ConvertFrom-MailConnectionAnswer). No proxy: the token only goes to 127.0.0.1.
    param([Parameter(Mandatory = $true)][string]$Token)

    $request = [System.Net.WebRequest]::Create("$($BylAppUrl)api/byl/ingest/connections")
    $request.Proxy = $null
    $request.Timeout = 5000
    $request.KeepAlive = $false
    $request.Headers.Add('Authorization', "Bearer $Token")
    try {
        $response = $request.GetResponse()
    }
    catch [System.Net.WebException] {
        $response = $_.Exception.Response
        if ($null -eq $response) { return -1 }
    }
    try {
        $reader = New-Object System.IO.StreamReader($response.GetResponseStream(), [System.Text.Encoding]::UTF8)
        return ConvertFrom-MailConnectionAnswer -StatusCode ([int]$response.StatusCode) -Body $reader.ReadToEnd()
    }
    finally {
        $response.Close()
    }
}

function Start-MailHelper {
    # Starts byl-mail.exe next to the running PocketBase when Get-MailHelperDecision says so: the
    # file exists, the token is set, no own helper runs and there is a switched-on mail connection.
    # Never breaks the start of the app; a problem only gives a hint without any value.
    try {
        Initialize-IngestToken
        Sync-BylEnvironment
        $helper = [System.IO.Path]::Combine($AppDir, $BylMailHelperName)
        $exists = Test-Path -LiteralPath $helper -PathType Leaf
        $token = [string][Environment]::GetEnvironmentVariable($BylIngestTokenName, 'Process')
        $tokenSet = -not [string]::IsNullOrWhiteSpace($token)
        $running = @(Select-MailHelperProcess -Process (Get-ProcessSnapshot) -AppDir $AppDir).Count -gt 0
        $count = -1
        if ($exists -and $tokenSet -and -not $running) { $count = Get-MailConnectionCount -Token $token.Trim() }
        $decision = Get-MailHelperDecision -HelperExists $exists -TokenSet $tokenSet -Running $running -MailConnectionCount $count
        $script:MailHelperDecision = $decision
        if ($decision -eq 'Start') {
            $log = Get-MailHelperLogPath -AppDir $AppDir
            [void](New-Item -ItemType Directory -Force -Path $log.Directory)
            Invoke-LogRotation -Path $log.Output
            Invoke-LogRotation -Path $log.Error
            $process = Start-Process -FilePath $helper -ArgumentList (Get-MailHelperArgumentString) `
                -WorkingDirectory $AppDir -WindowStyle Hidden -PassThru `
                -RedirectStandardOutput $log.Output -RedirectStandardError $log.Error
            Write-Status "Mail-Hilfsprozess byl-mail.exe gestartet (PID $($process.Id))."
        }
        elseif ($decision -eq 'Running') {
            Write-Status 'Mail-Hilfsprozess byl-mail.exe läuft bereits.'
        }
        elseif ($decision -eq 'NoRoute') {
            Write-Status 'Hinweis: byl-mail.exe startet erst nach einem Neustart der App (neu-starten.bat).'
        }
    }
    catch {
        $script:MailHelperDecision = 'Failed'
        Write-Status "Hinweis: byl-mail.exe konnte nicht gestartet werden ($($_.Exception.GetType().Name))."
    }
}

function Wait-Ready {
    # Waits for /api/health of $Server with a dot per second; 'Ready', 'Exited' or 'Timeout'.
    param([Parameter(Mandatory = $true)][object]$Server)

    Write-Status "Warte auf $BylHealthUrl (höchstens $HealthTimeoutSeconds s) ..."
    $state = Wait-ServerReady -Process $Server -TimeoutSeconds $HealthTimeoutSeconds -Progress {
        param($Seconds)
        if (-not $Hidden -and -not $Quiet -and -not $Json) { Write-Host "  ... $Seconds s" }
    }
    return $state
}

function Complete-Start {
    # After a healthy start: mail helper, result line and browser.
    param([Parameter(Mandatory = $true)][int]$ProcessId, [Parameter(Mandatory = $true)][bool]$ColdStart)

    Start-MailHelper
    $script:LogDetail = ("$script:LogDetail pid=$ProcessId port=$BylPort").Trim()
    Write-Status "becauseyoulovejira läuft: $BylAppUrl (PID $ProcessId)."
    if (-not $Hidden -and -not $NoBrowser) { Open-Browser -ColdStart $ColdStart }
}

function Show-PreStartNotice {
    # The part of "doctor" that matters before a cold start: disk space and other copies of the
    # app. Only hints; the start goes on.
    param([Parameter(Mandatory = $true)][object[]]$Processes)

    try {
        $drive = New-Object System.IO.DriveInfo([System.IO.Path]::GetPathRoot($AppDir))
        $disk = Get-DiskVerdict -FreeBytes $drive.AvailableFreeSpace
        if ($disk -ne 'Ok') {
            Write-Notice ("Hinweis: Auf dem Laufwerk der App sind nur noch {0:N0} MB frei; Datenbank und Backups brauchen Platz." -f ($drive.AvailableFreeSpace / 1MB))
        }
    }
    catch {
        $null = $_
    }
    foreach ($other in @(Select-OtherServerProcess -Process $Processes -AppDir $AppDir)) {
        if ($other.SameFolder) { continue }
        $where = if ($null -ne $other.Port) { "Port $($other.Port)" } else { 'eine andere Adresse' }
        Write-Notice "Hinweis: Eine andere Kopie läuft auf $where (PID $($other.ProcessId), $($other.ExecutablePath)); sie bleibt unberührt."
    }
}

function Start-Server {
    # Cold start of PocketBase: checks, start, state file with the start fingerprint, waiting for
    # /api/health, first run.
    param([Parameter(Mandatory = $true)][int]$Port, [Parameter(Mandatory = $true)][object[]]$Processes)

    $exe = [System.IO.Path]::Combine($AppDir, 'pocketbase.exe')
    $log = Get-ServerLogPath -AppDir $AppDir
    $logHint = "Log: $($log.Output)`n     $($log.Error)"
    $run = Get-BylRunPath -AppDir $AppDir
    try {
        [void][System.IO.Directory]::CreateDirectory($log.Directory)
        [void][System.IO.Directory]::CreateDirectory($run.Directory)
    }
    catch {
        Show-Message -Kind Error -Text "Der Ordner der App ist nicht beschreibbar ($($_.Exception.Message)):`n$AppDir"
        return $BylExitError
    }
    if (-not (Test-Path -LiteralPath ([System.IO.Path]::Combine($AppDir, 'pb_public', 'index.html')) -PathType Leaf)) {
        Write-Notice 'Hinweis: Die Oberfläche fehlt (pb_public\index.html). Erst scripts\build.ps1 ausführen; die Verwaltung unter /_/ geht auch so.'
    }
    Show-PreStartNotice -Processes $Processes

    Set-BylAddress -Port $Port
    $databaseExisted = Test-Path -LiteralPath ([System.IO.Path]::Combine($AppDir, 'pb_data', 'data.db')) -PathType Leaf
    Write-Status "Starte PocketBase auf $BylAppUrl ..."
    try {
        Initialize-IngestToken
        Sync-BylEnvironment
        # What this server loads; taken before the start, so a change during the start counts.
        # Without DPAPI (never seen on Windows 10) the variables are simply not compared.
        $environmentHash = ''
        $protectedKey = $null
        try {
            $key = New-EnvironmentKey
            $protectedKey = Protect-EnvironmentKey -Key $key
            $environmentHash = Get-EnvironmentFingerprint -Key $key
        }
        catch {
            $protectedKey = $null
            $environmentHash = ''
        }
        $fingerprint = Get-BylFingerprint -AppDir $AppDir -Port $Port -EnvironmentHash $environmentHash
        Invoke-LogRotation -Path $log.Output
        Invoke-LogRotation -Path $log.Error
        $server = Start-Process -FilePath $exe -ArgumentList (Get-ServerArgumentString -AppDir $AppDir -Port $Port) `
            -WorkingDirectory $AppDir -WindowStyle Hidden -PassThru `
            -RedirectStandardOutput $log.Output -RedirectStandardError $log.Error
    }
    catch {
        Show-Message -Kind Error -Text "PocketBase konnte nicht gestartet werden: $($_.Exception.Message)"
        return $BylExitError
    }
    # Touch the handle now; otherwise Windows PowerShell 5.1 cannot report the exit code later.
    [void]$server.Handle
    try {
        Write-TextFile -Path $run.State -Text (ConvertTo-BylStateText -ProcessId $server.Id -Port $Port `
                -ProcessStartUtc (Get-ProcessStartUtc -Process $server) -StartedUtc ([DateTime]::UtcNow) -Fingerprint $fingerprint `
                -EnvironmentKey $protectedKey)
    }
    catch {
        Write-Notice "Hinweis: run\byl.state.json konnte nicht geschrieben werden ($($_.Exception.GetType().Name))."
    }
    Update-AddressFile -Port $Port

    $state = Wait-Ready -Server $server
    if ($state -eq 'Exited') {
        Remove-StateFile
        Show-Message -Kind Error -Text ("PocketBase wurde beim Start beendet (Exit-Code $($server.ExitCode)).`n$logHint" + (Get-LogTail))
        return $BylExitError
    }
    if ($state -eq 'Timeout') {
        Show-Message -Kind Error -Text ("PocketBase hat nach $HealthTimeoutSeconds Sekunden nicht auf /api/health geantwortet.`n" +
            "$logHint`nDer Serverprozess (PID $($server.Id)) läuft eventuell weiter; stop.bat beendet ihn." + (Get-LogTail))
        return $BylExitUnhealthy
    }

    if (Wait-FirstRunSignal -ReadLog { Read-ServerLog } -DatabaseExisted $databaseExisted) {
        # PocketBase opens the installer itself; opening the app (or the link) as well would mean
        # two tabs. The link is only shown.
        $link = Wait-InstallerLink -ReadLog { Read-ServerLog } -ProcessStartUtc (Get-ProcessStartUtc -Process $server)
        $where = if ($null -ne $link) {
            "`nÖffnet sich kein Browser, kopiere diesen Link in den Browser (gültig bis {0} Uhr):`n{1}" -f
            $link.ExpiresUtc.ToLocalTime().ToString('HH:mm'), $link.Url
        }
        else {
            "`nÖffnet sich kein Browser, steht der Einrichtungslink im Log:`n$($log.Error)`n$($log.Output)"
        }
        Show-Message (($FirstRunHint -f $BylAppUrl) + $where)
        return $BylExitSetupPending
    }

    Complete-Start -ProcessId $server.Id -ColdStart $true
    return $BylExitOk
}

function Invoke-Start {
    param([Parameter(Mandatory = $true)][object]$Config)

    $exe = [System.IO.Path]::Combine($AppDir, 'pocketbase.exe')
    if (-not (Test-Path -LiteralPath $exe -PathType Leaf)) {
        Show-Message -Kind Error -Text "pocketbase.exe fehlt in:`n$AppDir`n`nBitte zuerst scripts\fetch-pocketbase.ps1 ausführen."
        return $BylExitError
    }
    if ($null -ne $Config.Problem) {
        Show-Message -Kind Error -Text (Get-ConfigProblemText -Problem $Config.Problem)
        return $BylExitError
    }

    $look = Get-Look -Port $Config.Port
    $action = Resolve-StartAction -ServerState $look.ServerState -PortState $look.PortState.State -Force $Force.IsPresent
    $processId = if ($look.Own.Count -gt 0) { [int]$look.Own[0].ProcessId } else { 0 }
    if ($null -ne $look.RunningPort) { Set-BylAddress -Port $look.RunningPort }

    switch ($action) {
        'PortBusy' {
            Show-Message -Kind Error -Text (Get-PortBusyText -Port $Config.Port -PortState $look.PortState)
            return $BylExitPortBusy
        }
        'Unhealthy' {
            Show-Message -Kind Error -Text ("becauseyoulovejira läuft (PID $processId, $BylAppUrl), antwortet aber nicht auf /api/health.`n" +
                "Neu starten: neu-starten.bat doppelklicken (oder $ControlCall restart)." + (Get-LogTail))
            return $BylExitUnhealthy
        }
        'Restart' {
            Write-Status "becauseyoulovejira (PID $processId) antwortet nicht; starte neu (-Force) ..."
            if ((Invoke-StopCore -Config $Config) -eq 'Failed') { return $BylExitError }
            return Start-Server -Port $Config.Port -Processes $look.Processes
        }
        'Wait' {
            # Own instance exists but does not answer yet (started a moment ago): no second server.
            Write-Status "becauseyoulovejira startet bereits (PID $processId), warte auf den Server ..."
            $server = Get-Process -Id $processId -ErrorAction SilentlyContinue
            if ($null -eq $server) {
                Show-Message -Kind Error -Text 'Die gerade startende Instanz wurde wieder beendet. Bitte start.bat erneut ausführen.'
                return $BylExitError
            }
            $state = Wait-Ready -Server $server
            if ($state -ne 'Ready') {
                Show-Message -Kind Error -Text ("becauseyoulovejira (PID $processId) antwortet nicht auf /api/health.`n" +
                    "Neu starten: neu-starten.bat doppelklicken (oder $ControlCall restart)." + (Get-LogTail))
                return $BylExitUnhealthy
            }
            Complete-Start -ProcessId $processId -ColdStart $true
            return $BylExitOk
        }
        'Open' {
            Write-Status "becauseyoulovejira läuft bereits (PID $processId, $BylAppUrl)."
            $script:LogDetail = "pid=$processId port=$($look.RunningPort) running"
            if ($look.RunningPort -ne $Config.Port) {
                Write-Notice "Hinweis: Eingestellt ist Port $($Config.Port); die neue Adresse gilt nach einem Neustart (neu-starten.bat)."
            }
            Update-AddressFile -Port $look.RunningPort
            $link = Get-PendingInstallerLink -ProcessId $processId
            if ($null -ne $link) {
                # Setup missed: open the installer link (once, instead of the app) and pause start.bat.
                Show-Message ($PendingSetupHint -f $link.ExpiresUtc.ToLocalTime().ToString('HH:mm'), $link.Url)
                Start-Process -FilePath $link.Url
                return $BylExitSetupPending
            }
            Start-MailHelper
            if (-not $Hidden -and -not $NoBrowser) { Open-Browser -ColdStart $false }
            return $BylExitOk
        }
    }
    return Start-Server -Port $Config.Port -Processes $look.Processes
}

function Send-ConsoleBreak {
    # Runs the console break of Get-ConsoleBreakCommand in a child PowerShell without window (the
    # child leaves its own console, so this one keeps its window). Returns the exit code of the
    # child (Resolve-BreakCode), -1 if it hung. While the child runs, the target is watched: once
    # it has ended, the break reached it, whatever the child still does (0; the child is ended).
    # The child needs a PowerShell start and a compiled type, about 0.5 s, some seconds under load
    # (up to 12 s seen on a busy CI runner), so it gets $BreakSenderSeconds.
    param([Parameter(Mandatory = $true)][int]$ProcessId)

    $target = Get-Process -Id $ProcessId -ErrorAction SilentlyContinue
    if ($null -eq $target) { return 0 }
    $startInfo = New-Object System.Diagnostics.ProcessStartInfo
    $startInfo.FileName = [System.IO.Path]::Combine($env:SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
    $startInfo.Arguments = '-NoProfile -NonInteractive -ExecutionPolicy Bypass -EncodedCommand ' + (Get-ConsoleBreakCommand -ProcessId $ProcessId)
    $startInfo.UseShellExecute = $false
    $startInfo.CreateNoWindow = $true
    $child = $null
    try {
        $child = [System.Diagnostics.Process]::Start($startInfo)
        $deadline = [DateTime]::UtcNow.AddSeconds($BreakSenderSeconds)
        while (-not $child.WaitForExit(100)) {
            $ended = $target.HasExited
            if ($ended -or [DateTime]::UtcNow -ge $deadline) {
                try { $child.Kill() } catch { $null = $_ }
                if ($ended) { return 0 }
                return -1
            }
        }
        return $child.ExitCode
    }
    finally {
        if ($null -ne $child) { $child.Dispose() }
        $target.Dispose()
    }
}

function Wait-ProcessExit {
    # True if the process $ProcessId has ended or ends within $Milliseconds.
    param([Parameter(Mandatory = $true)][int]$ProcessId, [Parameter(Mandatory = $true)][int]$Milliseconds)

    $process = Get-Process -Id $ProcessId -ErrorAction SilentlyContinue
    if ($null -eq $process) { return $true }
    try {
        return $process.WaitForExit($Milliseconds)
    }
    finally {
        $process.Dispose()
    }
}

function Stop-OwnProcess {
    # Stops the own processes of $Candidates through Stop-SelectedProcess (byl-functions.ps1): first
    # in order (Stop-Gracefully: console break, up to $StopGraceSeconds), only then hard with
    # Stop-Process -Force (TerminateProcess; SQLite in WAL mode treats that like a crash: committed
    # transactions survive, see README). Hard stops are added to $Forced; emits the failures as
    # single strings.
    param(
        [AllowEmptyCollection()][object[]]$Candidates,
        [Parameter(Mandatory = $true)][scriptblock]$Select,
        [Parameter(Mandatory = $true)][string]$Name,
        [Parameter(Mandatory = $true)][AllowEmptyCollection()][System.Collections.Generic.List[string]]$Forced
    )

    Stop-SelectedProcess -Candidates $Candidates -Select $Select -Name $Name -GetCurrent {
        param($processId)
        Get-CimInstance -ClassName Win32_Process -Filter "ProcessId = $([int]$processId)" -Property ProcessId, Name, ExecutablePath, CommandLine
    } -StopProcess {
        param($processId)
        $result = Stop-Gracefully -ProcessId $processId -GraceMilliseconds ($StopGraceSeconds * 1000) `
            -SendBreak { param($id) Send-ConsoleBreak -ProcessId $id } `
            -WaitExit { param($id, $milliseconds) Wait-ProcessExit -ProcessId $id -Milliseconds $milliseconds } `
            -Kill { param($id) Stop-Process -Id $id -Force } -Codes $script:BreakCodes
        if ($result -eq 'Forced') { $Forced.Add("$Name (PID $processId)") }
    } -StillRunningText 'läuft nach dem Beenden noch' -Report {
        param($Text)
        Write-Status $Text
    }
}

function Wait-PortFree {
    # True once nothing listens on 127.0.0.1:<Port> any more, at most $PortFreeTimeoutSeconds.
    param([Parameter(Mandatory = $true)][int]$Port)

    $deadline = [DateTime]::UtcNow.AddSeconds($PortFreeTimeoutSeconds)
    while ($true) {
        $listening = @(Get-ListenerSnapshot -Port $Port | Where-Object { [string]$_.LocalAddress -eq '127.0.0.1' })
        if ($listening.Count -eq 0) { return $true }
        if ([DateTime]::UtcNow -ge $deadline) { return $false }
        Start-Sleep -Milliseconds 250
    }
}

function Invoke-StopCore {
    # Stops the own mail helper first (so it reports no errors of a PocketBase that is gone), then
    # the own PocketBase; only processes whose program lies in this folder (Select-AppProcess,
    # Select-MailHelperProcess), never test instances or foreign processes, never by name. Waits
    # until the port is free and removes the state file. Returns 'Stopped', 'NotRunning' or
    # 'Failed' (the error is shown).
    param([Parameter(Mandatory = $true)][object]$Config)

    $snapshot = Get-ProcessSnapshot
    $own = @(Select-AppProcess -Process $snapshot -AppDir $AppDir)
    $state = ConvertFrom-BylState -Text (Read-TextFile -Path (Get-BylRunPath -AppDir $AppDir).State)
    # The helper runs with the address of the server it was started for: the port of the running
    # server, of the state file (server gone) or of the settings.
    $ports = New-Object System.Collections.Generic.List[int]
    foreach ($process in $own) {
        $port = Get-ServerProcessPort -Process $process
        if ($null -ne $port) { $ports.Add($port) }
    }
    if ($null -ne $state) { $ports.Add($state.Port) }
    $ports.Add($Config.Port)
    $urls = @($ports | Sort-Object -Unique | ForEach-Object { "http://127.0.0.1:$_" })
    $helpers = @(Select-MailHelperProcess -Process $snapshot -AppDir $AppDir -Url $urls)
    if ($own.Count -eq 0 -and $helpers.Count -eq 0) {
        Remove-StateFile
        Update-AddressFile -Port $Config.Port
        return 'NotRunning'
    }
    # The open tabs show "wurde beendet" instead of errors (ADR-0035 section 7); never waits.
    if ($own.Count -gt 0) {
        Set-BylAddress -Port $ports[0]
        Send-StopNotice
    }
    # Collected as single strings (Stop-SelectedProcess emits one per failure); empty means done.
    $failed = New-Object System.Collections.Generic.List[string]
    $forced = New-Object System.Collections.Generic.List[string]
    foreach ($line in @(Stop-OwnProcess -Candidates $helpers -Name 'byl-mail.exe' -Forced $forced -Select {
                param($Process) Select-MailHelperProcess -Process $Process -AppDir $AppDir -Url $urls
            })) { $failed.Add([string]$line) }
    foreach ($line in @(Stop-OwnProcess -Candidates $own -Name 'PocketBase' -Forced $forced -Select {
                param($Process) Select-AppProcess -Process $Process -AppDir $AppDir
            })) { $failed.Add([string]$line) }
    if ($forced.Count -gt 0) {
        Write-Notice ("Warnung: Nicht rechtzeitig geordnet beendet, daher hart beendet: " + ($forced -join ', ') + '.' +
            "`nBereits gespeicherte Änderungen bleiben erhalten (SQLite übernimmt sie beim nächsten Start).")
    }
    if ($failed.Count -gt 0) {
        Show-Message -Kind Error -Text ("becauseyoulovejira konnte nicht beendet werden:`n" + ($failed -join "`n"))
        return 'Failed'
    }
    foreach ($process in $own) {
        $port = Get-ServerProcessPort -Process $process
        if ($null -ne $port -and -not (Wait-PortFree -Port $port)) {
            Write-Notice "Hinweis: Port $port ist nach $PortFreeTimeoutSeconds s noch belegt."
        }
    }
    Remove-StateFile
    Update-AddressFile -Port $Config.Port
    return 'Stopped'
}

function Invoke-Stop {
    param([Parameter(Mandatory = $true)][object]$Config)

    $result = Invoke-StopCore -Config $Config
    $script:LogDetail = $result.ToLowerInvariant()
    if ($result -eq 'Failed') { return $BylExitError }
    if ($result -eq 'NotRunning') {
        Show-Message 'becauseyoulovejira läuft nicht.'
    }
    else {
        Show-Message 'becauseyoulovejira wurde beendet.'
    }
    return $BylExitOk
}

function Start-DetachedRestart {
    # restart -Detach (the page System of the app, ADR-0043). PocketBase cannot restart itself in
    # its own process, and a child in its console would get the console break of the stop. So this
    # starts "restart" of this folder as a process of its own and ends at once: Start-Process
    # without redirection goes through ShellExecuteEx, which gives the new Windows PowerShell its
    # own hidden console and hands on no handles, and Windows does not end a process with its
    # parent. The new process waits for this one (-WaitForProcess) before it stops the server, so
    # no other process shares the console of PocketBase when the break is sent. Its result goes to
    # byl-control.log like every restart.
    $powershell = [System.IO.Path]::Combine($env:SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
    $arguments = Get-DetachedRestartArgumentString -ScriptPath ([System.IO.Path]::Combine($AppDir, 'byl-control.ps1')) -WaitForProcess $PID
    try {
        $child = Start-Process -FilePath $powershell -ArgumentList $arguments -WorkingDirectory $AppDir -WindowStyle Hidden -PassThru
    }
    catch {
        Show-Message -Kind Error -Text "Der Neustart konnte nicht gestartet werden: $($_.Exception.Message)"
        return $BylExitError
    }
    $script:LogDetail = "detached=$($child.Id)"
    Write-Status "Neustart läuft im Hintergrund (PID $($child.Id)); das Ergebnis steht danach in logs\byl-control.log."
    return $BylExitOk
}

function Invoke-Restart {
    param([Parameter(Mandatory = $true)][object]$Config)

    if ($null -ne $Config.Problem) {
        Show-Message -Kind Error -Text (Get-ConfigProblemText -Problem $Config.Problem)
        return $BylExitError
    }
    if ($Detach) { return Start-DetachedRestart }
    if ($WaitForProcess -gt 0) {
        # Started by restart -Detach: the caller ends right after starting this process.
        [void](Wait-ProcessExit -ProcessId $WaitForProcess -Milliseconds ($CallerExitSeconds * 1000))
    }
    $look = Get-Look -Port $Config.Port
    if ($look.Own.Count -gt 0) {
        Write-Status 'Beende becauseyoulovejira für den Neustart ...'
        if ((Invoke-StopCore -Config $Config) -eq 'Failed') { return $BylExitError }
    }
    return Invoke-Start -Config $Config
}

function Get-StatusData {
    # Everything "status" and "reload" need from one look: state of the own instance, address,
    # mail helper, the comparison of the start fingerprint with the folder now, the owner of a busy
    # port, other copies and the autostart.
    param([Parameter(Mandatory = $true)][object]$Config)

    $look = Get-Look -Port $Config.Port
    $running = $look.ServerState -ne 'Stopped'
    $port = if ($null -ne $look.RunningPort) { [int]$look.RunningPort } else { [int]$Config.Port }
    $comparison = [pscustomobject]@{ Verdict = 'Current'; Restart = @(); Reload = @() }
    if ($running) {
        $started = if ($null -ne $look.State) { $look.State.Fingerprint } else { $null }
        # The environment hash with the key of this start; a key that cannot be read any more
        # (another account wrote it) counts as a change, a start without key (no DPAPI) as none.
        $environmentHash = ''
        if ($null -ne $started) {
            $key = Unprotect-EnvironmentKey -Protected $look.State.EnvironmentKey
            if ($null -ne $key) { $environmentHash = Get-EnvironmentFingerprint -Key $key }
            elseif (-not [string]::IsNullOrEmpty($started['environment'])) { $environmentHash = 'unreadable' }
        }
        $current = Get-BylFingerprint -AppDir $AppDir -Port $Config.Port -EnvironmentHash $environmentHash
        $comparison = Compare-BylFingerprint -Started $started -Current $current
    }
    $helpers = @(Select-MailHelperProcess -Process $look.Processes -AppDir $AppDir -Url @("http://127.0.0.1:$port"))
    $startedAt = $null
    if ($null -ne $look.State) {
        $startedAt = $look.State.StartedUtc
    }
    elseif ($running -and $null -ne $look.Own[0].CreationDate) {
        $startedAt = ([DateTime]$look.Own[0].CreationDate).ToUniversalTime()
    }
    $owner = $null
    if (-not $running -and $look.PortState.State -eq 'Foreign') {
        $owner = [pscustomobject]@{ pid = $look.PortState.ProcessId; name = $look.PortState.ProcessName; path = $look.PortState.ExecutablePath }
    }
    return [pscustomobject]@{
        ServerState  = $look.ServerState
        ProcessId    = if ($running) { [int]$look.Own[0].ProcessId } else { $null }
        Port         = $port
        Configured   = [int]$Config.Port
        StartedUtc   = $startedAt
        Comparison   = $comparison
        MailHelperId = if ($helpers.Count -gt 0) { [int]$helpers[0].ProcessId } else { $null }
        PortOwner    = $owner
        Others       = @(Select-OtherServerProcess -Process $look.Processes -AppDir $AppDir)
        Autostart    = Get-AutostartState
    }
}

function Get-VerdictText {
    # "aktuell", "nur neu laden (F5) ..." or "Neustart nötig – <Gründe>".
    param([Parameter(Mandatory = $true)][object]$Comparison)

    if ($Comparison.Verdict -eq 'Restart') {
        return 'Neustart nötig – ' + ((@($Comparison.Restart) | ForEach-Object { $RestartReasonText[$_] }) -join ', ')
    }
    if ($Comparison.Verdict -eq 'Reload') { return 'nur neu laden (F5 im offenen Tab) – Oberfläche neu gebaut' }
    return 'aktuell'
}

function Invoke-Status {
    param([Parameter(Mandatory = $true)][object]$Config)

    $data = Get-StatusData -Config $Config
    $code = Resolve-StatusExitCode -ServerState $data.ServerState -Verdict $data.Comparison.Verdict
    if ($Json) {
        $result = [ordered]@{
            state          = $data.ServerState.ToLowerInvariant()
            pid            = $data.ProcessId
            port           = $data.Port
            configuredPort = $data.Configured
            url            = "http://127.0.0.1:$($data.Port)/"
            startedUtc     = if ($null -ne $data.StartedUtc) { $data.StartedUtc.ToString('o') } else { $null }
            verdict        = $data.Comparison.Verdict.ToLowerInvariant()
            restartReasons = @($data.Comparison.Restart)
            reloadReasons  = @($data.Comparison.Reload)
            mailHelperPid  = $data.MailHelperId
            portOwner      = $data.PortOwner
            otherServers   = @($data.Others | ForEach-Object { [ordered]@{ pid = $_.ProcessId; path = $_.ExecutablePath; port = $_.Port; sameFolder = $_.SameFolder } })
            autostart      = $data.Autostart
            exitCode       = $code
        }
        Write-JsonLine ($result | ConvertTo-Json -Depth 4 -Compress)
        return $code
    }

    $label ={ param([string]$Name, [string]$Text) Write-Host ('  {0,-13} {1}' -f $Name, $Text) }
    Write-Host 'becauseyoulovejira – Status'
    switch ($data.ServerState) {
        'Running' {
            $since = if ($null -ne $data.StartedUtc) { ', gestartet ' + $data.StartedUtc.ToLocalTime().ToString('dd.MM.yyyy HH:mm') } else { '' }
            & $label 'Zustand:' "läuft (PID $($data.ProcessId)$since)"
        }
        'Starting' { & $label 'Zustand:' "startet gerade (PID $($data.ProcessId)), antwortet noch nicht" }
        'Unhealthy' { & $label 'Zustand:' "läuft (PID $($data.ProcessId)), antwortet aber nicht auf /api/health" }
        default { & $label 'Zustand:' 'läuft nicht' }
    }
    & $label 'Adresse:' "http://127.0.0.1:$($data.Port)/"
    if ($data.Configured -ne $data.Port) { & $label 'Eingestellt:' "Port $($data.Configured) (gilt nach einem Neustart)" }
    if ($data.ServerState -ne 'Stopped') {
        $helper = if ($null -ne $data.MailHelperId) { "läuft (PID $($data.MailHelperId))" } else { 'läuft nicht' }
        & $label 'Mail-Helfer:' $helper
        & $label 'Stand:' (Get-VerdictText -Comparison $data.Comparison)
    }
    elseif ($null -ne $data.PortOwner) {
        & $label 'Port:' "belegt durch $($data.PortOwner.name) (PID $($data.PortOwner.pid)) $($data.PortOwner.path)"
    }
    $autostart = switch ($data.Autostart) { 'on' { 'an' } 'other' { 'zeigt auf einen anderen Ordner (autostart-an.bat hier erneut ausführen)' } default { 'aus' } }
    & $label 'Autostart:' $autostart
    & $label 'Ordner:' $AppDir
    foreach ($other in $data.Others) {
        $kind = if ($other.SameFolder) { 'Testinstanz dieses Ordners mit anderem Datenordner' } else { 'andere Kopie' }
        $where = if ($null -ne $other.Port) { "Port $($other.Port)" } else { 'andere Adresse' }
        Write-Host "  Hinweis: $kind auf $where (PID $($other.ProcessId)) $($other.ExecutablePath); bleibt unberührt."
    }
    if ($code -eq $BylExitNotRunning) { Write-Host 'Starten: start.bat doppelklicken.' }
    elseif ($code -eq $BylExitUnhealthy) { Write-Host 'Neu starten: neu-starten.bat doppelklicken.' }
    elseif ($code -eq $BylExitRestartNeeded) { Write-Host 'Neustart: neu-starten.bat doppelklicken.' }
    return $code
}

function Invoke-Reload {
    # Restarts only if the running instance needs it (Resolve-ReloadAction), with -Force always.
    param([Parameter(Mandatory = $true)][object]$Config)

    if ($null -ne $Config.Problem) {
        Show-Message -Kind Error -Text (Get-ConfigProblemText -Problem $Config.Problem)
        return $BylExitError
    }
    $data = Get-StatusData -Config $Config
    $action = Resolve-ReloadAction -ServerState $data.ServerState -Verdict $data.Comparison.Verdict -Force $Force.IsPresent
    $script:LogDetail = "action=$($action.ToLowerInvariant())"
    if ($action -eq 'Nothing' -or $action -eq 'ReloadOnly') {
        # No restart, but the mail helper may be missing (a mailbox was switched on since the start).
        Set-BylAddress -Port $data.Port
        Start-MailHelper
        if ($action -eq 'Nothing') {
            Show-Message "Kein Neustart nötig: becauseyoulovejira ist aktuell (PID $($data.ProcessId), $BylAppUrl)."
        }
        else {
            Show-Message 'Kein Neustart nötig. Die Oberfläche wurde neu gebaut: im offenen Tab einmal neu laden (F5).'
        }
        return $BylExitOk
    }
    if ($action -eq 'Restart') {
        $why = if ($Force) { 'Neustart erzwungen (-Force)' }
        elseif ($data.ServerState -eq 'Unhealthy') { 'Neustart nötig – die App antwortet nicht' }
        else { Get-VerdictText -Comparison $data.Comparison }
        Write-Status "$why. Starte neu ..."
        if ((Invoke-StopCore -Config $Config) -eq 'Failed') { return $BylExitError }
    }
    elseif ($action -eq 'Start') {
        Write-Status 'becauseyoulovejira läuft nicht; starte ...'
    }
    return Invoke-Start -Config $Config
}

function Invoke-MailRestart {
    # Restarts the own mail helper (the page System of the app, ADR-0043): stops it in order like
    # stop (only byl-mail.exe of this folder with the address of the running instance, console
    # break first), then Start-MailHelper starts it again if its conditions hold (file, token,
    # switched-on mailbox). The helper needs the app: 3 if it does not run, 5 if it does not answer.
    param([Parameter(Mandatory = $true)][object]$Config)

    if ($null -ne $Config.Problem) {
        Show-Message -Kind Error -Text (Get-ConfigProblemText -Problem $Config.Problem)
        return $BylExitError
    }
    $look = Get-Look -Port $Config.Port
    if ($look.ServerState -eq 'Stopped') {
        Show-Message -Kind Error -Text 'becauseyoulovejira läuft nicht; der Mail-Hilfsprozess braucht die App. Starten mit start.bat.'
        return $BylExitNotRunning
    }
    if ($look.ServerState -ne 'Running') {
        Show-Message -Kind Error -Text "becauseyoulovejira (PID $($look.Own[0].ProcessId)) antwortet nicht. Neu starten: neu-starten.bat doppelklicken."
        return $BylExitUnhealthy
    }
    Set-BylAddress -Port $look.RunningPort
    $urls = @($BylMailHelperUrl)
    $helpers = @(Select-MailHelperProcess -Process $look.Processes -AppDir $AppDir -Url $urls)
    $failed = New-Object System.Collections.Generic.List[string]
    $forced = New-Object System.Collections.Generic.List[string]
    foreach ($line in @(Stop-OwnProcess -Candidates $helpers -Name 'byl-mail.exe' -Forced $forced -Select {
                param($Process) Select-MailHelperProcess -Process $Process -AppDir $AppDir -Url $urls
            })) { $failed.Add([string]$line) }
    if ($forced.Count -gt 0) {
        Write-Notice ('Warnung: Nicht rechtzeitig geordnet beendet, daher hart beendet: ' + ($forced -join ', ') + '.')
    }
    if ($failed.Count -gt 0) {
        Show-Message -Kind Error -Text ("Der Mail-Hilfsprozess konnte nicht beendet werden:`n" + ($failed -join "`n"))
        return $BylExitError
    }
    Start-MailHelper
    $script:LogDetail = "stopped=$($helpers.Count) helper=$($script:MailHelperDecision.ToLowerInvariant())"
    $text = switch ($script:MailHelperDecision) {
        'Start' { 'Mail-Hilfsprozess neu gestartet.' }
        'Running' { 'Der Mail-Hilfsprozess läuft.' }
        'NoHelper' { 'byl-mail.exe fehlt im Ordner der App; es gibt keinen Mail-Hilfsprozess.' }
        'NoToken' { 'Der Zugang für byl-mail.exe fehlt; er entsteht beim nächsten Start (neu-starten.bat).' }
        'NoRoute' { 'byl-mail.exe startet erst nach einem Neustart der App (neu-starten.bat).' }
        'NoConnection' { 'Kein Postfach ist eingeschaltet; der Mail-Hilfsprozess wird nicht gebraucht.' }
        default { 'Der Mail-Hilfsprozess konnte nicht gestartet werden; Einzelheiten in logs\byl-mail.err.log.' }
    }
    Show-Message $text
    return $BylExitOk
}

function Invoke-Open {
    # Opens the running app (installed app or tab, ADR-0035); with -NoBrowser only the address.
    param([Parameter(Mandatory = $true)][object]$Config)

    $look = Get-Look -Port $Config.Port
    if ($look.ServerState -eq 'Stopped') {
        Show-Message -Kind Error -Text 'becauseyoulovejira läuft nicht. Starten mit start.bat.'
        return $BylExitNotRunning
    }
    Set-BylAddress -Port $look.RunningPort
    if ($look.ServerState -ne 'Running') {
        Show-Message -Kind Error -Text "becauseyoulovejira (PID $($look.Own[0].ProcessId)) antwortet nicht. Neu starten: neu-starten.bat doppelklicken."
        return $BylExitUnhealthy
    }
    if ($Hidden -or $NoBrowser) {
        Show-Message "becauseyoulovejira läuft: $BylAppUrl"
        return $BylExitOk
    }
    Open-Browser -ColdStart $false
    return $BylExitOk
}

function Get-LogSecretValue {
    # Values of the BYL_* variables of the account and of this process, which logs -Json removes
    # from every line (Protect-LogText). Only in memory, never printed.
    $scope = Get-BylVariableScope
    $values = New-Object System.Collections.Generic.List[string]
    foreach ($table in @($scope.User, $scope.Machine, [Environment]::GetEnvironmentVariables('Process'))) {
        foreach ($variable in @($table.Keys)) {
            if ([string]$variable -match $BylSecretNamePattern) { $values.Add([string]$table[$variable]) }
        }
    }
    return , $values.ToArray()
}

function Get-LogsJson {
    # logs -Json (the page System of the app, ADR-0043): per log the files with size, time of the
    # last change and the last $Lines lines, each without the values of the BYL_* variables.
    param(
        [Parameter(Mandatory = $true)][string]$LogDir,
        [Parameter(Mandatory = $true)][System.Collections.Specialized.OrderedDictionary]$Sets,
        [Parameter(Mandatory = $true)][string[]]$Names
    )

    $secrets = Get-LogSecretValue
    $logs = foreach ($set in $Names) {
        $files = foreach ($file in $Sets[$set]) {
            $path = [System.IO.Path]::Combine($LogDir, $file)
            if (-not [System.IO.File]::Exists($path)) {
                [ordered]@{ file = $file; exists = $false; sizeBytes = 0; modifiedUtc = $null; lines = @() }
                continue
            }
            $info = New-Object System.IO.FileInfo($path)
            # Get-LogTailLines emits its array as one object; ForEach-Object goes through its lines.
            $tail = @(Get-LogTailLines -Text (Read-TextFile -Path $path) -Count $Lines | ForEach-Object { $_ } |
                    ForEach-Object { Protect-LogText -Text $_ -Secrets $secrets })
            [ordered]@{ file = $file; exists = $true; sizeBytes = $info.Length; modifiedUtc = $info.LastWriteTimeUtc.ToString('o'); lines = $tail }
        }
        [ordered]@{ name = $set; files = @($files) }
    }
    return ConvertTo-Json -InputObject ([ordered]@{ lines = $Lines; logs = @($logs) }) -Depth 6 -Compress
}

function Invoke-Logs {
    # Last lines of the logs (the programs log counts and cleaned errors only, never values of
    # variables or contents); -Follow follows one log until Ctrl+C, -Json gives them to the page
    # System of the app.
    $logDir = [System.IO.Path]::Combine($AppDir, 'logs')
    $sets = [ordered]@{
        server = @('pocketbase.out.log', 'pocketbase.err.log')
        mail   = @('byl-mail.log', 'byl-mail.err.log')
        skript = @('byl-control.log')
    }
    $name = if ([string]::IsNullOrWhiteSpace($Value)) { 'alle' } else { $Value.Trim().ToLowerInvariant() }
    if ($name -ne 'alle' -and -not $sets.Contains($name)) {
        Show-Message -Kind Error -Text "Unbekanntes Log „$Value“. Erlaubt: server, mail, skript oder alle."
        return $BylExitError
    }
    if ($Json) {
        if ($Follow) {
            Show-Message -Kind Error -Text '-Follow und -Json gehen nicht zusammen.'
            return $BylExitError
        }
        $names = if ($name -eq 'alle') { @($sets.Keys) } else { @($name) }
        Write-JsonLine (Get-LogsJson -LogDir $logDir -Sets $sets -Names $names)
        return $BylExitOk
    }
    if ($Follow) {
        if ($name -eq 'alle') {
            Show-Message -Kind Error -Text '-Follow folgt genau einem Log: server, mail oder skript.'
            return $BylExitError
        }
        $path = [System.IO.Path]::Combine($logDir, $sets[$name][0])
        if (-not [System.IO.File]::Exists($path)) {
            Show-Message -Kind Error -Text "Das Log gibt es noch nicht:`n$path"
            return $BylExitError
        }
        Write-Host "Folge $path (Strg+C beendet) ..."
        Get-Content -LiteralPath $path -Tail $Lines -Wait | Out-Host
        return $BylExitOk
    }
    $names = if ($name -eq 'alle') { @($sets.Keys) } else { @($name) }
    foreach ($set in $names) {
        foreach ($file in $sets[$set]) {
            $path = [System.IO.Path]::Combine($logDir, $file)
            if (-not [System.IO.File]::Exists($path)) {
                Write-Host "== logs\$file (noch nicht vorhanden)"
                continue
            }
            $info = New-Object System.IO.FileInfo($path)
            Write-Host ('== logs\{0} ({1:N0} KB, geändert {2})' -f $file, [Math]::Ceiling($info.Length / 1KB), $info.LastWriteTime.ToString('dd.MM.yyyy HH:mm'))
            foreach ($line in (Get-LogTailLines -Text (Read-TextFile -Path $path) -Count $Lines)) { Write-Host $line }
        }
    }
    return $BylExitOk
}

function Test-WriteAccess {
    # True if a file can be created and deleted in $Folder (created if missing).
    param([Parameter(Mandatory = $true)][string]$Folder)

    try {
        [void][System.IO.Directory]::CreateDirectory($Folder)
        $probe = [System.IO.Path]::Combine($Folder, ".byl-write-$([guid]::NewGuid().ToString('N')).tmp")
        [System.IO.File]::WriteAllText($probe, 'x')
        [System.IO.File]::Delete($probe)
        return $true
    }
    catch {
        return $false
    }
}

function Invoke-Doctor {
    # Checks before a start (ADR-0039 section 7); 0 without an error, 1 otherwise.
    param([Parameter(Mandatory = $true)][object]$Config)

    $checks = New-Object System.Collections.Generic.List[object]
    $add = { param([string]$Name, [string]$Level, [string]$Text) $checks.Add([pscustomobject]@{ name = $Name; level = $Level; text = $Text }) }

    $exe = [System.IO.Path]::Combine($AppDir, 'pocketbase.exe')
    if ([System.IO.File]::Exists($exe)) { & $add 'pocketbase' 'ok' 'pocketbase.exe vorhanden' }
    else { & $add 'pocketbase' 'error' 'pocketbase.exe fehlt: scripts\fetch-pocketbase.ps1 ausführen' }
    foreach ($folder in @('pb_hooks', 'pb_migrations')) {
        if ([System.IO.Directory]::Exists([System.IO.Path]::Combine($AppDir, $folder))) { & $add $folder 'ok' "$folder vorhanden" }
        else { & $add $folder 'error' "$folder fehlt: der Ordner app ist unvollständig" }
    }
    if ([System.IO.File]::Exists([System.IO.Path]::Combine($AppDir, 'pb_public', 'index.html'))) { & $add 'web' 'ok' 'Oberfläche gebaut (pb_public)' }
    else { & $add 'web' 'warning' 'Oberfläche fehlt (pb_public\index.html): scripts\build.ps1 ausführen' }
    if ($null -ne $Config.Problem) { & $add 'config' 'error' (Get-ConfigProblemText -Problem $Config.Problem) }
    else { & $add 'config' 'ok' "Port $($Config.Port)" }

    $look = Get-Look -Port $Config.Port
    switch ($look.ServerState) {
        'Running' { & $add 'instance' 'ok' "läuft (PID $($look.Own[0].ProcessId), Port $($look.RunningPort))" }
        'Starting' { & $add 'instance' 'warning' "startet gerade (PID $($look.Own[0].ProcessId))" }
        'Unhealthy' { & $add 'instance' 'error' "läuft (PID $($look.Own[0].ProcessId)), antwortet aber nicht: neu-starten.bat" }
        default { & $add 'instance' 'info' 'läuft nicht' }
    }
    switch ($look.PortState.State) {
        'Free' { & $add 'port' 'ok' "Port $($Config.Port) ist frei" }
        'App' { & $add 'port' 'ok' "Port $($Config.Port) gehört der eigenen Instanz" }
        default {
            $level = if ($look.ServerState -eq 'Stopped') { 'error' } else { 'warning' }
            & $add 'port' $level ("Port $($Config.Port) belegt durch $($look.PortState.ProcessName) (PID $($look.PortState.ProcessId)) $($look.PortState.ExecutablePath)").Trim()
        }
    }
    foreach ($folder in @('logs', 'run', 'pb_data')) {
        $path = [System.IO.Path]::Combine($AppDir, $folder)
        if ($folder -eq 'pb_data' -and -not [System.IO.Directory]::Exists($path)) {
            & $add 'write-pb_data' 'info' 'pb_data gibt es noch nicht (der erste Start legt es an)'
            continue
        }
        if (Test-WriteAccess -Folder $path) { & $add "write-$folder" 'ok' "$folder beschreibbar" }
        else { & $add "write-$folder" 'error' "$folder ist nicht beschreibbar" }
    }
    try {
        $drive = New-Object System.IO.DriveInfo([System.IO.Path]::GetPathRoot($AppDir))
        $free = $drive.AvailableFreeSpace
        $level = switch (Get-DiskVerdict -FreeBytes $free) { 'Critical' { 'error' } 'Low' { 'warning' } default { 'ok' } }
        & $add 'disk' $level ('{0:N0} MB frei auf {1}' -f ($free / 1MB), $drive.Name)
    }
    catch {
        & $add 'disk' 'warning' 'freier Platz nicht ermittelbar'
    }
    $others = @(Select-OtherServerProcess -Process $look.Processes -AppDir $AppDir)
    if ($others.Count -eq 0) { & $add 'copies' 'ok' 'keine andere Kopie läuft' }
    foreach ($other in $others) {
        $kind = if ($other.SameFolder) { 'Testinstanz dieses Ordners' } else { 'andere Kopie' }
        $where = if ($null -ne $other.Port) { "Port $($other.Port)" } else { 'andere Adresse' }
        & $add 'copies' 'info' "$kind auf $where (PID $($other.ProcessId)) $($other.ExecutablePath); bleibt unberührt"
    }
    $helper = [System.IO.File]::Exists([System.IO.Path]::Combine($AppDir, $BylMailHelperName))
    $token = -not [string]::IsNullOrWhiteSpace([string](Get-BylVariableScope).User[$BylIngestTokenName])
    $mailText = if (-not $helper) { 'byl-mail.exe nicht vorhanden (nur für Postfächer nötig)' }
    elseif ($token) { 'byl-mail.exe und BYL_INGEST_TOKEN vorhanden' }
    else { 'byl-mail.exe vorhanden; BYL_INGEST_TOKEN legt der nächste Start an' }
    & $add 'mail' 'info' $mailText
    switch (Get-AutostartState) {
        'on' { & $add 'autostart' 'info' 'Autostart an' }
        'other' { & $add 'autostart' 'warning' 'Autostart zeigt auf einen anderen Ordner: autostart-an.bat hier erneut ausführen' }
        default { & $add 'autostart' 'info' 'Autostart aus' }
    }
    & $add 'powershell' 'info' "Windows PowerShell $($PSVersionTable.PSVersion)"

    $failed = @($checks | Where-Object { $_.level -eq 'error' }).Count
    $code = if ($failed -gt 0) { $BylExitError } else { $BylExitOk }
    if ($Json) {
        Write-JsonLine ([ordered]@{ appDir = $AppDir; ok = ($failed -eq 0); checks = @($checks.ToArray()) } | ConvertTo-Json -Depth 4 -Compress)
        return $code
    }
    $tags = @{ ok = '[OK]      '; warning = '[WARNUNG] '; error = '[FEHLER]  '; info = '[INFO]    ' }
    Write-Host "becauseyoulovejira – Prüfung (Ordner: $AppDir)"
    foreach ($check in $checks) {
        $color = switch ($check.level) { 'error' { 'Red' } 'warning' { 'Yellow' } default { 'Gray' } }
        Write-Host ($tags[$check.level] + $check.text) -ForegroundColor $color
    }
    if ($failed -gt 0) { Write-Host "$failed Fehler gefunden." -ForegroundColor Red } else { Write-Host 'Keine Fehler gefunden.' }
    return $code
}

function Invoke-Port {
    param([Parameter(Mandatory = $true)][object]$Config)

    if ([string]::IsNullOrWhiteSpace($Value)) {
        if ($null -ne $Config.Problem) {
            Show-Message -Kind Error -Text (Get-ConfigProblemText -Problem $Config.Problem)
            return $BylExitError
        }
        $source = if ([System.IO.File]::Exists((Get-BylConfigPath -AppDir $AppDir))) { $BylConfigName } else { 'Standard' }
        Show-Message ("Port: $($Config.Port) ($source), Adresse: http://127.0.0.1:$($Config.Port)/`n" +
            "Umstellen: $ControlCall port <Zahl>   (zurück zum Standard: port $BylDefaultPort)")
        return $BylExitOk
    }
    $port = ConvertTo-PortNumber -Text $Value
    if ($null -eq $port) {
        Show-Message -Kind Error -Text "„$Value“ ist kein gültiger Port. Erlaubt sind ganze Zahlen von $BylPortMin bis $BylPortMax."
        return $BylExitError
    }
    if ($null -eq $Config.Problem -and $port -eq $Config.Port) {
        Show-Message "Port $port ist bereits eingestellt."
        return $BylExitOk
    }
    $look = Get-Look -Port $port
    if ($look.PortState.State -eq 'Foreign') {
        Show-Message -Kind Error -Text (Get-PortBusyText -Port $port -PortState $look.PortState)
        return $BylExitPortBusy
    }
    try {
        # The backup settings in the same file stay as they are (ADR-0046).
        $configPath = Get-BylConfigPath -AppDir $AppDir
        Write-TextFile -Path $configPath -Text (Merge-BylConfigText -Text (Read-TextFile -Path $configPath) -Port $port)
    }
    catch {
        Show-Message -Kind Error -Text "$BylConfigName konnte nicht geschrieben werden: $($_.Exception.Message)"
        return $BylExitError
    }
    $script:LogDetail = "port=$port"
    $text = "Port $port eingestellt ($BylConfigName). Neue Adresse: http://127.0.0.1:$port/"
    if ($look.Own.Count -gt 0) {
        $text += "`nDie App läuft noch auf Port $($look.RunningPort); die neue Adresse gilt nach einem Neustart (neu-starten.bat)."
    }
    else {
        Update-AddressFile -Port $port
    }
    $text += ("`nBitte anpassen: Lesezeichen, die installierte App (unter der neuen Adresse neu installieren) und die App-Adresse" +
        "`nin der Browser-Erweiterung für WhatsApp Web. Die Anmeldung gilt je Adresse: unter der neuen einmal neu anmelden.")
    Show-Message $text
    return $BylExitOk
}

function Get-StartupFolderOrFail {
    # The startup folder for autostart-on and autostart-off; $null after an error message if a test
    # copy has no folder of its own (Get-StartupFolder).
    $startup = Get-StartupFolder
    if ($null -eq $startup) {
        Show-Message -Kind Error -Text 'Autostart ist in dieser Testkopie gesperrt: Es fehlt ein eigener Ordner (BYL_TEST_STARTUP_DIR).'
    }
    return $startup
}

function Invoke-AutostartOn {
    $vbs = [System.IO.Path]::Combine($AppDir, 'start-hidden.vbs')
    if (-not (Test-Path -LiteralPath $vbs -PathType Leaf)) {
        Show-Message -Kind Error -Text "start-hidden.vbs fehlt in:`n$AppDir"
        return $BylExitError
    }
    $startup = Get-StartupFolderOrFail
    if ($null -eq $startup) { return $BylExitError }
    $spec = Get-AutostartShortcut -AppDir $AppDir -StartupDir $startup -SystemDir ([Environment]::SystemDirectory)
    # The shortcut has one name for every copy of the app: one of another folder is replaced.
    $before = Get-AutostartState
    try {
        $shortcut = (New-Object -ComObject WScript.Shell).CreateShortcut($spec.Path)
        $shortcut.TargetPath = $spec.TargetPath
        $shortcut.Arguments = $spec.Arguments
        $shortcut.WorkingDirectory = $spec.WorkingDirectory
        $shortcut.Description = 'becauseyoulovejira im Hintergrund starten'
        $shortcut.Save()
    }
    catch {
        Show-Message -Kind Error -Text "Autostart konnte nicht eingerichtet werden: $($_.Exception.Message)"
        return $BylExitError
    }
    $text = "Autostart aktiviert (startet diesen Ordner bei der Anmeldung ohne Fenster):`n$($spec.Path)"
    if ($before -eq 'other') { $text += "`nDie bisherige Verknüpfung zeigte auf einen anderen Ordner und wurde ersetzt." }
    Show-Message $text
    return $BylExitOk
}

function Invoke-AutostartOff {
    $startup = Get-StartupFolderOrFail
    if ($null -eq $startup) { return $BylExitError }
    $spec = Get-AutostartShortcut -AppDir $AppDir -StartupDir $startup -SystemDir ([Environment]::SystemDirectory)
    if (-not (Test-Path -LiteralPath $spec.Path -PathType Leaf)) {
        Show-Message 'Autostart ist nicht aktiviert.'
        return $BylExitOk
    }
    try {
        Remove-Item -LiteralPath $spec.Path -Force
    }
    catch {
        Show-Message -Kind Error -Text "Autostart konnte nicht entfernt werden: $($_.Exception.Message)"
        return $BylExitError
    }
    Show-Message 'Autostart deaktiviert.'
    return $BylExitOk
}

# --- Backup (ADR-0046) ---------------------------------------------------------------------------
# The app (lib/backup-service.js) runs these commands with -Json and gives their parameters as one
# JSON object on standard input; nothing of a request reaches the command line. The passphrase is
# kept with DPAPI for this Windows account outside the app folder; the values of the BYL_*
# variables are read from the account and go only into encrypted backups, through byl-backup.exe.

# Entropy of the DPAPI blob of the passphrase: no other DPAPI blob of the account opens with it.
$PassphraseEntropy = [System.Text.Encoding]::UTF8.GetBytes('becauseyoulovejira-sicherung')
# A seal or open of a large backup may take long; a helper that hangs is ended after this.
$BackupHelperSeconds = 3600

function Read-InputJson {
    # The JSON object a program gives on standard input (UTF-8, whatever the code page, at most
    # 1 MB); $null for a call from the console or without input.
    if (-not [Console]::IsInputRedirected) { return $null }
    $stream = [Console]::OpenStandardInput()
    $buffer = New-Object System.IO.MemoryStream
    try {
        $chunk = New-Object byte[] 65536
        while (($read = $stream.Read($chunk, 0, $chunk.Length)) -gt 0) {
            $buffer.Write($chunk, 0, $read)
            if ($buffer.Length -gt 1MB) { throw 'Die Eingabe ist zu groß.' }
        }
        $text = (New-Object System.Text.UTF8Encoding($false)).GetString($buffer.ToArray())
    }
    finally {
        $buffer.Dispose()
    }
    if ([string]::IsNullOrWhiteSpace($text)) { return $null }
    $value = $text | ConvertFrom-Json
    if ($value -isnot [System.Management.Automation.PSCustomObject]) { throw 'Die Eingabe ist kein JSON-Objekt.' }
    return $value
}

function Get-InputValue {
    # Value of the property $Name of the input (strict mode forbids missing properties); $null.
    param([AllowNull()][object]$InputObject, [Parameter(Mandatory = $true)][string]$Name)

    if ($null -eq $InputObject) { return $null }
    $property = $InputObject.PSObject.Properties[$Name]
    if ($null -eq $property) { return $null }
    return $property.Value
}

function Write-BackupAnswer {
    # The answer of a backup command: one JSON line with -Json, otherwise $Text (an error in red).
    # Returns the exit code: 0 with ok, 1 otherwise.
    param([Parameter(Mandatory = $true)][System.Collections.IDictionary]$Answer, [Parameter(Mandatory = $true)][string]$Text)

    $ok = $Answer['ok'] -eq $true
    if ($Json) {
        Write-JsonLine (ConvertTo-Json -InputObject $Answer -Depth 6 -Compress)
    }
    elseif ($ok) {
        Show-Message $Text
    }
    else {
        Show-Message -Kind Error -Text $Text
    }
    if ($ok) { return $BylExitOk }
    return $BylExitError
}

function Get-PassphraseFile {
    # The file of the passphrase of this folder (Get-BylPassphrasePath) under
    # %LOCALAPPDATA%\becauseyoulovejira. An isolated test copy uses only the folder of the test in
    # BYL_TEST_SECRET_DIR, or none ($null), so no test touches the files of the account.
    if ($IsolatedEnvironment) {
        $base = [Environment]::GetEnvironmentVariable('BYL_TEST_SECRET_DIR', 'Process')
        if ([string]::IsNullOrWhiteSpace($base)) { return $null }
    }
    else {
        $base = [System.IO.Path]::Combine([Environment]::GetFolderPath('LocalApplicationData'), 'becauseyoulovejira')
    }
    return Get-BylPassphrasePath -AppDir $AppDir -BaseDir $base
}

function Read-StoredPassphrase {
    # The passphrase for unattended backups: State 'Set' (with Value, only in memory), 'Missing',
    # 'Unreadable' (another account or machine wrote it) or 'Unavailable' (a test copy without a
    # folder for it).
    $path = Get-PassphraseFile
    if ($null -eq $path) { return [pscustomobject]@{ State = 'Unavailable'; Value = $null } }
    if (-not [System.IO.File]::Exists($path)) { return [pscustomobject]@{ State = 'Missing'; Value = $null } }
    try {
        Add-Type -AssemblyName System.Security
        $protected = [Convert]::FromBase64String((Read-SharedText -Path $path).Trim())
        $bytes = [System.Security.Cryptography.ProtectedData]::Unprotect($protected, $PassphraseEntropy, 'CurrentUser')
        try {
            $value = (New-Object System.Text.UTF8Encoding($false, $true)).GetString($bytes)
        }
        finally {
            [Array]::Clear($bytes, 0, $bytes.Length)
        }
        return [pscustomobject]@{ State = 'Set'; Value = $value }
    }
    catch {
        return [pscustomobject]@{ State = 'Unreadable'; Value = $null }
    }
}

function Save-StoredPassphrase {
    # Keeps $Passphrase with DPAPI for this Windows account (CurrentUser) in Get-PassphraseFile.
    param([Parameter(Mandatory = $true)][string]$Passphrase)

    $path = Get-PassphraseFile
    if ($null -eq $path) { throw 'Diese Testkopie hat keinen Ordner für die Passphrase (BYL_TEST_SECRET_DIR).' }
    Add-Type -AssemblyName System.Security
    $bytes = (New-Object System.Text.UTF8Encoding($false)).GetBytes($Passphrase)
    try {
        $protected = [System.Security.Cryptography.ProtectedData]::Protect($bytes, $PassphraseEntropy, 'CurrentUser')
    }
    finally {
        [Array]::Clear($bytes, 0, $bytes.Length)
    }
    Write-TextFile -Path $path -Text ([Convert]::ToBase64String($protected))
}

function Get-FreeBytes {
    # Bytes this account may still write on the drive or share of the folder $Path
    # (GetDiskFreeSpaceEx, also for UNC paths); $null if Windows cannot tell.
    param([Parameter(Mandatory = $true)][string]$Path)

    if (-not ('Byl.DiskSpace' -as [type])) {
        Add-Type -Namespace Byl -Name DiskSpace -MemberDefinition (
            '[DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] ' +
            'public static extern bool GetDiskFreeSpaceEx(string directory, out ulong freeForCaller, out ulong total, out ulong totalFree);')
    }
    $free = [uint64]0
    $total = [uint64]0
    $totalFree = [uint64]0
    if ([Byl.DiskSpace]::GetDiskFreeSpaceEx($Path.TrimEnd('\') + '\', [ref]$free, [ref]$total, [ref]$totalFree)) { return [double]$free }
    return $null
}

function Get-BackupSettings {
    # The backup settings of byl-config.json (ConvertFrom-BylBackupConfig).
    return ConvertFrom-BylBackupConfig -Text (Read-TextFile -Path (Get-BylConfigPath -AppDir $AppDir))
}

function Test-SameDrive {
    # Whether $Path lies on the drive or share of the app folder (a target there does not help
    # against a broken disk; only a hint).
    param([Parameter(Mandatory = $true)][string]$Path)

    return [string]::Equals([System.IO.Path]::GetPathRoot($Path), [System.IO.Path]::GetPathRoot($AppDir), [System.StringComparison]::OrdinalIgnoreCase)
}

function Get-TargetCheck {
    # Checks the target folder $Path (ADR-0046 section 2): format and place (Test-BylBackupTarget),
    # existence, write access (with -WriteProbe a file that is deleted again) and free space for
    # $NeededBytes. Problem: $null or 'Format', 'TooLong', 'InsideApp', 'Missing', 'NotWritable',
    # 'Space'; FreeBytes and SameDrive as information.
    param([Parameter(Mandatory = $true)][string]$Path, [double]$NeededBytes = 0, [switch]$WriteProbe)

    $result = [ordered]@{ Problem = $null; FreeBytes = $null; SameDrive = $false }
    $result.Problem = Test-BylBackupTarget -Path $Path -AppDir $AppDir
    if ($null -ne $result.Problem) { return [pscustomobject]$result }
    $folder = $Path.Trim()
    $result.SameDrive = Test-SameDrive -Path $folder
    if (-not [System.IO.Directory]::Exists($folder)) {
        $result.Problem = 'Missing'
        return [pscustomobject]$result
    }
    if ($WriteProbe -and -not (Test-WriteAccess -Folder $folder)) {
        $result.Problem = 'NotWritable'
        return [pscustomobject]$result
    }
    $result.FreeBytes = Get-FreeBytes -Path $folder
    if ($null -ne $result.FreeBytes -and (Get-BylBackupSpaceVerdict -FreeBytes $result.FreeBytes -NeededBytes $NeededBytes) -ne 'Ok') {
        $result.Problem = 'Space'
    }
    return [pscustomobject]$result
}

function Get-BylCommit {
    # The commit of this folder when it is part of a checkout of the repository (a worktree as
    # well), the first 7 characters; $null otherwise. For the manifest of a backup only.
    try {
        $root = [System.IO.Path]::GetDirectoryName($AppDir)
        $gitDir = [System.IO.Path]::Combine($root, '.git')
        if ([System.IO.File]::Exists($gitDir)) {
            if ((Read-SharedText -Path $gitDir).Trim() -notmatch '^gitdir: (.+)$') { return $null }
            $gitDir = [System.IO.Path]::GetFullPath([System.IO.Path]::Combine($root, $Matches[1].Trim()))
        }
        if (-not [System.IO.Directory]::Exists($gitDir)) { return $null }
        $head = (Read-SharedText -Path ([System.IO.Path]::Combine($gitDir, 'HEAD'))).Trim()
        if ($head -match '^[0-9a-f]{40}$') { return $head.Substring(0, 7) }
        if ($head -notmatch '^ref: (refs/\S+)$') { return $null }
        $ref = $Matches[1]
        $common = $gitDir
        $commonFile = [System.IO.Path]::Combine($gitDir, 'commondir')
        if ([System.IO.File]::Exists($commonFile)) {
            $common = [System.IO.Path]::GetFullPath([System.IO.Path]::Combine($gitDir, (Read-SharedText -Path $commonFile).Trim()))
        }
        $refFile = [System.IO.Path]::Combine($common, $ref.Replace('/', '\'))
        if ([System.IO.File]::Exists($refFile)) {
            $hash = (Read-SharedText -Path $refFile).Trim()
            if ($hash -match '^[0-9a-f]{40}$') { return $hash.Substring(0, 7) }
            return $null
        }
        $packed = [System.IO.Path]::Combine($common, 'packed-refs')
        if (-not [System.IO.File]::Exists($packed)) { return $null }
        foreach ($line in ((Read-SharedText -Path $packed) -split "`r?`n")) {
            if ($line -match "^([0-9a-f]{40}) $([regex]::Escape($ref))$") { return $Matches[1].Substring(0, 7) }
        }
        return $null
    }
    catch {
        return $null
    }
}

function Invoke-BackupHelper {
    # Runs byl-backup.exe of this folder with the command $Command; its parameters go as JSON on
    # standard input, never on the command line, and its environment has no BYL_* variable. Returns
    # the parsed answer; a helper that is missing, hangs or prints no JSON gives ok = false with the
    # reason 'helper'.
    param([Parameter(Mandatory = $true)][ValidateSet('seal', 'open', 'check')][string]$Command, [Parameter(Mandatory = $true)][System.Collections.IDictionary]$Parameters)

    $helper = [System.IO.Path]::Combine($AppDir, $BylBackupHelperName)
    if (-not [System.IO.File]::Exists($helper)) { return [pscustomobject]@{ ok = $false; reason = 'helper' } }
    $startInfo = New-Object System.Diagnostics.ProcessStartInfo
    $startInfo.FileName = $helper
    $startInfo.Arguments = $Command
    $startInfo.UseShellExecute = $false
    $startInfo.CreateNoWindow = $true
    $startInfo.RedirectStandardInput = $true
    $startInfo.RedirectStandardOutput = $true
    $startInfo.RedirectStandardError = $true
    $startInfo.StandardOutputEncoding = New-Object System.Text.UTF8Encoding($false)
    $startInfo.WorkingDirectory = $AppDir
    foreach ($name in @($startInfo.EnvironmentVariables.Keys)) {
        if ([string]$name -like 'BYL_*' -or [string]$name -like 'NODE_*') { $startInfo.EnvironmentVariables.Remove($name) }
    }
    $process = [System.Diagnostics.Process]::Start($startInfo)
    try {
        $output = $process.StandardOutput.ReadToEndAsync()
        $errors = $process.StandardError.ReadToEndAsync()
        $bytes = (New-Object System.Text.UTF8Encoding($false)).GetBytes((ConvertTo-Json -InputObject $Parameters -Depth 10 -Compress))
        try {
            $process.StandardInput.BaseStream.Write($bytes, 0, $bytes.Length)
            $process.StandardInput.Close()
        }
        finally {
            [Array]::Clear($bytes, 0, $bytes.Length)
        }
        if (-not $process.WaitForExit($BackupHelperSeconds * 1000)) {
            try { $process.Kill() } catch { $null = $_ }
            return [pscustomobject]@{ ok = $false; reason = 'helper' }
        }
        $process.WaitForExit()
        [void]$errors.Result
        $line = @($output.Result -split "`r?`n" | Where-Object { $_.Trim() -ne '' } | Select-Object -Last 1)
        try {
            $answer = if ($line.Count -gt 0) { $line[0] | ConvertFrom-Json } else { $null }
        }
        catch {
            $answer = $null
        }
        if ($null -eq $answer -or $null -eq $answer.PSObject.Properties['ok']) { return [pscustomobject]@{ ok = $false; reason = 'helper' } }
        return $answer
    }
    finally {
        $process.Dispose()
    }
}

function Get-SettingsAnswer {
    # The backup settings as the app reads them.
    param([Parameter(Mandatory = $true)][object]$Settings)

    return [ordered]@{
        target      = $Settings.Target
        daily       = $Settings.Daily
        weekly      = $Settings.Weekly
        monthly     = $Settings.Monthly
        credentials = $Settings.Credentials
    }
}

function Invoke-BackupInfo {
    # backup-info: settings, target (exists, free space, same drive), passphrase, helper and the
    # names of the BYL_* variables a backup takes along. Only reads; never a value.
    $settings = Get-BackupSettings
    $passphrase = (Read-StoredPassphrase).State
    $target = $null
    if ($null -ne $settings.Target) {
        $check = Get-TargetCheck -Path $settings.Target
        $target = [ordered]@{
            path      = $settings.Target
            reachable = $check.Problem -ne 'Missing'
            problem   = if ($null -eq $check.Problem) { $null } else { $TargetProblemCode[$check.Problem] }
            freeBytes = $check.FreeBytes
            sameDrive = $check.SameDrive
        }
    }
    $names = @((Select-BylSecretVariable -Variables (Get-BylVariableScope).User).Keys)
    $answer = [ordered]@{
        ok         = $true
        settings   = Get-SettingsAnswer -Settings $settings
        target     = $target
        passphrase = $passphrase.ToLowerInvariant()
        helper     = [System.IO.File]::Exists([System.IO.Path]::Combine($AppDir, $BylBackupHelperName))
        variables  = @($names)
    }
    $lines = @(
        "Zielverzeichnis: $(if ($null -eq $settings.Target) { 'keins' } else { $settings.Target })",
        "Passphrase:      $(switch ($passphrase) { 'Set' { 'gesetzt' } 'Missing' { 'fehlt' } default { 'nicht lesbar' } })",
        "Aufbewahrung:    $($settings.Daily) täglich, $($settings.Weekly) wöchentlich, $($settings.Monthly) monatlich",
        "Zugangsdaten:    $(if ($settings.Credentials) { 'werden mitgesichert' } else { 'werden nicht mitgesichert' }) ($(@($names).Count) Variablen)"
    )
    return Write-BackupAnswer -Answer $answer -Text ($lines -join "`n")
}

# Codes of the problems of a target for the app (lib/backup-rules.js TARGET_PROBLEMS).
$TargetProblemCode = @{ Format = 'format'; TooLong = 'too-long'; InsideApp = 'inside-app'; Missing = 'missing'; NotWritable = 'not-writable'; Space = 'space' }

$TargetProblemText = @{
    Format      = 'Das ist kein vollständiger Pfad: Laufwerk mit Ordner (etwa einer USB-Platte) oder eine Freigabe wie \\NAS\Freigabe\Sicherung.'
    TooLong     = "Der Pfad ist zu lang (höchstens $BylBackupTargetMaxLength Zeichen)."
    InsideApp   = 'Das Zielverzeichnis darf nicht im Ordner app liegen: Eine Kopie des Ordners nähme die Sicherungen mit, ein Plattendefekt beide.'
    Missing     = 'Den Ordner gibt es nicht oder er ist gerade nicht erreichbar (USB-Platte angeschlossen? Netzlaufwerk verbunden?).'
    NotWritable = 'In den Ordner lässt sich nicht schreiben.'
    Space       = 'Auf dem Laufwerk ist zu wenig Platz frei.'
    Keep        = 'Die Aufbewahrung ist ungültig.'
}

function Invoke-BackupConfigure {
    # backup-configure: target folder (checked like Get-TargetCheck with a write probe; '' or none
    # removes it), generations and the switch for the access data. From the console only the target
    # ($Value); the rest stays.
    $request = Read-InputJson
    $settings = Get-BackupSettings
    $target = if ($null -ne $request) { [string](Get-InputValue $request 'target') } else { [string]$Value }
    $target = $target.Trim()
    if ($null -ne $request) {
        foreach ($name in @($BylBackupKeep.Keys)) {
            $number = Get-InputValue $request $name
            $limit = $BylBackupKeep[$name]
            if ($null -eq $number) { continue }
            if (-not ($number -is [int] -or $number -is [long]) -or $number -lt $limit.Min -or $number -gt $limit.Max) {
                return Write-BackupAnswer -Answer ([ordered]@{ ok = $false; problem = 'keep' }) -Text $TargetProblemText.Keep
            }
            $settings.($name.Substring(0, 1).ToUpperInvariant() + $name.Substring(1)) = [int]$number
        }
        $credentials = Get-InputValue $request 'credentials'
        if ($credentials -is [bool]) { $settings.Credentials = $credentials }
    }
    $check = $null
    if ($target -ne '') {
        $check = Get-TargetCheck -Path $target -WriteProbe
        if ($null -ne $check.Problem) {
            $code = $TargetProblemCode[$check.Problem]
            $script:LogDetail = "problem=$code"
            return Write-BackupAnswer -Answer ([ordered]@{ ok = $false; problem = $code; freeBytes = $check.FreeBytes; sameDrive = $check.SameDrive }) `
                -Text $TargetProblemText[$check.Problem]
        }
        $settings.Target = $target.TrimEnd('\')
        if ($settings.Target -match '^[A-Za-z]:$') { $settings.Target += '\' }
    }
    else {
        $settings.Target = $null
    }
    $path = Get-BylConfigPath -AppDir $AppDir
    Write-TextFile -Path $path -Text (Merge-BylConfigText -Text (Read-TextFile -Path $path) -Backup $settings)
    $script:LogDetail = "target=$(if ($null -eq $settings.Target) { 'none' } else { 'set' })"
    $text = if ($null -eq $settings.Target) { 'Kein Zielverzeichnis: Sicherungen bleiben nur in pb_data\backups.' } else { "Zielverzeichnis eingestellt: $($settings.Target)" }
    return Write-BackupAnswer -Answer ([ordered]@{
            ok        = $true
            settings  = Get-SettingsAnswer -Settings $settings
            freeBytes = if ($null -ne $check) { $check.FreeBytes } else { $null }
            sameDrive = if ($null -ne $check) { $check.SameDrive } else { $false }
        }) -Text $text
}

$PassphraseProblemCode = @{ Mismatch = 'mismatch'; TooShort = 'too-short'; TooLong = 'too-long'; Character = 'character'; Unavailable = 'unavailable' }

$PassphraseProblemText = @{
    Mismatch    = 'Die beiden Eingaben stimmen nicht überein.'
    TooShort    = "Die Passphrase muss mindestens $BylPassphraseMinLength Zeichen lang sein."
    TooLong     = "Die Passphrase ist zu lang (höchstens $BylPassphraseMaxBytes Byte)."
    Character   = 'Die Passphrase darf keine Steuerzeichen enthalten.'
    Unavailable = 'Diese Testkopie hat keinen Ordner für die Passphrase.'
}

function Invoke-BackupPassphrase {
    # backup-passphrase: the passphrase twice (from the app as JSON, in the console as hidden
    # input), kept with DPAPI for this Windows account. Never printed, never logged. Older backups
    # keep the passphrase they were sealed with.
    $request = Read-InputJson
    $passphrase = $null
    $confirmation = $null
    try {
        if ($null -ne $request) {
            $passphrase = [string](Get-InputValue $request 'passphrase')
            $confirmation = [string](Get-InputValue $request 'confirmation')
        }
        elseif (-not $Hidden -and -not $Json) {
            Write-Host 'Passphrase der Sicherungen festlegen. Bewahre sie in deinem Passwort-Manager auf – ohne sie lässt sich eine Sicherung nicht öffnen.'
            $passphrase = Read-Secret -Prompt "Passphrase (mindestens $BylPassphraseMinLength Zeichen)"
            $confirmation = Read-Secret -Prompt 'Passphrase wiederholen'
        }
        $problem = Test-BylPassphrase -Passphrase $passphrase -Confirmation $confirmation
        if ($null -eq $problem -and $null -eq (Get-PassphraseFile)) { $problem = 'Unavailable' }
        if ($null -ne $problem) {
            $code = $PassphraseProblemCode[$problem]
            $script:LogDetail = "problem=$code"
            return Write-BackupAnswer -Answer ([ordered]@{ ok = $false; problem = $code }) -Text $PassphraseProblemText[$problem]
        }
        Save-StoredPassphrase -Passphrase $passphrase
    }
    finally {
        $passphrase = $null
        $confirmation = $null
    }
    $script:LogDetail = 'passphrase=set'
    return Write-BackupAnswer -Answer ([ordered]@{ ok = $true }) -Text ('Passphrase gespeichert (an dieses Windows-Konto gebunden). Neue Sicherungen nutzen sie; ältere bleiben mit ihrer bisherigen Passphrase lesbar.')
}

$ExportReasonText = @{
    name          = 'Unbekannte Sicherung.'
    missing       = 'Die Sicherung gibt es in pb_data\backups nicht.'
    'no-target'   = 'Es ist kein Zielverzeichnis eingestellt.'
    unreachable   = 'Das Zielverzeichnis ist gerade nicht erreichbar.'
    'no-passphrase' = 'Es ist keine Passphrase festgelegt.'
    'passphrase-unreadable' = 'Die gespeicherte Passphrase lässt sich mit diesem Windows-Konto nicht lesen; bitte neu festlegen.'
    helper        = 'byl-backup.exe fehlt oder antwortet nicht; scripts\build.ps1 baut es.'
    space         = 'Im Zielverzeichnis ist zu wenig Platz frei.'
    'not-writable' = 'In das Zielverzeichnis lässt sich nicht schreiben.'
    failed        = 'Die Sicherung ließ sich nicht verschlüsseln.'
}

function Invoke-BackupExport {
    # backup-export: seals the local backup $name (pb_data\backups\byl-<stamp>.zip) into the target
    # folder as byl-<stamp>.tar.age, with the settings of this folder, a manifest (from the app:
    # counts and the newest migration; here: time, commit, names of the variables) and, if
    # switched on, the values of the BYL_* variables of the account. A missing target, passphrase or
    # helper is an answer with a reason, not a crash; the app tries again later.
    $request = Read-InputJson
    $name = if ($null -ne $request) { [string](Get-InputValue $request 'name') } else { [string]$Value }
    $fail = {
        param([string]$Reason)
        $script:LogDetail = "reason=$Reason"
        Write-BackupAnswer -Answer ([ordered]@{ ok = $false; reason = $Reason }) -Text $ExportReasonText[$Reason]
    }
    if ($name -notmatch $BylLocalBackupPattern) { return & $fail 'name' }
    $zip = [System.IO.Path]::Combine($AppDir, 'pb_data', 'backups', $name)
    if (-not [System.IO.File]::Exists($zip)) { return & $fail 'missing' }
    $settings = Get-BackupSettings
    if ($null -eq $settings.Target) { return & $fail 'no-target' }
    if (-not [System.IO.Directory]::Exists($settings.Target)) { return & $fail 'unreachable' }
    if (-not [System.IO.File]::Exists([System.IO.Path]::Combine($AppDir, $BylBackupHelperName))) { return & $fail 'helper' }
    $stored = Read-StoredPassphrase
    if ($stored.State -eq 'Unreadable') { return & $fail 'passphrase-unreadable' }
    if ($stored.State -ne 'Set') { return & $fail 'no-passphrase' }
    $size = (New-Object System.IO.FileInfo($zip)).Length
    $free = Get-FreeBytes -Path $settings.Target
    if ($null -ne $free -and (Get-BylBackupSpaceVerdict -FreeBytes $free -NeededBytes $size) -ne 'Ok') { return & $fail 'space' }

    $secrets = if ($settings.Credentials) { Select-BylSecretVariable -Variables (Get-BylVariableScope).User } else { [ordered]@{} }
    $manifest = [ordered]@{}
    $given = Get-InputValue $request 'manifest'
    if ($null -ne $given -and $given -is [System.Management.Automation.PSCustomObject]) {
        foreach ($property in $given.PSObject.Properties) { $manifest[$property.Name] = $property.Value }
    }
    $manifest['app'] = 'becauseyoulovejira'
    $manifest['name'] = $name.Substring(0, $name.Length - 4)
    $manifest['createdUtc'] = [DateTime]::UtcNow.ToString('yyyy-MM-ddTHH:mm:ssZ')
    $manifest['commit'] = Get-BylCommit
    $manifest['variables'] = @($secrets.Keys)
    $config = Get-BylConfigPath -AppDir $AppDir
    $sealedName = Get-BylSealedName -LocalName $name
    $answer = Invoke-BackupHelper -Command seal -Parameters ([ordered]@{
            data       = $zip
            out        = [System.IO.Path]::Combine($settings.Target, $sealedName)
            config     = if ([System.IO.File]::Exists($config)) { $config } else { $null }
            passphrase = $stored.Value
            manifest   = $manifest
            secrets    = $secrets
        })
    $stored = $null
    $secrets = $null
    if ((Get-InputValue $answer 'ok') -ne $true) {
        $reason = switch ([string](Get-InputValue $answer 'reason')) {
            'space' { 'space' }
            'access' { 'not-writable' }
            'missing' { 'unreachable' }
            'helper' { 'helper' }
            default { 'failed' }
        }
        return & $fail $reason
    }
    $bytes = [long](Get-InputValue $answer 'bytes')
    $script:LogDetail = "file=$sealedName bytes=$bytes"
    return Write-BackupAnswer -Answer ([ordered]@{ ok = $true; file = $sealedName; bytes = $bytes; variables = @($manifest['variables']) }) `
        -Text "Sicherung verschlüsselt: $([System.IO.Path]::Combine($settings.Target, $sealedName))"
}

# --- Check of a backup (ADR-0046 section 6) -------------------------------------------------------

# Collections the throwaway server counts (the same as the manifest of a sealed backup).
$CountedCollections = @('users', 'projects', 'tags', 'tickets', 'comments', 'inbox_items', 'recurrence_rules', 'connections')
# A throwaway server gets this long to answer /api/health (it runs the migrations on the copy first).
$ThrowawayStartSeconds = 120# Names of backups in pb_data\backups that can be checked and restored (any ZIP of PocketBase there).
$LocalBackupNamePattern = '^[A-Za-z0-9@._-]{1,200}\.zip$'

function New-WorkFolder {
    # A new folder for one check or restore under %TEMP% (byl-pruefung-<random>); the caller removes it.
    $path = [System.IO.Path]::Combine([System.IO.Path]::GetTempPath(), 'byl-pruefung-' + [guid]::NewGuid().ToString('N'))
    [void][System.IO.Directory]::CreateDirectory($path)
    return $path
}

function Remove-WorkFolder {
    # Removes a work folder of New-WorkFolder, and only such a folder; SQLite and the throwaway server
    # may hold a file for a moment after they ended.
    param([AllowNull()][AllowEmptyString()][string]$Path)

    if ([string]::IsNullOrEmpty($Path) -or -not [System.IO.Directory]::Exists($Path)) { return }
    $prefix = [System.IO.Path]::Combine([System.IO.Path]::GetTempPath(), 'byl-pruefung-')
    if (-not $Path.StartsWith($prefix, [System.StringComparison]::OrdinalIgnoreCase)) { return }
    for ($attempt = 0; $attempt -lt 40; $attempt++) {
        try {
            [System.IO.Directory]::Delete($Path, $true)
            return
        }
        catch {
            Start-Sleep -Milliseconds 250
        }
    }
}

function Get-FreeLoopbackPort {
    # A free port on 127.0.0.1 for a throwaway server: never the port of the app, of its mail helper
    # (8091) or the one kept for spikes (8099).
    while ($true) {
        $listener = New-Object System.Net.Sockets.TcpListener([System.Net.IPAddress]::Loopback, 0)
        $listener.Start()
        $port = ([System.Net.IPEndPoint]$listener.LocalEndpoint).Port
        $listener.Stop()
        if (@($BylDefaultPort, 8091, 8099, $BylPort) -notcontains $port) { return $port }
    }
}

function Invoke-JsonRequest {
    # One request with a JSON body to a throwaway server on 127.0.0.1, without proxy; StatusCode and
    # the parsed Body, $null without an answer.
    param(
        [Parameter(Mandatory = $true)][string]$Url,
        [ValidateSet('GET', 'POST')][string]$Method = 'GET',
        [AllowNull()][object]$Body,
        [AllowNull()][AllowEmptyString()][string]$Token
    )

    $request = [System.Net.WebRequest]::Create($Url)
    $request.Proxy = $null
    $request.Timeout = 60000
    $request.KeepAlive = $false
    $request.Method = $Method
    if (-not [string]::IsNullOrEmpty($Token)) { $request.Headers.Add('Authorization', $Token) }
    if ($null -ne $Body) {
        $bytes = (New-Object System.Text.UTF8Encoding($false)).GetBytes((ConvertTo-Json -InputObject $Body -Compress))
        $request.ContentType = 'application/json'
        $request.ContentLength = $bytes.Length
        $stream = $request.GetRequestStream()
        try { $stream.Write($bytes, 0, $bytes.Length) } finally { $stream.Dispose() }
    }
    try {
        $response = $request.GetResponse()
    }
    catch [System.Net.WebException] {
        $response = $_.Exception.Response
        if ($null -eq $response) { return $null }
    }
    try {
        $reader = New-Object System.IO.StreamReader($response.GetResponseStream(), [System.Text.Encoding]::UTF8)
        $text = $reader.ReadToEnd()
        $parsed = $null
        try { $parsed = $text | ConvertFrom-Json } catch { $parsed = $null }
        return [pscustomobject]@{ StatusCode = [int]$response.StatusCode; Body = $parsed }
    }
    finally {
        $response.Close()
    }
}

function Start-PocketBaseProcess {
    # pocketbase.exe of this folder with $Arguments for a throwaway server of a check: no window, its
    # output read and dropped (it must not reach the JSON line of this command), no BYL_* variable.
    param([Parameter(Mandatory = $true)][string]$Arguments)

    $startInfo = New-Object System.Diagnostics.ProcessStartInfo
    $startInfo.FileName = [System.IO.Path]::Combine($AppDir, 'pocketbase.exe')
    $startInfo.Arguments = $Arguments
    $startInfo.UseShellExecute = $false
    $startInfo.CreateNoWindow = $true
    $startInfo.RedirectStandardOutput = $true
    $startInfo.RedirectStandardError = $true
    $startInfo.WorkingDirectory = $AppDir
    foreach ($name in @($startInfo.EnvironmentVariables.Keys)) {
        if ([string]$name -like 'BYL_*') { $startInfo.EnvironmentVariables.Remove($name) }
    }
    $process = [System.Diagnostics.Process]::Start($startInfo)
    $process.BeginOutputReadLine()
    $process.BeginErrorReadLine()
    return $process
}

function Invoke-ThrowawayCheck {
    # Starts pocketbase.exe of this folder on the copy $DataDir with a throwaway superuser (created
    # first, CLAUDE.md section 11.2), without hooks (no cron, no channel runs with access data), on a
    # random port; waits for /api/health and counts the collections through the API. Ends the server
    # in any case. Ok and Counts.
    param([Parameter(Mandatory = $true)][string]$DataDir, [Parameter(Mandatory = $true)][string]$Work)

    $hooks = [System.IO.Path]::Combine($Work, 'hooks')
    $public = [System.IO.Path]::Combine($Work, 'public')
    [void][System.IO.Directory]::CreateDirectory($hooks)
    [void][System.IO.Directory]::CreateDirectory($public)
    $common = (@(
            "--dir=$DataDir",
            "--hooksDir=$hooks",
            "--migrationsDir=$([System.IO.Path]::Combine($AppDir, 'pb_migrations'))",
            "--publicDir=$public",
            '--automigrate=false'
        ) | ForEach-Object { ConvertTo-ProcessArgument -Value $_ }) -join ' '
    $bytes = New-Object byte[] 24
    $generator = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    try { $generator.GetBytes($bytes) } finally { $generator.Dispose() }
    $password = 'P' + ([Convert]::ToBase64String($bytes) -replace '[+/=]', 'x')
    $email = "pruefung-$([guid]::NewGuid().ToString('N'))@example.invalid"
    $failed = [pscustomobject]@{ Ok = $false; Counts = $null }

    $upsert = Start-PocketBaseProcess -Arguments (Get-AdminUpsertArgument -AppDir $AppDir -Email $email -Password $password -DataDir $DataDir -HooksDir $hooks)
    try {
        if (-not $upsert.WaitForExit(120000)) {
            try { $upsert.Kill() } catch { $null = $_ }
            return $failed
        }
        $upsert.WaitForExit()
        if ($upsert.ExitCode -ne 0) { return $failed }
    }
    finally {
        $upsert.Dispose()
    }
    $port = Get-FreeLoopbackPort
    $server = Start-PocketBaseProcess -Arguments "serve --http=127.0.0.1:$port $common"
    try {
        $base = "http://127.0.0.1:$port"
        $deadline = [DateTime]::UtcNow.AddSeconds($ThrowawayStartSeconds)
        while (-not (Test-Health -Url "$base/api/health")) {
            if ($server.HasExited -or [DateTime]::UtcNow -ge $deadline) { return $failed }
            Start-Sleep -Milliseconds 250
        }
        $auth = Invoke-JsonRequest -Url "$base/api/collections/_superusers/auth-with-password" -Method POST -Body @{ identity = $email; password = $password }
        if ($null -eq $auth -or $auth.StatusCode -ne 200 -or $null -eq $auth.Body) { return $failed }
        $token = [string](Get-InputValue $auth.Body 'token')
        $counts = [ordered]@{}
        foreach ($name in $CountedCollections) {
            $answer = Invoke-JsonRequest -Url "$base/api/collections/$name/records?perPage=1&fields=id" -Token $token
            if ($null -eq $answer -or $answer.StatusCode -ne 200 -or $null -eq $answer.Body) { return $failed }
            $counts[$name] = [long](Get-InputValue $answer.Body 'totalItems')
        }
        return [pscustomobject]@{ Ok = $true; Counts = $counts }
    }
    finally {
        if (-not $server.HasExited) {
            try { $server.Kill() } catch { $null = $_ }
        }
        [void]$server.WaitForExit(15000)
        $server.Dispose()
    }
}

function Invoke-Verification {
    # The check of ADR-0046 section 6 of the backup $File in the work folder $Work: a sealed backup
    # (.tar.age) is opened with $Passphrase (age decrypts to the last chunk), then the ZIP of
    # PocketBase is unpacked, data.db checked (integrity, counts, every file of a file field in
    # storage) and served by a throwaway server. Returns the result as an ordered dictionary for the
    # answer; with -Secrets the values of the access data of the backup in the property Secrets of
    # the second return value (memory only, never in an answer or log).
    param(
        [Parameter(Mandatory = $true)][string]$File,
        [AllowNull()][AllowEmptyString()][string]$Passphrase,
        [Parameter(Mandatory = $true)][string]$Work,
        [switch]$Secrets
    )

    $result = [ordered]@{
        ok = $false; reason = $null; encrypted = $false; createdUtc = $null; variables = @()
        integrity = $null; counts = $null; files = $null
    }
    $extra = [pscustomobject]@{ Secrets = $null; Config = $null; Zip = $null }
    $zip = $File
    if ($File -match '\.tar\.age$') {
        $result.encrypted = $true
        if ([string]::IsNullOrEmpty($Passphrase)) {
            $result.reason = 'no-passphrase'
            return $result, $extra
        }
        $opened = Invoke-BackupHelper -Command open -Parameters ([ordered]@{ file = $File; out = $Work; passphrase = $Passphrase; secrets = $Secrets.IsPresent })
        if ((Get-InputValue $opened 'ok') -ne $true) {
            $result.reason = switch ([string](Get-InputValue $opened 'reason')) {
                'passphrase' { 'passphrase' }
                'format' { 'format' }
                'missing' { 'missing' }
                'space' { 'space' }
                'helper' { 'helper' }
                default { 'damaged' }
            }
            return $result, $extra
        }
        $manifest = Get-InputValue $opened 'manifest'
        $result.createdUtc = [string](Get-InputValue $manifest 'createdUtc')
        $result.variables = @(Get-InputValue $opened 'variables')
        if ($Secrets) { $extra.Secrets = Get-InputValue $opened 'secrets' }
        $config = [System.IO.Path]::Combine($Work, $BylConfigName)
        if ([System.IO.File]::Exists($config)) { $extra.Config = $config }
        $zip = [System.IO.Path]::Combine($Work, 'pb_data.zip')
    }
    $extra.Zip = $zip
    $size = (New-Object System.IO.FileInfo($zip)).Length
    $free = Get-FreeBytes -Path $Work
    if ($null -ne $free -and (Get-BylBackupSpaceVerdict -FreeBytes $free -NeededBytes (3 * $size)) -ne 'Ok') {
        $result.reason = 'space'
        return $result, $extra
    }
    $data = [System.IO.Path]::Combine($Work, 'pb_data')
    try {
        Add-Type -AssemblyName System.IO.Compression.FileSystem
        [System.IO.Compression.ZipFile]::ExtractToDirectory($zip, $data)
    }
    catch {
        $result.reason = 'zip'
        return $result, $extra
    }
    $check = Invoke-BackupHelper -Command check -Parameters ([ordered]@{ dir = $data })
    if ((Get-InputValue $check 'ok') -ne $true) {
        $checkReason = [string](Get-InputValue $check 'reason')
        $result.reason = switch ($checkReason) { 'missing' { 'no-db' } 'helper' { 'helper' } default { 'integrity' } }
        # The reason of the helper (a fixed word such as damaged, input or internal), for the log of a test.
        $result['check'] = $checkReason
        return $result, $extra
    }
    $result.integrity = @(Get-InputValue $check 'integrity')
    $result.files = Get-InputValue $check 'files'
    if (-not ($result.integrity.Count -eq 1 -and $result.integrity[0] -eq 'ok')) {
        $result.reason = 'integrity'
        return $result, $extra
    }
    $server = Invoke-ThrowawayCheck -DataDir $data -Work $Work
    if (-not $server.Ok) {
        $result.reason = 'start'
        return $result, $extra
    }
    $result.counts = $server.Counts
    if ([long](Get-InputValue $result.files 'missing') -gt 0) {
        $result.reason = 'files'
        return $result, $extra
    }
    $result.ok = $true
    return $result, $extra
}

function Resolve-BackupFile {
    # The file of a backup: 'local' a ZIP in pb_data\backups by its name, 'target' a sealed backup in
    # the target folder by its name, 'path' a full path to a .zip or .tar.age (console, restore of a
    # copied file). Names never leave their folder. Path, or Problem ('name', 'missing',
    # 'unreachable'), and the Source.
    param([Parameter(Mandatory = $true)][string]$Source, [AllowNull()][AllowEmptyString()][string]$Name)

    $fail = { param($Problem) [pscustomobject]@{ Path = $null; Problem = $Problem; Source = $Source } }
    switch ($Source) {
        'local' {
            if ($Name -notmatch $LocalBackupNamePattern) { return & $fail 'name' }
            $path = [System.IO.Path]::Combine($AppDir, 'pb_data', 'backups', $Name)
        }
        'target' {
            if ($Name -notmatch $BylSealedBackupPattern) { return & $fail 'name' }
            $target = (Get-BackupSettings).Target
            if ($null -eq $target -or -not [System.IO.Directory]::Exists($target)) { return & $fail 'unreachable' }
            $path = [System.IO.Path]::Combine($target, $Name)
        }
        'path' {
            if ([string]::IsNullOrWhiteSpace($Name) -or $Name -notmatch '\.(zip|tar\.age)$' -or -not [System.IO.Path]::IsPathRooted($Name)) { return & $fail 'name' }
            $path = [System.IO.Path]::GetFullPath($Name)
        }
        default { return & $fail 'name' }
    }
    if (-not [System.IO.File]::Exists($path)) { return & $fail 'missing' }
    return [pscustomobject]@{ Path = $path; Problem = $null; Source = $Source }
}

$VerifyReasonText = @{
    name            = 'Unbekannte Sicherung.'
    missing         = 'Die Sicherung gibt es nicht (mehr).'
    unreachable     = 'Das Zielverzeichnis ist nicht erreichbar.'
    'no-passphrase' = 'Für eine verschlüsselte Sicherung fehlt die Passphrase.'
    passphrase      = 'Die Passphrase passt nicht zu dieser Sicherung.'
    format          = 'Das ist keine Sicherung im Format age.'
    damaged         = 'Die Sicherung ist beschädigt oder unvollständig.'
    zip             = 'Das ZIP der Sicherung lässt sich nicht entpacken.'
    'no-db'         = 'In der Sicherung fehlt die Datenbank (data.db).'
    integrity       = 'Die Datenbank der Sicherung ist beschädigt (integrity_check).'
    files           = 'In der Sicherung fehlen Originaldateien.'
    start           = 'Eine Probe-Instanz ließ sich mit der Sicherung nicht starten.'
    space           = 'Für die Prüfung ist im Temp-Ordner zu wenig Platz frei.'
    helper          = 'byl-backup.exe fehlt oder antwortet nicht; scripts\build.ps1 baut es.'
}

function Get-RequestedBackup {
    # The backup a command means: from the app source and name; from the console $Value as a full
    # path, a name in pb_data\backups or a name in the target folder.
    param([AllowNull()][object]$Request)

    if ($null -ne $Request) {
        return Resolve-BackupFile -Source ([string](Get-InputValue $Request 'source')) -Name ([string](Get-InputValue $Request 'name'))
    }
    $text = ([string]$Value).Trim()
    if ($text -match '[\\/]') { return Resolve-BackupFile -Source 'path' -Name $text }
    $source = if ($text -match $BylSealedBackupPattern) { 'target' } else { 'local' }
    return Resolve-BackupFile -Source $source -Name $text
}

function Invoke-BackupVerify {
    # backup-verify: checks one backup (Invoke-Verification) in a work folder under %TEMP% that is
    # removed afterwards. The passphrase of a sealed backup comes from the app, else the stored one,
    # in the console also asked for. Prints the result (counts, files, never values).
    $request = Read-InputJson
    $file = Get-RequestedBackup -Request $request
    $name = if ($null -ne $file.Path) { [System.IO.Path]::GetFileName($file.Path) } else { '' }
    if ($null -ne $file.Problem) {
        $script:LogDetail = "reason=$($file.Problem)"
        return Write-BackupAnswer -Answer ([ordered]@{ ok = $false; reason = $file.Problem; name = $name }) -Text $VerifyReasonText[$file.Problem]
    }
    $passphrase = [string](Get-InputValue $request 'passphrase')
    if ($file.Path -match '\.tar\.age$' -and $passphrase -eq '') {
        $stored = Read-StoredPassphrase
        if ($stored.State -eq 'Set') { $passphrase = $stored.Value }
        elseif ($null -eq $request -and -not $Hidden -and -not $Json) { $passphrase = Read-Secret -Prompt 'Passphrase der Sicherung' }
    }
    $work = New-WorkFolder
    try {
        $result, $null = Invoke-Verification -File $file.Path -Passphrase $passphrase -Work $work
    }
    finally {
        $passphrase = $null
        Remove-WorkFolder -Path $work
    }
    $result['name'] = $name
    $script:LogDetail = ("name=$name ok=$($result.ok.ToString().ToLowerInvariant())" + $(if ($result.ok) { '' } else { " reason=$($result.reason)" }))
    if ($result.ok) {
        $text = "Sicherung $name geprüft: in Ordnung ($($result.counts['tickets']) Tickets, $($result.files.expected) Originaldateien)."
    }
    else {
        $text = "Sicherung $name geprüft: $($VerifyReasonText[$result.reason])"
    }
    return Write-BackupAnswer -Answer $result -Text $text
}

# --- Restore (ADR-0046 section 7) ---------------------------------------------------------------

# The job of a restore from the app (restore -Detach) for the detached process: JSON in this
# variable of the process environment, never on the command line; the new process reads and removes
# it first. Not a BYL_* name: those are the access data of the account (ADR-0018).
$RestoreJobVariable = 'BECAUSEYOULOVEJIRA_RESTORE_JOB'

# Reasons of a restore that did not happen or was undone, besides those of a check ($VerifyReasonText).
$RestoreReasonText = @{
    confirm     = "Zur Bestätigung fehlt das Wort $BylRestoreConfirmWord."
    credentials = 'Unbekannte Auswahl für die Zugangsdaten.'
    cancel      = 'Abgebrochen; nichts wurde geändert.'
    input       = 'Der Auftrag der Wiederherstellung fehlt oder ist unlesbar.'
    'space-app' = 'Auf dem Laufwerk der App ist für die entpackte Sicherung zu wenig Platz frei.'
    stop        = 'Die App ließ sich nicht beenden; nichts wurde geändert.'
    swap        = 'Der Datenordner ließ sich nicht austauschen; der bisherige ist wieder an seinem Platz.'
    detach      = 'Die Wiederherstellung ließ sich nicht im Hintergrund starten.'
}
$RestoreStartFailedText = 'Mit der wiederhergestellten Sicherung startete die App nicht; der bisherige Stand ist zurück.'

function Get-RestoreText {
    # The text of a reason of a restore ($RestoreReasonText, else $VerifyReasonText).
    param([Parameter(Mandatory = $true)][string]$Reason)

    if ($RestoreReasonText.ContainsKey($Reason)) { return $RestoreReasonText[$Reason] }
    if ($VerifyReasonText.ContainsKey($Reason)) { return $VerifyReasonText[$Reason] }
    return 'Die Wiederherstellung ist gescheitert.'
}

function Write-RestoreState {
    # run\wiederherstellung.json for the page (lib/backup-rules.js parseRestoreState): phase, backup,
    # reason, safety copy, counts, choice and names of the access data written, what happened to the
    # settings; never a value or the passphrase. A failure to write only costs the page its progress.
    param([Parameter(Mandatory = $true)][System.Collections.IDictionary]$State)

    try {
        $State['at'] = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
        $run = Get-BylRunPath -AppDir $AppDir
        Write-TextFile -Path ([System.IO.Path]::Combine($run.Directory, 'wiederherstellung.json')) -Text (ConvertTo-Json -InputObject $State -Depth 6 -Compress)
    }
    catch {
        $null = $_
    }
}

function Get-RestoreChoice {
    # The backups the console offers, newest first: those in pb_data\backups and the sealed ones in
    # the target folder, with time and size.
    $list = New-Object System.Collections.Generic.List[object]
    $places = @(
        [pscustomobject]@{ Source = 'local'; Folder = [System.IO.Path]::Combine($AppDir, 'pb_data', 'backups'); Filter = '*.zip'; Pattern = $LocalBackupNamePattern }
        [pscustomobject]@{ Source = 'target'; Folder = (Get-BackupSettings).Target; Filter = '*.tar.age'; Pattern = $BylSealedBackupPattern }
    )
    foreach ($place in $places) {
        if ([string]::IsNullOrEmpty($place.Folder) -or -not [System.IO.Directory]::Exists($place.Folder)) { continue }
        foreach ($file in (New-Object System.IO.DirectoryInfo($place.Folder)).GetFiles($place.Filter)) {
            if ($file.Name -notmatch $place.Pattern) { continue }
            $list.Add([pscustomobject]@{ Source = $place.Source; Name = $file.Name; Time = $file.LastWriteTime; Bytes = $file.Length })
        }
    }
    return @($list | Sort-Object -Property Time -Descending)
}

function Select-RestoreBackup {
    # Console: lists the backups (Get-RestoreChoice) and asks for a number or the full path of a file
    # (a fresh folder on a new machine has none); $null when the answer is empty.
    $choices = @(Get-RestoreChoice)
    Write-Host 'Sicherungen (neueste zuerst):'
    if ($choices.Count -eq 0) { Write-Host '  keine im Ordner app und im Zielverzeichnis' }
    for ($i = 0; $i -lt $choices.Count; $i++) {
        $choice = $choices[$i]
        $where = if ($choice.Source -eq 'target') { 'Zielverzeichnis' } else { 'Ordner app' }
        Write-Host ('  {0,2}  {1}  {2,9:N1} MB  {3,-15}  {4}' -f ($i + 1), $choice.Time.ToString('dd.MM.yyyy HH:mm'), ($choice.Bytes / 1MB), $where, $choice.Name)
    }
    $answer = ([string](Read-Host -Prompt 'Nummer der Sicherung oder voller Pfad einer Datei (.tar.age oder .zip); leer: abbrechen')).Trim().Trim('"')
    if ($answer -eq '') { return $null }
    if ($answer -match '^\d{1,4}$') {
        $number = [int]$answer
        if ($number -lt 1 -or $number -gt $choices.Count) { return [pscustomobject]@{ Path = $null; Problem = 'name'; Source = 'local' } }
        return Resolve-BackupFile -Source $choices[$number - 1].Source -Name $choices[$number - 1].Name
    }
    return Resolve-BackupFile -Source 'path' -Name $answer
}

function Get-ZipContentBytes {
    # The size of the files in the ZIP $Path once unpacked.
    param([Parameter(Mandatory = $true)][string]$Path)

    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $zip = [System.IO.Compression.ZipFile]::OpenRead($Path)
    try {
        $sum = [long]0
        foreach ($entry in $zip.Entries) { $sum += $entry.Length }
        return $sum
    }
    finally {
        $zip.Dispose()
    }
}

function Test-DataFolderPath {
    # Whether $Path is pb_data, a folder pb_data.<name> directly in this app folder, or the folder
    # backups in one of them: the only folders a restore moves or removes.
    param([Parameter(Mandatory = $true)][string]$Path)

    $full = [System.IO.Path]::GetFullPath($Path).TrimEnd('\')
    $name = [System.IO.Path]::GetFileName($full)
    $parent = [System.IO.Path]::GetDirectoryName($full)
    if ($name -eq 'backups') {
        $name = [System.IO.Path]::GetFileName($parent)
        $parent = [System.IO.Path]::GetDirectoryName($parent)
    }
    $app = [System.IO.Path]::GetFullPath($AppDir).TrimEnd('\')
    return [string]::Equals($parent, $app, [System.StringComparison]::OrdinalIgnoreCase) -and $name -match '^pb_data(\.[A-Za-z0-9-]+)?$'
}

function Move-DataFolder {
    # Renames a data folder of this app folder (Test-DataFolderPath), with a few tries: a scanner or
    # the indexer may hold a file for a moment after the server ended.
    param([Parameter(Mandatory = $true)][string]$From, [Parameter(Mandatory = $true)][string]$To)

    if (-not (Test-DataFolderPath -Path $From) -or -not (Test-DataFolderPath -Path $To)) { throw "Kein Datenordner der App: $From" }
    for ($attempt = 1; ; $attempt++) {
        try {
            [System.IO.Directory]::Move($From, $To)
            return
        }
        catch {
            if ($attempt -ge 40) { throw }
            Start-Sleep -Milliseconds 250
        }
    }
}

function Remove-DataFolder {
    # Removes a data folder of this app folder (Test-DataFolderPath), with a few tries; $false if it stays.
    param([Parameter(Mandatory = $true)][string]$Path)

    if (-not (Test-DataFolderPath -Path $Path)) { return $false }
    for ($attempt = 0; $attempt -lt 40; $attempt++) {
        if (-not [System.IO.Directory]::Exists($Path)) { return $true }
        try {
            [System.IO.Directory]::Delete($Path, $true)
            return $true
        }
        catch {
            Start-Sleep -Milliseconds 250
        }
    }
    return -not [System.IO.Directory]::Exists($Path)
}

function ConvertTo-SecretMap {
    # The access data of an opened backup (an object of the JSON answer of byl-backup.exe) as
    # name -> value, in memory only.
    param([AllowNull()][object]$Secrets)

    $map = [ordered]@{}
    if ($null -eq $Secrets) { return $map }
    foreach ($property in $Secrets.PSObject.Properties) { $map[$property.Name] = [string]$property.Value }
    return $map
}

function Invoke-Restore {
    # restore (ADR-0046 section 7; wiederherstellen.bat, the page Sicherung through restore -Detach):
    # 1. the backup: from the app or its job by source and name, in the console by name or path or
    #    chosen from a list; the passphrase from the app, stored, or asked in the console;
    # 2. checked like backup-verify, with the values of the access data in memory only; nothing
    #    happens to a backup that fails;
    # 3. the console shows what it found, asks what happens to the access data (names only) and for
    #    the word WIEDERHERSTELLEN; the app sends both;
    # 4. unpacked next to pb_data (same drive), the app stopped in order, pb_data renamed to the
    #    safety copy pb_data.vor-wiederherstellung-<UTC>, the new folder put in its place and the
    #    local backups moved along (the checked copy under Temp is never used: it has the throwaway
    #    superuser and the migrations of the check);
    # 5. byl-config.json of the backup only for a folder without one; the access data into the
    #    account (Set-BylAccountVariable) as chosen;
    # 6. started and asked /api/health; if it does not start, everything goes back (access data,
    #    settings, data folder) and the former state starts again if it ran.
    # Progress and result in run\wiederherstellung.json for the page, a line in byl-control.log
    # (names and numbers only).
    param([Parameter(Mandatory = $true)][object]$Config)

    if ($Detach) { return Start-DetachedRestore }
    if ($Hidden) {
        Show-Message -Kind Error -Text 'Die Wiederherstellung braucht ein Konsolenfenster: wiederherstellen.bat doppelklicken.'
        return $BylExitError
    }
    $state = [ordered]@{
        phase = 'checking'; name = ''; source = ''; ok = $false; reason = ''; safety = ''
        counts = $null; files = $null; credentials = [ordered]@{ mode = ''; written = @(); failed = $false }; config = ''
    }
    $fail = {
        param($Reason)
        $state.phase = 'failed'
        $state.reason = $Reason
        Write-RestoreState -State $state
        $script:LogDetail = ("name=$($state.name) ok=false reason=$Reason").Trim()
        return Write-BackupAnswer -Answer ([ordered]@{ ok = $false; reason = $Reason; name = $state.name }) -Text (Get-RestoreText -Reason $Reason)
    }

    $request = $null
    if ($WaitForProcess -gt 0) {
        # Started by restore -Detach: the job comes in the environment and goes from it at once.
        $raw = [Environment]::GetEnvironmentVariable($RestoreJobVariable, 'Process')
        [Environment]::SetEnvironmentVariable($RestoreJobVariable, $null, 'Process')
        [void](Wait-ProcessExit -ProcessId $WaitForProcess -Milliseconds ($CallerExitSeconds * 1000))
        try {
            if (-not [string]::IsNullOrWhiteSpace($raw)) { $request = $raw | ConvertFrom-Json }
        }
        catch {
            $request = $null
        }
        $raw = $null
        if ($null -eq $request -or $request -isnot [System.Management.Automation.PSCustomObject]) { return & $fail 'input' }
    }
    else {
        $request = Read-InputJson
    }
    $console = $null -eq $request -and -not $Json

    # 1. Which backup.
    if ($console -and [string]::IsNullOrWhiteSpace($Value)) {
        $file = Select-RestoreBackup
        if ($null -eq $file) { return & $fail 'cancel' }
    }
    else {
        $file = Get-RequestedBackup -Request $request
    }
    $state.source = $file.Source
    $state.name = if ($null -ne $file.Path) { [System.IO.Path]::GetFileName($file.Path) } else { [string](Get-InputValue $request 'name') }
    if ($null -ne $file.Problem) { return & $fail $file.Problem }
    $mode = 'missing'
    if (-not $console) {
        if (-not (Test-BylRestoreConfirmation -Text ([string](Get-InputValue $request 'confirm')))) { return & $fail 'confirm' }
        $requested = Get-InputValue $request 'credentials'
        if ($null -ne $requested) {
            if ($BylCredentialModes -cnotcontains [string]$requested) { return & $fail 'credentials' }
            $mode = [string]$requested
        }
    }

    # 2. The passphrase and the check.
    $sealed = $file.Path -match '\.tar\.age$'
    $passphrase = [string](Get-InputValue $request 'passphrase')
    $storedPassphrase = $false
    if ($sealed -and $passphrase -eq '') {
        $stored = Read-StoredPassphrase
        if ($stored.State -eq 'Set') {
            $passphrase = $stored.Value
            $storedPassphrase = $true
        }
        elseif ($console) {
            $passphrase = Read-Secret -Prompt 'Passphrase der Sicherung'
        }
    }
    Write-RestoreState -State $state
    $work = New-WorkFolder
    $staging = $null
    $secrets = $null
    try {
        if ($console) { Write-Host 'Prüfe die Sicherung (entschlüsseln, entpacken, Datenbank, Originaldateien, Probe-Start) ...' }
        $result, $extra = Invoke-Verification -File $file.Path -Passphrase $passphrase -Work $work -Secrets
        if (-not $result.ok) { return & $fail $result.reason }
        $state.counts = $result.counts
        $state.files = $result.files
        $secrets = ConvertTo-SecretMap -Secrets $extra.Secrets
        $current = (Get-BylVariableScope).User
        $names = @((Select-BylSecretVariable -Variables $secrets).Keys)

        # 3. Console: what it found, the access data, the word.
        if ($console) {
            $when = if ($result.createdUtc) {
                ([DateTime]::Parse($result.createdUtc, [System.Globalization.CultureInfo]::InvariantCulture, [System.Globalization.DateTimeStyles]::AdjustToUniversal)).ToLocalTime()
            }
            else {
                (New-Object System.IO.FileInfo($file.Path)).LastWriteTime
            }
            Write-Host ''
            Write-Host "Sicherung $($state.name) vom $($when.ToString('dd.MM.yyyy HH:mm')): in Ordnung, $($result.counts['tickets']) Tickets, $($result.files.expected) Originaldateien."
            Write-Host 'Danach sind alle Daten der App auf dem Stand dieser Sicherung; was seitdem dazukam, ist dann nicht mehr in der App.'
            Write-Host "Die jetzigen Daten bleiben $BylSafetyKeepDays Tage als Sicherheitskopie pb_data.vor-wiederherstellung-... im Ordner app."
            if ($names.Count -gt 0) {
                $missing = @($names | Where-Object { [string]::IsNullOrEmpty([string]$current[$_]) })
                Write-Host ('Zugangsdaten in der Sicherung: ' + ($names -join ', '))
                if ($missing.Count -gt 0) { Write-Host ('Davon fehlen auf diesem Windows-Konto: ' + ($missing -join ', ')) }
                $answer = ([string](Read-Host -Prompt 'Zurückschreiben? [f] nur fehlende (Standard), [a] alle überschreiben, [n] keine')).Trim().ToLowerInvariant()
                $mode = switch ($answer) { 'a' { 'all' } 'n' { 'none' } default { 'missing' } }
            }
            if (-not (Test-BylRestoreConfirmation -Text ([string](Read-Host -Prompt "Zum Wiederherstellen $BylRestoreConfirmWord eintippen (sonst Abbruch)")))) { return & $fail 'cancel' }
        }
        $state.credentials.mode = $mode

        # 4. Unpack next to pb_data, stop, swap.
        $free = Get-FreeBytes -Path $AppDir
        if ($null -ne $free -and (Get-BylBackupSpaceVerdict -FreeBytes $free -NeededBytes (Get-ZipContentBytes -Path $extra.Zip)) -ne 'Ok') { return & $fail 'space-app' }
        foreach ($left in [System.IO.Directory]::GetDirectories($AppDir, "$BylStagingPrefix*")) { [void](Remove-DataFolder -Path $left) }
        $now = [DateTime]::UtcNow
        $staging = [System.IO.Path]::Combine($AppDir, (Get-BylFolderStamp -Prefix $BylStagingPrefix -TimeUtc $now))
        try {
            Add-Type -AssemblyName System.IO.Compression.FileSystem
            [System.IO.Compression.ZipFile]::ExtractToDirectory($extra.Zip, $staging)
        }
        catch {
            return & $fail 'zip'
        }
        if ($console) { Write-Host 'Beende die App ...' }
        $state.phase = 'stopping'
        Write-RestoreState -State $state
        $stopped = @(Invoke-StopCore -Config $Config)[-1]
        if ($stopped -eq 'Failed') { return & $fail 'stop' }
        $state.phase = 'restoring'
        Write-RestoreState -State $state
        $data = [System.IO.Path]::Combine($AppDir, 'pb_data')
        $safety = $null
        $oldBackups = $null
        $newBackups = [System.IO.Path]::Combine($data, 'backups')
        $backupsMoved = $false
        $configPath = Get-BylConfigPath -AppDir $AppDir
        $configTaken = $false
        $written = New-Object System.Collections.Generic.List[string]
        $previous = @{}
        # Back to the former state: access data, settings, data folder (also after a failed swap).
        $undo = {
            foreach ($name in @($written)) {
                try { Set-BylAccountVariable -Name $name -Value $previous[$name] } catch { $null = $_ }
            }
            if ($configTaken) {
                try { [System.IO.File]::Delete($configPath) } catch { $null = $_ }
            }
            if ($backupsMoved) {
                try { Move-DataFolder -From $newBackups -To $oldBackups } catch { $null = $_ }
            }
            if ($null -ne $safety -and [System.IO.Directory]::Exists($safety)) {
                if ([System.IO.Directory]::Exists($data) -and -not (Remove-DataFolder -Path $data)) {
                    Move-DataFolder -From $data -To ([System.IO.Path]::Combine($AppDir, (Get-BylFolderStamp -Prefix 'pb_data.verworfen-' -TimeUtc $now)))
                }
                Move-DataFolder -From $safety -To $data
            }
            elseif ($null -eq $safety -and $null -eq $staging) {
                # A fresh folder had no data folder: the restored one goes again.
                [void](Remove-DataFolder -Path $data)
            }
        }
        try {
            if ([System.IO.Directory]::Exists($data)) {
                $safety = [System.IO.Path]::Combine($AppDir, (Get-BylFolderStamp -Prefix $BylSafetyCopyPrefix -TimeUtc $now))
                Move-DataFolder -From $data -To $safety
                $oldBackups = [System.IO.Path]::Combine($safety, 'backups')
            }
            Move-DataFolder -From $staging -To $data
            $staging = $null
            if ($null -ne $oldBackups -and [System.IO.Directory]::Exists($oldBackups) -and -not [System.IO.Directory]::Exists($newBackups)) {
                Move-DataFolder -From $oldBackups -To $newBackups
                $backupsMoved = $true
            }
        }
        catch {
            try { & $undo } catch { $null = $_ }
            if ($stopped -eq 'Stopped') { [void](Invoke-Start -Config (Get-Config)) }
            $state.phase = 'rolled-back'
            $state.reason = 'swap'
            $state.safety = ''
            Write-RestoreState -State $state
            $script:LogDetail = "name=$($state.name) ok=false reason=swap rolled-back"
            return Write-BackupAnswer -Answer ([ordered]@{ ok = $false; reason = 'swap'; rolledBack = $true; name = $state.name }) -Text (Get-RestoreText -Reason 'swap')
        }
        $state.safety = if ($null -ne $safety) { [System.IO.Path]::GetFileName($safety) } else { '' }

        # 5. Settings and access data.
        if ([System.IO.File]::Exists($configPath)) {
            $state.config = 'kept'
        }
        elseif ($null -ne $extra.Config) {
            [System.IO.File]::Copy($extra.Config, $configPath)
            $configTaken = $true
            $state.config = 'taken'
        }
        else {
            $state.config = 'none'
        }
        $selection = Select-BylRestoreVariable -Secrets $secrets -Current $current -Mode $mode
        foreach ($name in @($selection.Write.Keys)) {
            $previous[$name] = [string]$current[$name]
            try {
                Set-BylAccountVariable -Name $name -Value $selection.Write[$name]
                $written.Add($name)
            }
            catch {
                $state.credentials.failed = $true
            }
        }
        $state.credentials.written = @($written)

        # 6. Start and health; if not, back.
        if ($console) { Write-Host 'Starte die App mit der wiederhergestellten Sicherung ...' }
        $state.phase = 'starting'
        Write-RestoreState -State $state
        $restored = Get-Config
        Set-BylAddress -Port $restored.Port
        # Test copies only (BYL_TEST_ISOLATED): the way back after a start that fails.
        $fault = $IsolatedEnvironment -and [Environment]::GetEnvironmentVariable('BYL_TEST_RESTORE_FAULT', 'Process') -eq 'start'
        $code = if ($fault -or $null -ne $restored.Problem) { $BylExitError } else { [int](@(Invoke-Start -Config $restored)[-1]) }
        if ($code -ne $BylExitOk) {
            [void](Invoke-StopCore -Config $restored)
            & $undo
            if ($stopped -eq 'Stopped') {
                $former = Get-Config
                Set-BylAddress -Port $former.Port
                [void](Invoke-Start -Config $former)
            }
            $state.phase = 'rolled-back'
            $state.reason = 'start'
            $state.safety = ''
            $state.config = ''
            $state.credentials.written = @()
            Write-RestoreState -State $state
            $script:LogDetail = "name=$($state.name) ok=false reason=start rolled-back"
            return Write-BackupAnswer -Answer ([ordered]@{ ok = $false; reason = 'start'; rolledBack = $true; name = $state.name }) -Text $RestoreStartFailedText
        }
        $state.phase = 'done'
        $state.ok = $true
        Write-RestoreState -State $state
        $script:LogDetail = "name=$($state.name) ok=true safety=$($state.safety) credentials=$mode written=$($written.Count) config=$($state.config)"
        if ($console -and $sealed -and -not $storedPassphrase -and (Read-StoredPassphrase).State -eq 'Missing') {
            $keep = ([string](Read-Host -Prompt 'Diese Passphrase für künftige Sicherungen auf diesem Rechner speichern? [j/n]')).Trim().ToLowerInvariant()
            if ($keep -eq 'j') {
                try {
                    Save-StoredPassphrase -Passphrase $passphrase
                }
                catch {
                    Show-Message -Kind Warning -Text 'Die Passphrase ließ sich nicht speichern; unter Einstellungen → Sicherung festlegen.'
                }
            }
        }
        $text = "Wiederhergestellt: $($state.name)."
        if ($state.safety -ne '') { $text += " Die bisherigen Daten liegen $BylSafetyKeepDays Tage in $($state.safety)." }
        if ($written.Count -gt 0) { $text += ' Zugangsdaten zurückgeschrieben: ' + (@($written) -join ', ') + '.' }
        if ($state.credentials.failed) { $text += ' Einige Zugangsdaten ließen sich nicht zurückschreiben.' }
        return Write-BackupAnswer -Answer ([ordered]@{
                ok = $true; name = $state.name; safety = $state.safety; counts = $state.counts; files = $state.files
                credentials = $state.credentials; config = $state.config
            }) -Text $text
    }
    finally {
        $passphrase = $null
        $secrets = $null
        if ($null -ne $staging) { [void](Remove-DataFolder -Path $staging) }
        Remove-WorkFolder -Path $work
    }
}

function Start-DetachedRestore {
    # restore -Detach (the page Sicherung, ADR-0046 section 7): checks the request of the app (backup,
    # confirmation word, choice for the access data), then starts restore of this folder as a
    # process of its own like Start-DetachedRestart and ends at once. The job, with the passphrase if
    # the app sent one, goes to the new process in $RestoreJobVariable of the environment, never on
    # its command line; this process removes it right after the start. The state "started" (or the
    # reason of a refusal) goes to run\wiederherstellung.json, where the route reads it.
    $request = Read-InputJson
    $file = Get-RequestedBackup -Request $request
    $name = if ($null -ne $file.Path) { [System.IO.Path]::GetFileName($file.Path) } else { [string](Get-InputValue $request 'name') }
    $mode = [string](Get-InputValue $request 'credentials')
    if ($mode -eq '') { $mode = 'missing' }
    $state = [ordered]@{
        phase = 'failed'; name = $name; source = $file.Source; ok = $false; reason = ''; safety = ''
        counts = $null; files = $null; credentials = [ordered]@{ mode = $mode; written = @(); failed = $false }; config = ''
    }
    $refuse = {
        param($Reason)
        $state.reason = $Reason
        Write-RestoreState -State $state
        $script:LogDetail = "reason=$Reason"
        return Write-BackupAnswer -Answer ([ordered]@{ ok = $false; reason = $Reason; name = $name }) -Text (Get-RestoreText -Reason $Reason)
    }
    if ($null -eq $request) { return & $refuse 'input' }
    if ($null -ne $file.Problem) { return & $refuse $file.Problem }
    if (-not (Test-BylRestoreConfirmation -Text ([string](Get-InputValue $request 'confirm')))) { return & $refuse 'confirm' }
    if ($BylCredentialModes -cnotcontains $mode) { return & $refuse 'credentials' }
    $job = [ordered]@{ source = $file.Source; name = [string](Get-InputValue $request 'name'); confirm = $BylRestoreConfirmWord; credentials = $mode }
    $passphrase = [string](Get-InputValue $request 'passphrase')
    if ($passphrase -ne '') { $job['passphrase'] = $passphrase }
    $powershell = [System.IO.Path]::Combine($env:SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
    $arguments = Get-DetachedRestoreArgumentString -ScriptPath ([System.IO.Path]::Combine($AppDir, 'byl-control.ps1')) -WaitForProcess $PID
    try {
        [Environment]::SetEnvironmentVariable($RestoreJobVariable, (ConvertTo-Json -InputObject $job -Compress), 'Process')
        $child = Start-Process -FilePath $powershell -ArgumentList $arguments -WorkingDirectory $AppDir -WindowStyle Hidden -PassThru
    }
    catch {
        return & $refuse 'detach'
    }
    finally {
        [Environment]::SetEnvironmentVariable($RestoreJobVariable, $null, 'Process')
        $job = $null
        $passphrase = $null
    }
    $state.phase = 'started'
    Write-RestoreState -State $state
    $script:LogDetail = "detached=$($child.Id) name=$name"
    return Write-BackupAnswer -Answer ([ordered]@{ ok = $true; started = $true; name = $name }) -Text "Wiederherstellung läuft im Hintergrund (PID $($child.Id)); das Ergebnis steht danach unter Einstellungen → Sicherung und in logs\byl-control.log."
}

function Read-Secret {
    # One Read-Host -AsSecureString prompt as plain text. The plain text exists only as the
    # returned string; the unmanaged copy is zeroed and freed at once.
    param([Parameter(Mandatory = $true)][string]$Prompt)

    $secure = Read-Host -Prompt $Prompt -AsSecureString
    $bstr = [IntPtr]::Zero
    try {
        $bstr = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
        return [System.Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
    }
    finally {
        if ($bstr -ne [IntPtr]::Zero) { [System.Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
        $secure.Dispose()
    }
}

function Invoke-ResetAdmin {
    # Creates an admin account (PocketBase superuser) or sets a new password for an existing one;
    # tickets and app accounts stay untouched. Works while the app is running. Prints nothing but
    # the prompts, success or the error (the password never appears; PocketBase output is shown
    # only with the password replaced by ***).
    if ($Hidden) {
        Show-Message -Kind Error -Text 'Das Zurücksetzen des Admin-Kontos braucht ein Konsolenfenster: admin-zuruecksetzen.bat doppelklicken.'
        return $BylExitError
    }
    $exe = [System.IO.Path]::Combine($AppDir, 'pocketbase.exe')
    if (-not (Test-Path -LiteralPath $exe -PathType Leaf)) {
        Show-Message -Kind Error -Text "pocketbase.exe fehlt in:`n$AppDir`n`nBitte zuerst scripts\fetch-pocketbase.ps1 ausführen."
        return $BylExitError
    }
    # The address of the running instance, if one runs (the admin UI is on that port).
    $running = @(Select-AppProcess -Process (Get-ProcessSnapshot) -AppDir $AppDir)
    if ($running.Count -gt 0) {
        $runningPort = Get-ServerProcessPort -Process $running[0]
        if ($null -ne $runningPort) { Set-BylAddress -Port $runningPort }
    }

    Write-Host 'Admin-Konto zurücksetzen'
    Write-Host ('Legt ein Admin-Konto für die Verwaltung ({0}_/) an oder setzt das Passwort eines vorhandenen ' -f $BylAppUrl) -NoNewline
    Write-Host 'Admin-Kontos neu. Tickets und App-Konten bleiben unverändert.'
    Write-Host ''
    $email = ([string](Read-Host -Prompt 'E-Mail-Adresse des Admin-Kontos')).Trim()
    $password = $null
    $confirmation = $null
    try {
        $password = Read-Secret -Prompt "Neues Passwort (mindestens $BylAdminPasswordMinLength Zeichen)"
        $confirmation = Read-Secret -Prompt 'Passwort wiederholen'
        $problem = Test-AdminCredential -Email $email -Password $password -Confirmation $confirmation
        if ($null -ne $problem) {
            $reason = switch ($problem) {
                'EmailInvalid' { 'Das ist keine gültige E-Mail-Adresse.' }
                'PasswordMismatch' { 'Die beiden Passwörter stimmen nicht überein.' }
                'PasswordTooShort' { "Das Passwort muss mindestens $BylAdminPasswordMinLength Zeichen lang sein." }
                'PasswordTooLong' { "Das Passwort ist zu lang (höchstens $BylAdminPasswordMaxBytes Byte; Umlaute und Sonderzeichen zählen mehrfach)." }
                'PasswordCharacter' { 'Das Passwort darf keine Anführungszeichen (") und keine Steuerzeichen enthalten.' }
            }
            Show-Message -Kind Error -Text "$reason`nEs wurde nichts geändert. Bitte admin-zuruecksetzen.bat erneut ausführen."
            return $BylExitError
        }
        Write-Host ''
        Write-Host 'Speichere das Admin-Konto ...'
        $result = Invoke-AdminUpsert -ExePath $exe -AppDir $AppDir -Email $email -Password $password
    }
    finally {
        $password = $null
        $confirmation = $null
    }

    if ($result.ExitCode -ne 0) {
        $text = if ($result.ExitCode -eq -1) { 'PocketBase hat nicht innerhalb von 60 Sekunden geantwortet.' } else { "PocketBase meldet einen Fehler (Exit-Code $($result.ExitCode))." }
        if ($result.Output -match 'locked|busy') {
            $text += "`nDie Datenbank ist gerade gesperrt. Bitte zuerst stop.bat ausführen und es dann erneut versuchen."
        }
        if ($result.Output) { $text += "`n`n$($result.Output)" }
        Show-Message -Kind Error -Text "Das Admin-Konto konnte nicht gespeichert werden.`n$text"
        return $BylExitError
    }
    Show-Message ("Admin-Konto gespeichert: $email`nAnmelden in der Verwaltung: $($BylAppUrl)_/`n" +
        'Ein noch offener Einrichtungs-Tab wird damit ungültig und kann geschlossen werden.')
    return $BylExitOk
}

try {
    $config = Get-Config
    Set-BylAddress -Port $config.Port
    if (($Detach -or $WaitForProcess -gt 0) -and @('restart', 'restore') -notcontains $Command) {
        Show-Message -Kind Error -Text '-Detach und -WaitForProcess gelten nur für restart und restore.'
        exit $BylExitError
    }
    $exitCode = switch ($Command) {
        'start' { Invoke-Start -Config $config }
        'stop' { Invoke-Stop -Config $config }
        'restart' { Invoke-Restart -Config $config }
        'reload' { Invoke-Reload -Config $config }
        'status' { Invoke-Status -Config $config }
        'open' { Invoke-Open -Config $config }
        'logs' { Invoke-Logs }
        'doctor' { Invoke-Doctor -Config $config }
        'port' { Invoke-Port -Config $config }
        'autostart-on' { Invoke-AutostartOn }
        'autostart-off' { Invoke-AutostartOff }
        'mail-restart' { Invoke-MailRestart -Config $config }
        'reset-admin' { Invoke-ResetAdmin }
        'backup-info' { Invoke-BackupInfo }
        'backup-configure' { Invoke-BackupConfigure }
        'backup-passphrase' { Invoke-BackupPassphrase }
        'backup-export' { Invoke-BackupExport }
        'backup-verify' { Invoke-BackupVerify }
        'restore' { Invoke-Restore -Config $config }
        'help' {
            Write-Host $HelpText
            $BylExitOk
        }
    }
}
catch {
    Show-Message -Kind Error -Text "Unerwarteter Fehler: $($_.Exception.Message)"
    $exitCode = $BylExitError
}
# A function that leaks output would turn the result into an array; the last value is the code.
$exitCode = [int](@($exitCode)[-1])
# Only commands that change something go into byl-control.log (status and logs would flood it).
if (@('start', 'stop', 'restart', 'reload', 'port', 'autostart-on', 'autostart-off', 'mail-restart', 'reset-admin',
        'backup-configure', 'backup-passphrase', 'backup-export', 'backup-verify', 'restore') -contains $Command) {
    Write-ControlLog -Name $Command -ExitCode $exitCode
}
exit $exitCode
