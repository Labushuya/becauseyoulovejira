# Start, stop and autostart of becauseyoulovejira (E1 plan, package 8), the admin reset (E1.1) and
# the mail helper byl-mail.exe next to PocketBase (E4 plan, package 11).
# Called by start.bat, start-hidden.vbs, stop.bat, autostart-an.bat, autostart-aus.bat and
# admin-zuruecksetzen.bat, always with -NoProfile -ExecutionPolicy Bypass (script execution is
# disabled on the target machine).
#
# Exit codes: 0 = done, 1 = error (message shown), 2 = setup pending (first-run hint, or a running
# instance whose installer link still works; start.bat pauses so the hint stays readable).
#
# -Hidden (autostart via start-hidden.vbs): no console exists, so hints and errors appear as a
# message box, and a normal start does not open the browser (silent start at logon). In the first
# run PocketBase opens the installer itself; the message box explains the next steps.
#
# Saved as UTF-8 with BOM: Windows PowerShell 5.1 reads BOM-less files as ANSI (umlauts).

[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][ValidateSet('Start', 'Stop', 'AutostartOn', 'AutostartOff', 'ResetAdmin')][string]$Action,
    [switch]$Hidden
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 2.0

$AppDir = $PSScriptRoot
. ([System.IO.Path]::Combine($PSScriptRoot, 'byl-functions.ps1'))

$Title = 'becauseyoulovejira'
$HealthTimeoutSeconds = 30

$MissedLinkHint = 'Link verpasst oder abgelaufen? admin-zuruecksetzen.bat legt ein Admin-Konto an, ohne Daten zu löschen.'

$FirstRunHint = @"
Erster Start: Im Browser öffnet sich einmalig die Einrichtung.
  1. Lege dort dein Admin-Konto an.
  2. Lege danach im Admin-Bereich ($($BylAppUrl)_/) unter „users“ dein App-Konto an (E-Mail und Passwort).
  3. Öffne $BylAppUrl und melde dich mit dem App-Konto an.
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

function Open-Browser {
    # Opens the app in the browser unless it is open already (ADR-0035 section 7): an awake tab
    # confirms the message and shows a hint, a landing page (file://) opens the app itself. After
    # a cold start the tabs get up to 3 s to reconnect. Every doubt opens the tab (fail-open).
    param([Parameter(Mandatory = $true)][bool]$ColdStart)

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
    # Tells the open tabs that the app ends (stop.bat), without waiting for them; the stop never
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
    # changed variable therefore works after stop.bat and start.bat, without logging off. Nothing
    # is printed, neither names nor values.
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
        $link = Get-PendingInstallerLink -ProcessId $port.ProcessId
        if ($null -ne $link) {
            # Setup missed: open the installer link (once, instead of the app) and pause start.bat.
            Show-Message ($PendingSetupHint -f $link.ExpiresUtc.ToLocalTime().ToString('HH:mm'), $link.Url)
            Start-Process -FilePath $link.Url
            return 2
        }
        Start-MailHelper
        if (-not $Hidden) { Open-Browser -ColdStart $false }
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
            Initialize-IngestToken
            Sync-BylEnvironment
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
        Show-Message ($FirstRunHint + $where)
        return 2
    }

    Write-Status 'becauseyoulovejira läuft.'
    Start-MailHelper
    if (-not $Hidden) { Open-Browser -ColdStart $true }
    return 0
}

function Stop-OwnProcess {
    # Stops the own processes of $Candidates through Stop-SelectedProcess (byl-functions.ps1) with
    # the real operations. Stop-Process -Force ends a process hard (TerminateProcess): SQLite in WAL
    # mode treats that like a crash (committed transactions survive, see README), the mail helper
    # only reads and starts its interrupted run again. Emits the failures as single strings.
    param(
        [AllowEmptyCollection()][object[]]$Candidates,
        [Parameter(Mandatory = $true)][scriptblock]$Select,
        [Parameter(Mandatory = $true)][string]$Name
    )

    Stop-SelectedProcess -Candidates $Candidates -Select $Select -Name $Name -GetCurrent {
        param($processId)
        Get-CimInstance -ClassName Win32_Process -Filter "ProcessId = $([int]$processId)" -Property ProcessId, Name, ExecutablePath, CommandLine
    } -StopProcess {
        param($processId)
        Stop-Process -Id $processId -Force
        Wait-Process -Id $processId -Timeout 10 -ErrorAction SilentlyContinue
    } -StillRunningText 'läuft nach 10 Sekunden noch' -Report {
        param($Text)
        Write-Status $Text
    }
}

