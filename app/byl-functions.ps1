# Functions for byl-control.ps1: start, stop and autostart of becauseyoulovejira (E1 plan, package 8).
#
# Dot-sourced by byl-control.ps1 and by the tests; loading the file has no side effects. The
# selection and detection logic is pure (every input is a parameter), so the tests check it with
# fake processes, sockets and log texts and never run the start or stop scripts themselves.

# The only binding of the app (CLAUDE.md section 3).
$BylHttpAddress = '127.0.0.1:8090'
$BylPort = 8090
$BylAppUrl = 'http://127.0.0.1:8090/'
$BylHealthUrl = 'http://127.0.0.1:8090/api/health'
# PocketBase prints the installer link (/_/#/pbinstall/<token>) while no superuser exists.
$BylInstallerMarker = 'pbinstal'
$BylShortcutName = 'becauseyoulovejira.lnk'

function Split-CommandLine {
    # Splits a Windows command line into arguments: whitespace separates, double quotes group and
    # are removed (also in the middle, as in --dir="<folder with spaces>"). Backslash escapes before quotes are
    # not modelled; they would only matter for paths ending in "\" plus quote, which the start
    # never produces and which are no valid folder names.
    param([AllowNull()][AllowEmptyString()][string]$CommandLine)

    $arguments = New-Object System.Collections.Generic.List[string]
    if ([string]::IsNullOrEmpty($CommandLine)) { return , $arguments.ToArray() }
    $current = New-Object System.Text.StringBuilder
    $inQuotes = $false
    $hasToken = $false
    foreach ($character in $CommandLine.ToCharArray()) {
        if ($character -eq [char]'"') {
            $inQuotes = -not $inQuotes
            $hasToken = $true
            continue
        }
        if (-not $inQuotes -and [char]::IsWhiteSpace($character)) {
            if ($hasToken) {
                $arguments.Add($current.ToString())
                [void]$current.Clear()
                $hasToken = $false
            }
            continue
        }
        [void]$current.Append($character)
        $hasToken = $true
    }
    if ($hasToken) { $arguments.Add($current.ToString()) }
    return , $arguments.ToArray()
}

function Get-FlagValue {
    # Value of the last "--<name>=<value>" argument (the last one wins, as in PocketBase's flag
    # parser); $null if the flag is missing. Flag names are case-sensitive.
    param([AllowNull()][string[]]$Arguments, [Parameter(Mandatory = $true)][string]$Name)

    $prefix = "--$Name="
    $value = $null
    foreach ($argument in @($Arguments)) {
        if ($null -ne $argument -and $argument.StartsWith($prefix, [System.StringComparison]::Ordinal)) {
            $value = $argument.Substring($prefix.Length)
        }
    }
    return $value
}

