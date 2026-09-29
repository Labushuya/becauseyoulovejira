# Operation of becauseyoulovejira (ADR-0039): start, stop, restart and port of the app, the
# autostart (E1 plan, package 8), the admin reset (E1.1) and the mail helper byl-mail.exe next to
# PocketBase (E4 plan, package 11).
# Called by start.bat, start-hidden.vbs, stop.bat, autostart-an.bat, autostart-aus.bat and
# admin-zuruecksetzen.bat, always with -NoProfile -ExecutionPolicy Bypass (script execution is
# disabled on the target machine):
#   powershell -NoProfile -ExecutionPolicy Bypass -File byl-control.ps1 <command> [options]
# "help" lists the commands, options and exit codes.
#
# Exit codes: 0 = done, 1 = error (message shown), 2 = setup pending (first-run hint, or a running
# instance whose installer link still works; start.bat pauses so the hint stays readable),
# 4 = the port is used by another program, 5 = the app runs but does not answer.
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
    [ValidateSet('start', 'stop', 'restart', 'port', 'autostart-on', 'autostart-off', 'reset-admin', 'help')]
    [string]$Command = 'help',
    [Parameter(Position = 1)][string]$Value,
    [switch]$Force,
    [switch]$Hidden,
    [switch]$NoBrowser,
    [switch]$Quiet
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
  port [Zahl]     Zeigt den Port oder stellt ihn um (1024–65535, Standard $BylDefaultPort; gespeichert in $BylConfigName).
  autostart-on    Startet die App künftig bei der Anmeldung (autostart-an.bat).
  autostart-off   Nimmt die App aus dem Autostart (autostart-aus.bat).
  reset-admin     Legt ein Admin-Konto an oder setzt sein Passwort neu (admin-zuruecksetzen.bat).
  help            Diese Hilfe.

Optionen:
  -Force          start: eine laufende App, die nicht antwortet, neu starten.
  -NoBrowser      start/restart: keinen Browser öffnen.
  -Quiet          nur Fehler und das Ergebnis ausgeben.
  -Hidden         ohne Fenster (Autostart): Hinweise als Meldungsfenster.

Exit-Codes:
  0  erledigt
  1  Fehler (siehe Meldung)
  2  Einrichtung offen (erster Start)
  4  Port belegt durch ein anderes Programm
  5  App läuft, antwortet aber nicht
"@

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
    # Progress and hints; silent with -Hidden (no console) and -Quiet.
    param([Parameter(Mandatory = $true)][AllowEmptyString()][string]$Text)
    if (-not $Hidden -and -not $Quiet) { Write-Host $Text }
}

function Write-Notice {
    # A warning that stays visible with -Quiet (yellow); silent with -Hidden.
    param([Parameter(Mandatory = $true)][string]$Text)
    if (-not $Hidden) { Write-Host $Text -ForegroundColor Yellow }
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
        if (-not $Hidden -and -not $Quiet) { Write-Host "  ... $Seconds s" }
    }
    return $state
}

function Complete-Start {
    # After a healthy start: mail helper, result line and browser.
    param([Parameter(Mandatory = $true)][int]$ProcessId, [Parameter(Mandatory = $true)][bool]$ColdStart)

    Start-MailHelper
    Write-Status "becauseyoulovejira läuft: $BylAppUrl (PID $ProcessId)."
    if (-not $Hidden -and -not $NoBrowser) { Open-Browser -ColdStart $ColdStart }
}

function Start-Server {
    # Cold start of PocketBase: checks, start, state file, waiting for /api/health, first run.
    param([Parameter(Mandatory = $true)][int]$Port)

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

    Set-BylAddress -Port $Port
    $databaseExisted = Test-Path -LiteralPath ([System.IO.Path]::Combine($AppDir, 'pb_data', 'data.db')) -PathType Leaf
    Write-Status "Starte PocketBase auf $BylAppUrl ..."
    try {
        Initialize-IngestToken
        Sync-BylEnvironment
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
                -ProcessStartUtc (Get-ProcessStartUtc -Process $server) -StartedUtc ([DateTime]::UtcNow))
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
            return Start-Server -Port $Config.Port
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
    return Start-Server -Port $Config.Port
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
exit ([int](@($exitCode)[-1]))