function Invoke-Stop {
    # Only the app's own processes (Select-AppProcess, Select-MailHelperProcess): never test
    # instances of the harness, never foreign processes, no taskkill by image name. The mail helper
    # goes first, so it does not report errors of a PocketBase that is gone.
    $snapshot = Get-ProcessSnapshot
    $own = @(Select-AppProcess -Process $snapshot -AppDir $AppDir)
    $helpers = @(Select-MailHelperProcess -Process $snapshot -AppDir $AppDir)
    if ($own.Count -eq 0 -and $helpers.Count -eq 0) {
        Show-Message 'becauseyoulovejira läuft nicht.'
        return 0
    }
    # The open tabs show "wurde beendet" instead of errors (ADR-0035 section 7); never waits.
    if ($own.Count -gt 0) { Send-StopNotice }
    # Collected as single strings (Stop-SelectedProcess emits one per failure); empty means done.
    $failed = New-Object System.Collections.Generic.List[string]
    foreach ($line in @(Stop-OwnProcess -Candidates $helpers -Name 'byl-mail.exe' -Select {
                param($Process) Select-MailHelperProcess -Process $Process -AppDir $AppDir
            })) { $failed.Add([string]$line) }
    foreach ($line in @(Stop-OwnProcess -Candidates $own -Name 'PocketBase' -Select {
                param($Process) Select-AppProcess -Process $Process -AppDir $AppDir
            })) { $failed.Add([string]$line) }
    if ($failed.Count -gt 0) {
        Show-Message -Kind Error -Text ("becauseyoulovejira konnte nicht beendet werden:`n" + ($failed -join "`n"))
        return 1
    }
    Show-Message 'becauseyoulovejira wurde beendet.'
    return 0
}

function Invoke-AutostartOn {
    $vbs = [System.IO.Path]::Combine($AppDir, 'start-hidden.vbs')
    if (-not (Test-Path -LiteralPath $vbs -PathType Leaf)) {
        Show-Message -Kind Error -Text "start-hidden.vbs fehlt in:`n$AppDir"
        return 1
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
        return 1
    }
    Show-Message "Autostart aktiviert:`n$($spec.Path)"
    return 0
}

function Invoke-AutostartOff {
    $spec = Get-AutostartShortcut -AppDir $AppDir -StartupDir ([Environment]::GetFolderPath('Startup')) `
        -SystemDir ([Environment]::SystemDirectory)
    if (-not (Test-Path -LiteralPath $spec.Path -PathType Leaf)) {
        Show-Message 'Autostart ist nicht aktiviert.'
        return 0
    }
    try {
        Remove-Item -LiteralPath $spec.Path -Force
    }
    catch {
        Show-Message -Kind Error -Text "Autostart konnte nicht entfernt werden: $($_.Exception.Message)"
        return 1
    }
    Show-Message 'Autostart deaktiviert.'
    return 0
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
        return 1
    }
    $exe = [System.IO.Path]::Combine($AppDir, 'pocketbase.exe')
    if (-not (Test-Path -LiteralPath $exe -PathType Leaf)) {
        Show-Message -Kind Error -Text "pocketbase.exe fehlt in:`n$AppDir`n`nBitte zuerst scripts\fetch-pocketbase.ps1 ausführen."
        return 1
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
            return 1
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
        return 1
    }
    Show-Message ("Admin-Konto gespeichert: $email`nAnmelden in der Verwaltung: $($BylAppUrl)_/`n" +
        'Ein noch offener Einrichtungs-Tab wird damit ungültig und kann geschlossen werden.')
    return 0
}

try {
    $exitCode = switch ($Action) {
        'Start' { Invoke-Start }
        'Stop' { Invoke-Stop }
        'AutostartOn' { Invoke-AutostartOn }
        'AutostartOff' { Invoke-AutostartOff }
        'ResetAdmin' { Invoke-ResetAdmin }
    }
}
catch {
    Show-Message -Kind Error -Text "Unerwarteter Fehler: $($_.Exception.Message)"
    $exitCode = 1
}
# A function that leaks output would turn the result into an array; the last value is the code.
exit ([int](@($exitCode)[-1]))