function Test-SamePath {
    # True if $Path is a fully qualified path (drive or UNC) that names the same location as
    # $Expected (case-insensitive, / and \ and a trailing separator do not matter). Relative paths
    # never match: they depend on the working directory of a foreign process.
    param([AllowNull()][AllowEmptyString()][string]$Path, [Parameter(Mandatory = $true)][string]$Expected)

    if ([string]::IsNullOrWhiteSpace($Path) -or $Path -notmatch '^(?:[A-Za-z]:[\\/]|[\\/]{2}[^\\/])') { return $false }
    try {
        $actualFull = [System.IO.Path]::GetFullPath($Path).TrimEnd('\')
        $expectedFull = [System.IO.Path]::GetFullPath($Expected).TrimEnd('\')
    }
    catch {
        return $false
    }
    return [string]::Equals($actualFull, $expectedFull, [System.StringComparison]::OrdinalIgnoreCase)
}

function Select-AppProcess {
    # Returns the app's own PocketBase instance(s) from process objects shaped like Win32_Process
    # (ProcessId, ExecutablePath, CommandLine). A process qualifies only if ALL of this holds:
    #   ExecutablePath = <AppDir>\pocketbase.exe, argument "serve", --http=127.0.0.1:8090 and
    #   --dir=<AppDir>\pb_data.
    # Test instances of the harness (same exe, --dir in the temp folder, random port), one-shot
    # commands (superuser, migrate) and foreign processes never qualify. Processes whose
    # command line is unreadable (other users) never qualify either.
    param([AllowNull()][object[]]$Process, [Parameter(Mandatory = $true)][string]$AppDir)

    $exePath = [System.IO.Path]::Combine($AppDir, 'pocketbase.exe')
    $dataDir = [System.IO.Path]::Combine($AppDir, 'pb_data')
    foreach ($candidate in @($Process)) {
        if ($null -eq $candidate) { continue }
        if (-not (Test-SamePath -Path $candidate.ExecutablePath -Expected $exePath)) { continue }
        # Assign first: Split-CommandLine emits the whole array as ONE pipeline object.
        $allArguments = Split-CommandLine -CommandLine $candidate.CommandLine
        $arguments = @($allArguments | Select-Object -Skip 1)
        if ($arguments -cnotcontains 'serve') { continue }
        if ((Get-FlagValue -Arguments $arguments -Name 'http') -cne $BylHttpAddress) { continue }
        if (-not (Test-SamePath -Path (Get-FlagValue -Arguments $arguments -Name 'dir') -Expected $dataDir)) { continue }
        $candidate
    }
}

function Resolve-PortState {
    # Classifies LISTEN sockets shaped like Get-NetTCPConnection (LocalAddress, LocalPort,
    # OwningProcess) for http://127.0.0.1:8090:
    #   App     - the own instance (Select-AppProcess) listens on 127.0.0.1:8090,
    #   Foreign - another process listens on 127.0.0.1, 0.0.0.0 or :: (the wildcards accept
    #             127.0.0.1 as well), ProcessId/ProcessName name the owner,
    #   Free    - nothing relevant listens (a socket on ::1 or another address does not collide).
    param(
        [AllowNull()][object[]]$Listener,
        [AllowNull()][object[]]$Process,
        [Parameter(Mandatory = $true)][string]$AppDir
    )

    $relevant = @(@($Listener) | Where-Object {
            $null -ne $_ -and [int]$_.LocalPort -eq $BylPort -and @('127.0.0.1', '0.0.0.0', '::') -contains [string]$_.LocalAddress
        })
    if ($relevant.Count -eq 0) {
        return [pscustomobject]@{ State = 'Free'; ProcessId = $null; ProcessName = $null }
    }
    $ownIds = @(Select-AppProcess -Process $Process -AppDir $AppDir | ForEach-Object { [int]$_.ProcessId })
    $own = @($relevant | Where-Object { [string]$_.LocalAddress -eq '127.0.0.1' -and $ownIds -contains [int]$_.OwningProcess })
    if ($own.Count -gt 0) {
        return [pscustomobject]@{ State = 'App'; ProcessId = [int]$own[0].OwningProcess; ProcessName = 'pocketbase.exe' }
    }
    $foreign = @($relevant | Where-Object { $ownIds -notcontains [int]$_.OwningProcess })
    if ($foreign.Count -eq 0) { $foreign = $relevant }
    $ownerId = [int]$foreign[0].OwningProcess
    $owner = @(@($Process) | Where-Object { $null -ne $_ -and [int]$_.ProcessId -eq $ownerId })
    $ownerName = if ($owner.Count -gt 0 -and $owner[0].Name) { [string]$owner[0].Name } else { 'unbekanntes Programm' }
    return [pscustomobject]@{ State = 'Foreign'; ProcessId = $ownerId; ProcessName = $ownerName }
}

function Test-FirstRun {
    # First run = no superuser yet. Preferred signal: the server printed the installer link
    # (it also covers an installer that was closed without creating an account). Fallback while
    # the log shows nothing (not written yet or unreadable): pb_data\data.db was missing before
    # the start, so the database is new and cannot contain a superuser.
    param([AllowNull()][AllowEmptyString()][string]$LogText, [Parameter(Mandatory = $true)][bool]$DatabaseExisted)

    if (-not [string]::IsNullOrEmpty($LogText) -and $LogText.Contains($BylInstallerMarker)) { return $true }
    return -not $DatabaseExisted
}

function Wait-FirstRunSignal {
    # Decides the first run after /api/health answered 200. PocketBase checks for a superuser in a
    # goroutine that runs concurrently with the server start, so the installer link can appear in
    # the log shortly AFTER the health check. With a new database the answer is known at once;
    # otherwise the log is watched for at most $GraceMilliseconds (a bounded observation window,
    # not a start delay: the server is already healthy). $ReadLog returns the current log text.
    param(
        [Parameter(Mandatory = $true)][scriptblock]$ReadLog,
        [Parameter(Mandatory = $true)][bool]$DatabaseExisted,
        [int]$GraceMilliseconds = 1500,
        [int]$PollMilliseconds = 100
    )

    if (-not $DatabaseExisted) { return $true }
    $deadline = [DateTime]::UtcNow.AddMilliseconds($GraceMilliseconds)
    while ($true) {
        if (Test-FirstRun -LogText ([string](& $ReadLog)) -DatabaseExisted $true) { return $true }
        if ([DateTime]::UtcNow -ge $deadline) { return $false }
        Start-Sleep -Milliseconds $PollMilliseconds
    }
}

function Get-ServerLogPath {
    # Output of the server process (overwritten at every start; *.log is gitignored). Standard
    # output and error need separate files (Start-Process cannot redirect both into one).
    param([Parameter(Mandatory = $true)][string]$AppDir)

    $logDir = [System.IO.Path]::Combine($AppDir, 'logs')
    return [pscustomobject]@{
        Directory = $logDir
        Output    = [System.IO.Path]::Combine($logDir, 'pocketbase.out.log')
        Error     = [System.IO.Path]::Combine($logDir, 'pocketbase.err.log')
    }
}

function Get-ServerArgumentString {
    # Arguments for pocketbase.exe (CLAUDE.md sections 3 and 9): only 127.0.0.1:8090, data, hooks,
    # migrations and web build from the app folder, --automigrate=false, never --dev. Paths are
    # quoted (spaces, #); Windows paths cannot contain double quotes.
    param([Parameter(Mandatory = $true)][string]$AppDir)

    $folder = { param([string]$Name) [System.IO.Path]::Combine($AppDir, $Name) }
    return ('serve --http={0} --dir="{1}" --hooksDir="{2}" --migrationsDir="{3}" --publicDir="{4}" --automigrate=false --indexFallback=true' -f
        $BylHttpAddress, (& $folder 'pb_data'), (& $folder 'pb_hooks'), (& $folder 'pb_migrations'), (& $folder 'pb_public'))
}

function Get-AutostartShortcut {
    # Shortcut in the Windows startup folder: wscript.exe runs start-hidden.vbs (no window).
    param(
        [Parameter(Mandatory = $true)][string]$AppDir,
        [Parameter(Mandatory = $true)][string]$StartupDir,
        [Parameter(Mandatory = $true)][string]$SystemDir
    )

    return [pscustomobject]@{
        Path             = [System.IO.Path]::Combine($StartupDir, $BylShortcutName)
        TargetPath       = [System.IO.Path]::Combine($SystemDir, 'wscript.exe')
        Arguments        = '"' + [System.IO.Path]::Combine($AppDir, 'start-hidden.vbs') + '"'
        WorkingDirectory = $AppDir.TrimEnd('\')
    }
}

function Test-Health {
    # One GET on /api/health; true only for status 200. No proxy: a system proxy must never see
    # (or answer) requests to the loopback address.
    param([string]$Url = $BylHealthUrl, [int]$TimeoutMilliseconds = 2000)

    $request = [System.Net.WebRequest]::Create($Url)
    $request.Proxy = $null
    $request.Timeout = $TimeoutMilliseconds
    $request.KeepAlive = $false
    try {
        $response = $request.GetResponse()
        try { return [int]$response.StatusCode -eq 200 } finally { $response.Close() }
    }
    catch [System.Net.WebException] {
        if ($null -ne $_.Exception.Response) { $_.Exception.Response.Close() }
        return $false
    }
}

function Wait-ServerReady {
    # Polls /api/health until it answers 200 (no fixed waiting time). Returns 'Ready', 'Exited'
    # (the process ended first) or 'Timeout'. $Process needs HasExited (System.Diagnostics.Process).
    param(
        [Parameter(Mandatory = $true)][object]$Process,
        [string]$Url = $BylHealthUrl,
        [int]$TimeoutSeconds = 30,
        [int]$RequestTimeoutMilliseconds = 2000
    )

    $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
    while ($true) {
        if ($Process.HasExited) { return 'Exited' }
        if (Test-Health -Url $Url -TimeoutMilliseconds $RequestTimeoutMilliseconds) {
            if ($Process.HasExited) { return 'Exited' }
            return 'Ready'
        }
        if ([DateTime]::UtcNow -ge $deadline) { return 'Timeout' }
        Start-Sleep -Milliseconds 250
    }
}

function Read-SharedText {
    # Whole text of a file that another process may still be writing ('' if it does not exist).
    param([Parameter(Mandatory = $true)][string]$Path)

    if (-not [System.IO.File]::Exists($Path)) { return '' }
    $stream = [System.IO.File]::Open($Path, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]'ReadWrite, Delete')
    try {
        $reader = New-Object System.IO.StreamReader($stream)
        return $reader.ReadToEnd()
    }
    finally {
        $stream.Dispose()
    }
}

function Get-ProcessSnapshot {
    # All processes with the fields Select-AppProcess and Resolve-PortState need (CIM instead of
    # the deprecated WMI command-line tool).
    return @(Get-CimInstance -ClassName Win32_Process -Property ProcessId, Name, ExecutablePath, CommandLine)
}

function Get-ListenerSnapshot {
    # LISTEN sockets on port 8090 (empty if there are none).
    return @(Get-NetTCPConnection -State Listen -LocalPort $BylPort -ErrorAction SilentlyContinue)
}

# --- Missed first-run installer (E1.1) --------------------------------------------------------

# PocketBase issues the installer token for 30 minutes (apis/installer.go, v0.40.4).
$BylInstallerLifetimeMinutes = 30

function ConvertFrom-Base64Url {
    # Bytes of a base64url string (JWT segment, no padding); $null if it is not valid base64url.
    param([AllowNull()][AllowEmptyString()][string]$Value)

    if ([string]::IsNullOrEmpty($Value) -or $Value -notmatch '^[A-Za-z0-9_-]+$') { return $null }
    $base64 = $Value.Replace('-', '+').Replace('_', '/')
    $base64 += '=' * ((4 - $base64.Length % 4) % 4)
    try {
        return , [Convert]::FromBase64String($base64)
    }
    catch {
        return $null
    }
}

function Get-InstallerLink {
    # Installer link of the running server, read from its log text. Only the token is taken from
    # the log (pattern /_/#/pbinstall/<jwt>); the URL is rebuilt on the fixed binding, so nothing
    # but the local admin UI is ever opened. Returns Url, Token and ExpiresUtc of the LAST link, or
    # $null if there is none, if it was issued before $ProcessStartUtc (a log of an older run) or
    # if it has expired at $NowUtc. The token is a JWT without "iat"; issue time = exp - 30 min.
    param(
        [AllowNull()][AllowEmptyString()][string]$LogText,
        [Parameter(Mandatory = $true)][DateTime]$ProcessStartUtc,
        [Parameter(Mandatory = $true)][DateTime]$NowUtc,
        [int]$ToleranceSeconds = 5
    )

    if ([string]::IsNullOrEmpty($LogText)) { return $null }
    $found = [regex]::Matches($LogText, '/_/#/pbinstall/([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)')
    if ($found.Count -eq 0) { return $null }
    $token = $found[$found.Count - 1].Groups[1].Value
    $payload = ConvertFrom-Base64Url -Value $token.Split('.')[1]
    if ($null -eq $payload) { return $null }
    try {
        $claims = [System.Text.Encoding]::UTF8.GetString($payload) | ConvertFrom-Json
        $expiresUtc = (New-Object DateTime 1970, 1, 1, 0, 0, 0, ([DateTimeKind]::Utc)).AddSeconds([double]$claims.exp)
    }
    catch {
        return $null
    }
    $issuedUtc = $expiresUtc.AddMinutes(-$BylInstallerLifetimeMinutes)
    if ($issuedUtc -lt $ProcessStartUtc.ToUniversalTime().AddSeconds(-$ToleranceSeconds)) { return $null }
    if ($NowUtc.ToUniversalTime() -ge $expiresUtc) { return $null }
    return [pscustomobject]@{
        Url        = "$($BylAppUrl)_/#/pbinstall/$token"
        Token      = $token
        ExpiresUtc = $expiresUtc
    }
}

function Wait-InstallerLink {
    # Get-InstallerLink on the current log, polled for at most $GraceMilliseconds: the link can
    # appear in the log shortly after /api/health answers (see Wait-FirstRunSignal).
    param(
        [Parameter(Mandatory = $true)][scriptblock]$ReadLog,
        [Parameter(Mandatory = $true)][DateTime]$ProcessStartUtc,
        [int]$GraceMilliseconds = 2000,
        [int]$PollMilliseconds = 100
    )

    $deadline = [DateTime]::UtcNow.AddMilliseconds($GraceMilliseconds)
    while ($true) {
        $link = Get-InstallerLink -LogText ([string](& $ReadLog)) -ProcessStartUtc $ProcessStartUtc -NowUtc ([DateTime]::UtcNow)
        if ($null -ne $link -or [DateTime]::UtcNow -ge $deadline) { return $link }
        Start-Sleep -Milliseconds $PollMilliseconds
    }
}

function Test-InstallerPending {
    # True while the installer token still works, i.e. no real superuser exists yet: PocketBase
    # deletes its installer account as soon as the first real superuser is saved
    # (core/record_model_superusers.go, v0.40.4), which invalidates the token. One read-only
    # request, the answer is discarded. 401/403 = setup done; any other outcome (network error,
    # 5xx) counts as pending, so a missed installer is never hidden. No proxy (see Test-Health).
    param(
        [Parameter(Mandatory = $true)][string]$Token,
        [string]$Url = "$($BylAppUrl)api/collections/_superusers/records?perPage=1&skipTotal=1&fields=id",
        [int]$TimeoutMilliseconds = 2000
    )

    $request = [System.Net.WebRequest]::Create($Url)
    $request.Proxy = $null
    $request.Timeout = $TimeoutMilliseconds
    $request.KeepAlive = $false
    $request.Headers.Add('Authorization', $Token)
    try {
        $response = $request.GetResponse()
        $response.Close()
        return $true
    }
    catch [System.Net.WebException] {
        $response = $_.Exception.Response
        if ($null -eq $response) { return $true }
        try {
            return -not (@(401, 403) -contains [int]$response.StatusCode)
        }
        finally {
            $response.Close()
        }
    }
}

# --- Admin reset (admin-zuruecksetzen.bat, E1.1) ----------------------------------------------

$BylAdminPasswordMinLength = 10
# bcrypt reads at most 72 bytes; PocketBase's password field allows 71 by default.
$BylAdminPasswordMaxBytes = 71

function Test-AdminCredential {
    # Checks the input of the admin reset before anything runs. Returns $null if it is valid,
    # otherwise one code: EmailInvalid, PasswordMismatch, PasswordTooShort, PasswordTooLong or
    # PasswordCharacter (double quote or control character; the quote is rejected so the command
    # line never needs quote escaping).
    param(
        [AllowNull()][AllowEmptyString()][string]$Email,
        [AllowNull()][AllowEmptyString()][string]$Password,
        [AllowNull()][AllowEmptyString()][string]$Confirmation
    )

    if ([string]::IsNullOrEmpty($Email) -or $Email.Length -gt 254 -or $Email -notmatch '^[^\s@"]+@[^\s@"]+\.[^\s@"]+$') {
        return 'EmailInvalid'
    }
    if (-not [string]::Equals($Password, $Confirmation, [System.StringComparison]::Ordinal)) { return 'PasswordMismatch' }
    if ($Password.Length -lt $BylAdminPasswordMinLength) { return 'PasswordTooShort' }
    if ([System.Text.Encoding]::UTF8.GetByteCount($Password) -gt $BylAdminPasswordMaxBytes) { return 'PasswordTooLong' }
    foreach ($character in $Password.ToCharArray()) {
        if ($character -eq [char]'"' -or [char]::IsControl($character)) { return 'PasswordCharacter' }
    }
    return $null
}

function ConvertTo-ProcessArgument {
    # Quotes one argument for a Windows command line so that the usual parser (CommandLineToArgvW
    # rules, also used by Go programs) yields exactly $Value: arguments with whitespace or quotes
    # are quoted, backslashes before a quote and at the end are doubled, quotes are escaped.
    param([AllowEmptyString()][string]$Value)

    if ($Value.Length -gt 0 -and $Value -notmatch '[\s"]') { return $Value }
    $backslash = [char]92
    $builder = New-Object System.Text.StringBuilder
    [void]$builder.Append('"')
    $pending = 0
    foreach ($character in $Value.ToCharArray()) {
        if ($character -eq $backslash) {
            $pending++
            continue
        }
        if ($character -eq [char]'"') {
            [void]$builder.Append($backslash, 2 * $pending + 1)
        }
        elseif ($pending -gt 0) {
            [void]$builder.Append($backslash, $pending)
        }
        [void]$builder.Append($character)
        $pending = 0
    }
    if ($pending -gt 0) { [void]$builder.Append($backslash, 2 * $pending) }
    [void]$builder.Append('"')
    return $builder.ToString()
}

function Get-AdminUpsertArgument {
    # Command line for pocketbase.exe to create a superuser or set its password, on the app's own
    # folders (as Get-ServerArgumentString) with --automigrate=false. The flags come first and
    # "--" ends them, so an e-mail or password starting with "-" is never read as a flag.
    param(
        [Parameter(Mandatory = $true)][string]$AppDir,
        [Parameter(Mandatory = $true)][string]$Email,
        [Parameter(Mandatory = $true)][string]$Password
    )

    $folder = { param([string]$Name) [System.IO.Path]::Combine($AppDir, $Name) }
    $arguments = @(
        'superuser', 'upsert',
        "--dir=$(& $folder 'pb_data')",
        "--hooksDir=$(& $folder 'pb_hooks')",
        "--migrationsDir=$(& $folder 'pb_migrations')",
        '--automigrate=false',
        '--', $Email, $Password
    )
    return (@($arguments | ForEach-Object { ConvertTo-ProcessArgument -Value $_ }) -join ' ')
}

function Invoke-AdminUpsert {
    # Runs the admin reset (Get-AdminUpsertArgument) and waits for it. Returns ExitCode (-1 on
    # timeout) and Output with every occurrence of the password replaced by ***. The password is
    # passed on the command line: PocketBase has no other input for it, so it is visible in the
    # process list for the moment the command runs (documented in ADR-0002).
    param(
        [Parameter(Mandatory = $true)][string]$ExePath,
        [Parameter(Mandatory = $true)][string]$AppDir,
        [Parameter(Mandatory = $true)][string]$Email,
        [Parameter(Mandatory = $true)][string]$Password,
        [int]$TimeoutSeconds = 60
    )

    $startInfo = New-Object System.Diagnostics.ProcessStartInfo
    $startInfo.FileName = $ExePath
    $startInfo.Arguments = Get-AdminUpsertArgument -AppDir $AppDir -Email $Email -Password $Password
    $startInfo.WorkingDirectory = $AppDir
    $startInfo.UseShellExecute = $false
    $startInfo.CreateNoWindow = $true
    $startInfo.RedirectStandardOutput = $true
    $startInfo.RedirectStandardError = $true
    $process = [System.Diagnostics.Process]::Start($startInfo)
    $startInfo.Arguments = ''
    try {
        # Read both streams asynchronously: a full pipe buffer would otherwise block the process.
        $standardOutput = $process.StandardOutput.ReadToEndAsync()
        $standardError = $process.StandardError.ReadToEndAsync()
        if ($process.WaitForExit($TimeoutSeconds * 1000)) {
            $process.WaitForExit()
            $exitCode = $process.ExitCode
        }
        else {
            try { $process.Kill() } catch { $null = $_ }
            $process.WaitForExit()
            $exitCode = -1
        }
        $output = ($standardOutput.Result + $standardError.Result).Replace($Password, '***')
    }
    finally {
        $process.Dispose()
    }
    return [pscustomobject]@{ ExitCode = $exitCode; Output = $output.Trim() }
}

# Names of the access data of the channels (ADR-0018 section 1): "BYL_" plus capital letters,
# digits and "_", at most 64 characters. Same pattern as app/pb_hooks/lib/secrets.js.
$BylSecretNamePattern = '^BYL_[A-Z0-9_]{1,60}$'

function Get-BylEnvironmentChange {
    # Which BYL_* variables start.bat hands to PocketBase (ADR-0018 section 6): every valid name of
    # the user scope (its value is read fresh from there), and the removal of valid names this
    # process still has from its own start although they are gone from the user and the machine
    # scope. Only names go in and out; values are never printed.
    param(
        [AllowEmptyCollection()][string[]]$UserNames = @(),
        [AllowEmptyCollection()][string[]]$MachineNames = @(),
        [AllowEmptyCollection()][string[]]$ProcessNames = @()
    )

    $set = @($UserNames | Where-Object { $_ -cmatch $BylSecretNamePattern } | Sort-Object -Unique)
    $keep = @($set) + @($MachineNames | Where-Object { $_ -cmatch $BylSecretNamePattern })
    $remove = @($ProcessNames | Where-Object { ($_ -cmatch $BylSecretNamePattern) -and ($keep -notcontains $_) } | Sort-Object -Unique)
    return [pscustomobject]@{ Set = $set; Remove = $remove }
}

# --- Ingest token of the mail helper (ADR-0018 section 8, E4 plan package 22) ------------------

# Variable of the token byl-mail.exe and PocketBase share; never printed or logged.
$BylIngestTokenName = 'BYL_INGEST_TOKEN'
$BylMailHelperName = 'byl-mail.exe'
# 24 random bytes as Base64 (32 characters).
$BylIngestTokenBytes = 24

function Test-IngestTokenNeeded {
    # True if the start has to create the ingest token: the mail helper exists in the app folder
    # and the user scope has no usable token yet (missing, empty or only white space).
    param(
        [Parameter(Mandatory = $true)][bool]$HelperExists,
        [AllowNull()][AllowEmptyString()][string]$CurrentValue
    )

    return $HelperExists -and [string]::IsNullOrWhiteSpace($CurrentValue)
}

function New-IngestTokenValue {
    # A new token: $BylIngestTokenBytes bytes from the cryptographic random number generator as
    # Base64. Only returned, never printed.
    $bytes = New-Object byte[] $BylIngestTokenBytes
    $generator = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    try {
        $generator.GetBytes($bytes)
    }
    finally {
        $generator.Dispose()
    }
    return [Convert]::ToBase64String($bytes)
}

# --- Mail helper byl-mail.exe (ADR-0016 section 5, E4 plan package 11) -------------------------

# The helper talks to the app's own PocketBase only.
$BylMailHelperUrl = 'http://127.0.0.1:8090'

function Get-MailHelperArgumentString {
    # Arguments for byl-mail.exe: fetch the mailboxes of the app's own PocketBase.
    return "run --url=$BylMailHelperUrl"
}

function Get-MailHelperLogPath {
    # Output of the helper (overwritten at every start, like the server log). It logs counts and
    # cleaned errors only, never access data or contents of mails.
    param([Parameter(Mandatory = $true)][string]$AppDir)

    $logDir = [System.IO.Path]::Combine($AppDir, 'logs')
    return [pscustomobject]@{
        Directory = $logDir
        Output    = [System.IO.Path]::Combine($logDir, 'byl-mail.log')
        Error     = [System.IO.Path]::Combine($logDir, 'byl-mail.err.log')
    }
}

function Select-MailHelperProcess {
    # Returns the app's own mail helper(s) from process objects shaped like Win32_Process, by the same
    # rules as Select-AppProcess: ExecutablePath = <AppDir>\byl-mail.exe, argument "run" and
    # --url=http://127.0.0.1:8090. Helpers of the tests (other folder or port), one-shot calls
    # (--version, --self-test) and processes with an unreadable command line never qualify.
    param([AllowNull()][object[]]$Process, [Parameter(Mandatory = $true)][string]$AppDir)

    $exePath = [System.IO.Path]::Combine($AppDir, $BylMailHelperName)
    foreach ($candidate in @($Process)) {
        if ($null -eq $candidate) { continue }
        if (-not (Test-SamePath -Path $candidate.ExecutablePath -Expected $exePath)) { continue }
        $allArguments = Split-CommandLine -CommandLine $candidate.CommandLine
        $arguments = @($allArguments | Select-Object -Skip 1)
        if ($arguments.Count -eq 0 -or $arguments[0] -cne 'run') { continue }
        if ((Get-FlagValue -Arguments $arguments -Name 'url') -cne $BylMailHelperUrl) { continue }
        $candidate
    }
}

function Stop-SelectedProcess {
    # Stops the processes of $Candidates by process id (stop.bat), each only if $Select still
    # chooses the process right before (the PID could have been reused since the snapshot).
    # The operations are parameters, so the tests run this with fake processes:
    #   $GetCurrent  param($ProcessId) -> process objects shaped like Win32_Process (none if gone),
    #   $StopProcess param($ProcessId) -> ends the process and waits for it; may throw,
    #   $Report      param($Text)      -> progress line ("Beende ..."),
    #   $StillRunningText              -> reason if the process runs on without an error (the text
    #                                     comes from byl-control.ps1: this file stays ASCII).
    # A process counts as failed only if $Select still chooses it afterwards: a stop that throws
    # because the process ended on its own is no failure, and a foreign process that reused the PID
    # is not "still running". Emits one readable line per failure, each as its own string (never a
    # nested array, which turned into "System.String[]" in the message of stop.bat).
    param(
        [AllowNull()][AllowEmptyCollection()][object[]]$Candidates,
        [Parameter(Mandatory = $true)][scriptblock]$Select,
        [Parameter(Mandatory = $true)][string]$Name,
        [Parameter(Mandatory = $true)][scriptblock]$GetCurrent,
        [Parameter(Mandatory = $true)][scriptblock]$StopProcess,
        [Parameter(Mandatory = $true)][string]$StillRunningText,
        [scriptblock]$Report = { param($Text) $null = $Text }
    )

    foreach ($candidate in @($Candidates)) {
        if ($null -eq $candidate) { continue }
        $processId = [int]$candidate.ProcessId
        if (@(& $Select @(& $GetCurrent $processId)).Count -eq 0) { continue }
        & $Report "Beende $Name (PID $processId) ..."
        $problem = $null
        try {
            & $StopProcess $processId
        }
        catch {
            $problem = $_.Exception.Message
        }
        if (@(& $Select @(& $GetCurrent $processId)).Count -eq 0) { continue }
        if ([string]::IsNullOrWhiteSpace($problem)) { $problem = $StillRunningText }
        [string]"$Name (PID $processId): $problem"
    }
}

function Get-MailHelperDecision {
    # Whether start.bat starts byl-mail.exe (E4 plan package 11): only if the file is in the app
    # folder, the ingest token is set, no own helper runs yet and PocketBase lists at least one
    # switched-on mail connection. $MailConnectionCount is the number PocketBase reported, -1 if it
    # could not be asked (the helper is started anyway and asks again every five minutes) and -2 if
    # PocketBase has no ingest route (it was started before the token existed).
    # Returns Start, Running, NoHelper, NoToken, NoConnection or NoRoute.
    param(
        [Parameter(Mandatory = $true)][bool]$HelperExists,
        [Parameter(Mandatory = $true)][bool]$TokenSet,
        [Parameter(Mandatory = $true)][bool]$Running,
        [Parameter(Mandatory = $true)][int]$MailConnectionCount
    )

    if (-not $HelperExists) { return 'NoHelper' }
    if ($Running) { return 'Running' }
    if (-not $TokenSet) { return 'NoToken' }
    if ($MailConnectionCount -eq -2) { return 'NoRoute' }
    if ($MailConnectionCount -eq 0) { return 'NoConnection' }
    return 'Start'
}

function ConvertFrom-MailConnectionAnswer {
    # Number of mail connections in the answer of GET /api/byl/ingest/connections: the length of
    # "items" for status 200, -2 for 404 (no ingest route), -1 for anything else.
    param([int]$StatusCode, [AllowNull()][AllowEmptyString()][string]$Body)

    if ($StatusCode -eq 404) { return -2 }
    if ($StatusCode -ne 200) { return -1 }
    try {
        $answer = $Body | ConvertFrom-Json
    }
    catch {
        return -1
    }
    if ($null -eq $answer -or $null -eq $answer.PSObject.Properties['items']) { return -1 }
    return @($answer.items).Count
}

# --- Open app tabs before opening the browser (ADR-0035 sections 3, 4 and 7, plan start-fenster SF-4)

$BylPresenceUrl = 'http://127.0.0.1:8090/api/byl/presence'
$BylAttentionUrl = 'http://127.0.0.1:8090/api/byl/attention'
$BylAttentionReasons = @('start', 'datei', 'stop')
# A landing page (file://) that reported within this window opens the app itself.
$BylLandingWindowMs = 10000
# After "stop.bat, then start.bat" the open tabs reconnect on their own (SDK steps of 0.2 to 2 s),
# so a cold start waits this long for them before it opens a tab.
$BylColdStartWaitMs = 3000
# How long start.bat waits for a tab to confirm the message, and the step of all waits.
$BylAckWaitMs = 2000
$BylPresencePollMs = 250
$BylRequestTimeoutMs = 1500

function Test-WholeNumber {
    # True for a whole number >= 0 as ConvertFrom-Json returns it (never a string or a boolean).
    param([AllowNull()][object]$Value)

    return ($Value -is [int] -or $Value -is [long]) -and $Value -ge 0
}

function Invoke-LocalRequest {
    # One request to the app on 127.0.0.1 without proxy and without Origin (the routes of
    # ADR-0035 answer scripts only). Returns StatusCode and Body, also for error statuses; $null
    # if there is no answer at all (not running, timeout). A POST sends an empty body.
    param(
        [Parameter(Mandatory = $true)][string]$Url,
        [ValidateSet('GET', 'POST')][string]$Method = 'GET',
        [int]$TimeoutMilliseconds = $BylRequestTimeoutMs
    )

    $request = [System.Net.WebRequest]::Create($Url)
    $request.Proxy = $null
    $request.Timeout = $TimeoutMilliseconds
    $request.KeepAlive = $false
    $request.Method = $Method
    if ($Method -eq 'POST') { $request.ContentLength = 0 }
    try {
        $response = $request.GetResponse()
    }
    catch [System.Net.WebException] {
        $response = $_.Exception.Response
        if ($null -eq $response) { return $null }
    }
    try {
        $reader = New-Object System.IO.StreamReader($response.GetResponseStream(), [System.Text.Encoding]::UTF8)
        return [pscustomobject]@{ StatusCode = [int]$response.StatusCode; Body = $reader.ReadToEnd() }
    }
    finally {
        $response.Close()
    }
}

function ConvertFrom-PresenceAnswer {
    # Tabs and LandingAgoMs ($null: no landing page lately) of GET /api/byl/presence; $null for
    # anything else (403, 404 before the restart, broken JSON, wrong types).
    param([int]$StatusCode, [AllowNull()][AllowEmptyString()][string]$Body)

    if ($StatusCode -ne 200) { return $null }
    try {
        $answer = $Body | ConvertFrom-Json
    }
    catch {
        return $null
    }
    if ($null -eq $answer -or $answer -isnot [pscustomobject]) { return $null }
    $tabs = $answer.PSObject.Properties['tabs']
    $landing = $answer.PSObject.Properties['landingAgoMs']
    if ($null -eq $tabs -or $null -eq $landing -or -not (Test-WholeNumber $tabs.Value)) { return $null }
    if ($null -ne $landing.Value -and -not (Test-WholeNumber $landing.Value)) { return $null }
    $landingAgo = if ($null -eq $landing.Value) { $null } else { [long]$landing.Value }
    return [pscustomobject]@{ Tabs = [int]$tabs.Value; LandingAgoMs = $landingAgo }
}

function ConvertFrom-AttentionAnswer {
    # Nonce and Notified of POST /api/byl/attention; $null for anything else (429, 403, broken
    # JSON). The nonce is checked before it ever goes into a URL.
    param([int]$StatusCode, [AllowNull()][AllowEmptyString()][string]$Body)

    if ($StatusCode -ne 200) { return $null }
    try {
        $answer = $Body | ConvertFrom-Json
    }
    catch {
        return $null
    }
    if ($null -eq $answer -or $answer -isnot [pscustomobject]) { return $null }
    $nonce = $answer.PSObject.Properties['nonce']
    $notified = $answer.PSObject.Properties['notified']
    if ($null -eq $nonce -or $nonce.Value -isnot [string] -or $nonce.Value -cnotmatch '^[A-Za-z0-9]{24}$') { return $null }
    if ($null -eq $notified -or -not (Test-WholeNumber $notified.Value)) { return $null }
    return [pscustomobject]@{ Nonce = [string]$nonce.Value; Notified = [int]$notified.Value }
}

function ConvertFrom-AttentionState {
    # True only if GET /api/byl/attention/{nonce} says that a tab confirmed.
    param([int]$StatusCode, [AllowNull()][AllowEmptyString()][string]$Body)

    if ($StatusCode -ne 200) { return $false }
    try {
        $answer = $Body | ConvertFrom-Json
    }
    catch {
        return $false
    }
    if ($null -eq $answer -or $answer -isnot [pscustomobject]) { return $false }
    $acked = $answer.PSObject.Properties['acked']
    return $null -ne $acked -and $acked.Value -is [bool] -and $acked.Value
}

function Get-AttentionUrl {
    # URL of the state of one message; throws for anything but a nonce of the server.
    param([AllowNull()][AllowEmptyString()][string]$Nonce)

    if ([string]::IsNullOrEmpty($Nonce) -or $Nonce -cnotmatch '^[A-Za-z0-9]{24}$') { throw 'Invalid nonce.' }
    return "$BylAttentionUrl/$Nonce"
}

function Get-AttentionSendUrl {
    # URL that sends a message with one of the known reasons; throws for any other.
    param([AllowNull()][AllowEmptyString()][string]$Reason)

    if ($BylAttentionReasons -cnotcontains $Reason) { throw 'Unknown reason.' }
    return "$($BylAttentionUrl)?reason=$Reason"
}

function Get-BrowserStep {
    # What start.bat does next with an answer of the presence route:
    #   Open      - no usable answer, or the time is up without an open tab (fail-open),
    #   Skip      - a landing page reported within LandingWindowMs (it opens the app itself),
    #   Attention - app tabs are open: send them the message and wait for a confirmation,
    #   Wait      - no tab yet, but a cold start still gives them time to reconnect.
    param(
        [AllowNull()][object]$Presence,
        [Parameter(Mandatory = $true)][double]$NowMs,
        [Parameter(Mandatory = $true)][double]$DeadlineMs,
        [int]$LandingWindowMs = $BylLandingWindowMs
    )

    if ($null -eq $Presence) { return 'Open' }
    if ($null -ne $Presence.LandingAgoMs -and $Presence.LandingAgoMs -lt $LandingWindowMs) { return 'Skip' }
    if ($Presence.Tabs -gt 0) { return 'Attention' }
    if ($NowMs -lt $DeadlineMs) { return 'Wait' }
    return 'Open'
}

function Wait-AttentionAck {
    # Asks $Poll (returns $true once a tab confirmed) every $IntervalMs until $TimeoutMs passed.
    # A $Poll that throws ends the wait with $false (fail-open), like the time running out.
    param(
        [Parameter(Mandatory = $true)][int]$TimeoutMs,
        [Parameter(Mandatory = $true)][int]$IntervalMs,
        [Parameter(Mandatory = $true)][scriptblock]$Poll,
        [scriptblock]$Now = { [DateTime]::UtcNow },
        [scriptblock]$Sleep = { param($Milliseconds) Start-Sleep -Milliseconds $Milliseconds }
    )

    $deadline = (& $Now).AddMilliseconds($TimeoutMs)
    while ($true) {
        try {
            $answer = & $Poll
        }
        catch {
            return $false
        }
        if ($answer -is [bool] -and $answer) { return $true }
        if ((& $Now) -ge $deadline) { return $false }
        & $Sleep $IntervalMs
    }
}

function Select-PwaShortcut {
    # The Start menu shortcut of the installed web app (ADR-0035 section 8), from objects with Path,
    # Name (file name without .lnk), TargetPath and Arguments. Chrome and Edge create it with the
    # name of the manifest, the target chrome_proxy.exe or msedge_proxy.exe and --app-id=<32 letters
    # a-p>; an --app-url, if present, must be the app on 127.0.0.1:8090. Returns the Path of the
    # first match (sorted by path) or $null.
    param([AllowNull()][AllowEmptyCollection()][object[]]$Shortcuts)

    $matching = @(@($Shortcuts) | Where-Object {
            $null -ne $_ -and
            [string]::Equals([string]$_.Name, 'becauseyoulovejira', [System.StringComparison]::OrdinalIgnoreCase) -and
            @('chrome_proxy.exe', 'msedge_proxy.exe') -contains ([System.IO.Path]::GetFileName([string]$_.TargetPath)).ToLowerInvariant() -and
            [string]$_.Arguments -cmatch '(^|\s)--app-id=[a-p]{32}(\s|$)' -and
            ([string]$_.Arguments -notmatch '--app-url=' -or [string]$_.Arguments -match '(^|\s)"?--app-url=http://127\.0\.0\.1:8090/?(\s|"|$)')
        } | Sort-Object -Property Path)
    if ($matching.Count -eq 0) { return $null }
    return [string]$matching[0].Path
}

function Resolve-BrowserAction {
    # Whether start.bat opens a browser tab ('Open') or leaves it to an open tab or the landing
    # page ('Skip'). The requests are parameters, so the tests run this with fakes:
    #   $GetPresence   -> result of ConvertFrom-PresenceAnswer ($null on any failure),
    #   $SendAttention -> result of ConvertFrom-AttentionAnswer ($null on any failure),
    #   $GetAcked      param($Nonce) -> $true once a tab confirmed.
    # $ColdStart: the server was just started, the tabs get $ColdStartWaitMs to reconnect. Any
    # error means 'Open': better a second tab than none.
    param(
        [Parameter(Mandatory = $true)][bool]$ColdStart,
        [Parameter(Mandatory = $true)][scriptblock]$GetPresence,
        [Parameter(Mandatory = $true)][scriptblock]$SendAttention,
        [Parameter(Mandatory = $true)][scriptblock]$GetAcked,
        [scriptblock]$Now = { [DateTime]::UtcNow },
        [scriptblock]$Sleep = { param($Milliseconds) Start-Sleep -Milliseconds $Milliseconds },
        [int]$ColdStartWaitMs = $BylColdStartWaitMs,
        [int]$AckWaitMs = $BylAckWaitMs,
        [int]$PollMs = $BylPresencePollMs
    )

    try {
        $started = & $Now
        $deadlineMs = if ($ColdStart) { $ColdStartWaitMs } else { 0 }
        while ($true) {
            $elapsedMs = ((& $Now) - $started).TotalMilliseconds
            $step = Get-BrowserStep -Presence (& $GetPresence) -NowMs $elapsedMs -DeadlineMs $deadlineMs
            if ($step -eq 'Open' -or $step -eq 'Skip') { return $step }
            if ($step -eq 'Wait') {
                & $Sleep $PollMs
                continue
            }
            $sent = & $SendAttention
            if ($null -eq $sent -or $sent.Notified -lt 1) { return 'Open' }
            $nonce = $sent.Nonce
            $acked = Wait-AttentionAck -TimeoutMs $AckWaitMs -IntervalMs $PollMs -Now $Now -Sleep $Sleep -Poll { & $GetAcked $nonce }
            if ($acked) { return 'Skip' }
            return 'Open'
        }
    }
    catch {
        return 'Open'
    }
}
