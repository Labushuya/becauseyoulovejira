# Operation of becauseyoulovejira (ADR-0039): start, stop, restart, reload, status, open, logs,
# doctor and port of the app, the autostart (E1 plan, package 8), the admin reset (E1.1) and the
# mail helper byl-mail.exe next to PocketBase (E4 plan, package 11).
# Called by start.bat, start-hidden.vbs, stop.bat, autostart-an.bat, autostart-aus.bat and
# admin-zuruecksetzen.bat, always with -NoProfile -ExecutionPolicy Bypass (script execution is
# disabled on the target machine):
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
    [ValidateSet('start', 'stop', 'restart', 'reload', 'status', 'open', 'logs', 'doctor', 'port', 'autostart-on', 'autostart-off', 'reset-admin', 'help')]
    [string]$Command = 'help',
    [Parameter(Position = 1)][string]$Value,
    [switch]$Force,
    [switch]$Hidden,
    [switch]$NoBrowser,
    [switch]$Quiet,
    [switch]$Json,
    [switch]$Follow,
    [ValidateRange(1, 10000)][int]$Lines = 30
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 2.0

$AppDir = $PSScriptRoot
. ([System.IO.Path]::Combine($PSScriptRoot, 'byl-functions.ps1'))

$Title = 'becauseyoulovejira'
$HealthTimeoutSeconds = 30
$StopGraceSeconds = 15
$PortFreeTimeoutSeconds = 10
$ControlCall = 'powershell -NoProfile -ExecutionPolicy Bypass -File "{0}"' -f ([System.IO.Path]::Combine($AppDir, 'byl-control.ps1'))

$MissedLinkHint = 'Link verpasst oder abgelaufen? admin-zuruecksetzen.bat legt ein Admin-Konto an, ohne Daten zu löschen.'

$FirstRunHint = @"
Erster Start: Im Browser öffnet sich einmalig die Einrichtung.
  1. Lege dort dein Admin-Konto an.
  2. Lege danach im Admin-Bereich ({0}_/) unter „users“ dein App-Konto an (E-Mail und Passwort).
  3. Öffne {0} und melde dich mit dem App-Konto an.
Der Einrichtungslink ist 30 Minuten gültig – ist er abgelaufen, starte die App neu (stop.bat, dann start.bat).
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
  restart         Beendet die App und startet sie neu.
  reload          Startet nur neu, wenn es nötig ist (neue Migration, geänderte Hooks, …).
  status          Zeigt, ob die App läuft, ihre Adresse und ob ein Neustart nötig ist.
  open            Öffnet die laufende App im Browser.
  logs [Log]      Letzte Zeilen der Logs: server, mail, skript oder alle.
  doctor          Prüft Dateien, Port, Schreibrechte, Plattenplatz und andere Kopien.
  port [Zahl]     Zeigt den Port oder stellt ihn um (1024–65535, Standard $BylDefaultPort; gespeichert in $BylConfigName).
  autostart-on    Startet die App künftig bei der Anmeldung (autostart-an.bat).
  autostart-off   Nimmt die App aus dem Autostart (autostart-aus.bat).
  reset-admin     Legt ein Admin-Konto an oder setzt sein Passwort neu (admin-zuruecksetzen.bat).
  help            Diese Hilfe.

Optionen:
  -Force          start: eine laufende App, die nicht antwortet, neu starten; reload: immer neu starten.
  -NoBrowser      start/restart/reload/open: keinen Browser öffnen.
  -Quiet          nur Fehler und das Ergebnis ausgeben.
  -Json           status/doctor: Ergebnis als JSON.
  -Follow         logs: dem Log folgen (Strg+C beendet); nur mit server, mail oder skript.
  -Lines <Zahl>   logs: Anzahl der Zeilen (Standard 30).
  -Hidden         ohne Fenster (Autostart): Hinweise als Meldungsfenster.

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

function Write-ControlLog {
    # One line per command in logs\byl-control.log (Format-ControlLogLine: time, command, exit code
    # and $script:LogDetail, never values, passwords or e-mail addresses). Never fails the command.
    param([Parameter(Mandatory = $true)][string]$Name, [Parameter(Mandatory = $true)][int]$ExitCode)

    try {
        $path = Get-ControlLogPath -AppDir $AppDir
        [void][System.IO.Directory]::CreateDirectory([System.IO.Path]::GetDirectoryName($path))
        Invoke-LogRotation -Path $path -LimitBytes $BylControlLogLimitBytes
        $line = Format-ControlLogLine -TimeUtc ([DateTime]::UtcNow) -Command $Name -ExitCode $ExitCode -Detail $script:LogDetail
        [System.IO.File]::AppendAllText($path, "$line`r`n", (New-Object System.Text.UTF8Encoding($false)))
    }
    catch {
        $null = $_
    }
}

function Get-EnvironmentFingerprint {
    # Get-EnvironmentHash of the BYL_* variables a start hands to PocketBase (names from the user and
    # the machine scope, the value of the user scope first, as Sync-BylEnvironment), with $Key.
    # The values exist only in memory here; nothing is printed or stored.
    param([Parameter(Mandatory = $true)][byte[]]$Key)

    $user = [Environment]::GetEnvironmentVariables('User')
    $machine = [Environment]::GetEnvironmentVariables('Machine')
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

function Get-AutostartState {
    # 'on' (the shortcut starts start-hidden.vbs of this folder), 'other' (it starts another
    # folder, e.g. after moving app\) or 'off'.
    $spec = Get-AutostartShortcut -AppDir $AppDir -StartupDir ([Environment]::GetFolderPath('Startup')) `
        -SystemDir ([Environment]::SystemDirectory)
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
    # neither names nor values.
    $user = [Environment]::GetEnvironmentVariables('User')
    $machine = [Environment]::GetEnvironmentVariables('Machine')
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
    # the helper cannot deliver mails, the app itself starts anyway.
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
            Write-Status 'Hinweis: byl-mail.exe startet erst nach einem Neustart der App (stop.bat, dann start.bat).'
        }
    }
    catch {
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
                "Neu starten mit:`n  $ControlCall restart`noder start mit -Force." + (Get-LogTail))
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
                    "Neu starten mit:`n  $ControlCall restart" + (Get-LogTail))
                return $BylExitUnhealthy
            }
            Complete-Start -ProcessId $processId -ColdStart $true
            return $BylExitOk
        }
        'Open' {
            Write-Status "becauseyoulovejira läuft bereits (PID $processId, $BylAppUrl)."
            $script:LogDetail = "pid=$processId port=$($look.RunningPort) running"
            if ($look.RunningPort -ne $Config.Port) {
                Write-Notice "Hinweis: Eingestellt ist Port $($Config.Port); die neue Adresse gilt nach einem Neustart:`n  $ControlCall restart"
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
    # child (0 = sent), -1 if it hung.
    param([Parameter(Mandatory = $true)][int]$ProcessId)

    $startInfo = New-Object System.Diagnostics.ProcessStartInfo
    $startInfo.FileName = [System.IO.Path]::Combine($env:SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
    $startInfo.Arguments = '-NoProfile -NonInteractive -ExecutionPolicy Bypass -EncodedCommand ' + (Get-ConsoleBreakCommand -ProcessId $ProcessId)
    $startInfo.UseShellExecute = $false
    $startInfo.CreateNoWindow = $true
    $child = [System.Diagnostics.Process]::Start($startInfo)
    try {
        if (-not $child.WaitForExit(30000)) {
            try { $child.Kill() } catch { $null = $_ }
            return -1
        }
        return $child.ExitCode
    }
    finally {
        $child.Dispose()
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
            -SendBreak { param($id) (Send-ConsoleBreak -ProcessId $id) -eq 0 } `
            -WaitExit { param($id, $milliseconds) Wait-ProcessExit -ProcessId $id -Milliseconds $milliseconds } `
            -Kill { param($id) Stop-Process -Id $id -Force }
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

function Invoke-Restart {
    param([Parameter(Mandatory = $true)][object]$Config)

    if ($null -ne $Config.Problem) {
        Show-Message -Kind Error -Text (Get-ConfigProblemText -Problem $Config.Problem)
        return $BylExitError
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
        [Console]::Out.WriteLine(($result | ConvertTo-Json -Depth 4 -Compress))
        return $code
    }

    $label = { param([string]$Name, [string]$Text) Write-Host ('  {0,-13} {1}' -f $Name, $Text) }
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
    if ($code -eq $BylExitNotRunning) { Write-Host "Starten: start.bat oder $ControlCall start" }
    elseif ($code -eq $BylExitUnhealthy) { Write-Host "Neu starten: $ControlCall restart" }
    elseif ($code -eq $BylExitRestartNeeded) { Write-Host "Neustart: $ControlCall reload" }
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
    if ($action -eq 'Nothing') {
        Show-Message "Kein Neustart nötig: becauseyoulovejira ist aktuell (PID $($data.ProcessId), http://127.0.0.1:$($data.Port)/)."
        return $BylExitOk
    }
    if ($action -eq 'ReloadOnly') {
        Show-Message 'Kein Neustart nötig. Die Oberfläche wurde neu gebaut: im offenen Tab einmal neu laden (F5).'
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
        Show-Message -Kind Error -Text "becauseyoulovejira (PID $($look.Own[0].ProcessId)) antwortet nicht. Neu starten mit:`n  $ControlCall restart"
        return $BylExitUnhealthy
    }
    if ($Hidden -or $NoBrowser) {
        Show-Message "becauseyoulovejira läuft: $BylAppUrl"
        return $BylExitOk
    }
    Open-Browser -ColdStart $false
    return $BylExitOk
}

function Invoke-Logs {
    # Last lines of the logs (the programs log counts and cleaned errors only, never values of
    # variables or contents); -Follow follows one log until Ctrl+C.
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
        'Unhealthy' { & $add 'instance' 'error' "läuft (PID $($look.Own[0].ProcessId)), antwortet aber nicht: $ControlCall restart" }
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
    $token = -not [string]::IsNullOrWhiteSpace([Environment]::GetEnvironmentVariable($BylIngestTokenName, 'User'))
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
        [Console]::Out.WriteLine(([ordered]@{ appDir = $AppDir; ok = ($failed -eq 0); checks = @($checks.ToArray()) } | ConvertTo-Json -Depth 4 -Compress))
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
        Write-TextFile -Path (Get-BylConfigPath -AppDir $AppDir) -Text (ConvertTo-BylConfigText -Port $port)
    }
    catch {
        Show-Message -Kind Error -Text "$BylConfigName konnte nicht geschrieben werden: $($_.Exception.Message)"
        return $BylExitError
    }
    $script:LogDetail = "port=$port"
    $text = "Port $port eingestellt ($BylConfigName). Neue Adresse: http://127.0.0.1:$port/"
    if ($look.Own.Count -gt 0) {
        $text += "`nDie App läuft noch auf Port $($look.RunningPort); die neue Adresse gilt nach einem Neustart:`n  $ControlCall restart"
    }
    else {
        Update-AddressFile -Port $port
    }
    $text += ("`nBitte anpassen: Lesezeichen, die installierte App (unter der neuen Adresse neu installieren) und die App-Adresse" +
        "`nin der Browser-Erweiterung für WhatsApp Web. Die Anmeldung gilt je Adresse: unter der neuen einmal neu anmelden.")
    Show-Message $text
    return $BylExitOk
}

function Invoke-AutostartOn {
    $vbs = [System.IO.Path]::Combine($AppDir, 'start-hidden.vbs')
    if (-not (Test-Path -LiteralPath $vbs -PathType Leaf)) {
        Show-Message -Kind Error -Text "start-hidden.vbs fehlt in:`n$AppDir"
        return $BylExitError
    }
    $spec = Get-AutostartShortcut -AppDir $AppDir -StartupDir ([Environment]::GetFolderPath('Startup')) `
        -SystemDir ([Environment]::SystemDirectory)
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
    Show-Message "Autostart aktiviert:`n$($spec.Path)"
    return $BylExitOk
}

function Invoke-AutostartOff {
    $spec = Get-AutostartShortcut -AppDir $AppDir -StartupDir ([Environment]::GetFolderPath('Startup')) `
        -SystemDir ([Environment]::SystemDirectory)
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
        'reset-admin' { Invoke-ResetAdmin }
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
if (@('start', 'stop', 'restart', 'reload', 'port', 'autostart-on', 'autostart-off', 'reset-admin') -contains $Command) {
    Write-ControlLog -Name $Command -ExitCode $exitCode
}
exit $exitCode
