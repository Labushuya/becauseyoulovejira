# Functions for byl-control.ps1: start, stop, restart, status and autostart of becauseyoulovejira
# (E1 plan package 8, ADR-0039).
#
# Dot-sourced by byl-control.ps1 and by the tests; loading the file has no side effects. The
# selection and decision logic is pure (every input is a parameter), so the tests check it with
# fake processes, sockets, files and log texts. The file stays ASCII: German texts for the user
# live in byl-control.ps1 (UTF-8 with BOM).

# --- Address and port (ADR-0039 section 2) ----------------------------------------------------

# Standard port of the app. The only place to change it is byl-config.json in the app folder
# ({"port": <number>}, written by "byl-control.ps1 port <number>"); the app always binds to the
# loopback address 127.0.0.1 (CLAUDE.md section 3).
$BylDefaultPort = 8090
$BylPortMin = 1024
$BylPortMax = 65535
$BylConfigName = 'byl-config.json'
# PocketBase prints the installer link (/_/#/pbinstall/<token>) while no superuser exists.
$BylInstallerMarker = 'pbinstal'
$BylShortcutName = 'becauseyoulovejira.lnk'

function Set-BylAddress {
    # Points every address of this file at http://127.0.0.1:<Port>. Called once at load time with
    # the standard port, and by byl-control.ps1 with the configured port or the port of the running
    # instance.
    param([Parameter(Mandatory = $true)][ValidateRange(1, 65535)][int]$Port)

    $script:BylPort = $Port
    $script:BylAppUrl = "http://127.0.0.1:$Port/"
    $script:BylHealthUrl = "http://127.0.0.1:$Port/api/health"
    $script:BylPresenceUrl = "http://127.0.0.1:$Port/api/byl/presence"
    $script:BylAttentionUrl = "http://127.0.0.1:$Port/api/byl/attention"
    # The mail helper talks to the app's own PocketBase only.
    $script:BylMailHelperUrl = "http://127.0.0.1:$Port"
}

Set-BylAddress -Port $BylDefaultPort

function Test-PortNumber {
    # True for a whole number in the allowed range (no system ports below 1024).
    param([AllowNull()][object]$Value)

    return ($Value -is [int] -or $Value -is [long]) -and $Value -ge $BylPortMin -and $Value -le $BylPortMax
}

function ConvertTo-PortNumber {
    # Port from user input ("8091"); $null for anything but digits in the allowed range.
    param([AllowNull()][AllowEmptyString()][string]$Text)

    if ([string]::IsNullOrWhiteSpace($Text) -or $Text.Trim() -notmatch '^\d{1,5}$') { return $null }
    $port = [int]$Text.Trim()
    if (-not (Test-PortNumber $port)) { return $null }
    return $port
}

function Get-BylConfigPath {
    param([Parameter(Mandatory = $true)][string]$AppDir)

    return [System.IO.Path]::Combine($AppDir, $BylConfigName)
}

function ConvertFrom-BylConfig {
    # Settings from the text of byl-config.json. No text (no file) or no "port" means the standard
    # port. Returns Port and Problem: $null, 'Json' (not a JSON object) or 'Port' (not a number in
    # the allowed range); with a problem Port is the standard port and the caller refuses to start,
    # so a typing error never moves the app to an address nobody expects.
    param([AllowNull()][AllowEmptyString()][string]$Text)

    $standard = [pscustomobject]@{ Port = $BylDefaultPort; Problem = $null }
    if ([string]::IsNullOrWhiteSpace($Text)) { return $standard }
    try {
        $value = $Text | ConvertFrom-Json
    }
    catch {
        return [pscustomobject]@{ Port = $BylDefaultPort; Problem = 'Json' }
    }
    # The full type name: "-is [pscustomobject]" is true for every wrapped object, arrays included.
    if ($null -eq $value -or $value -isnot [System.Management.Automation.PSCustomObject]) {
        return [pscustomobject]@{ Port = $BylDefaultPort; Problem = 'Json' }
    }
    $port = $value.PSObject.Properties['port']
    if ($null -eq $port) { return $standard }
    if (-not (Test-PortNumber $port.Value)) {
        return [pscustomobject]@{ Port = $BylDefaultPort; Problem = 'Port' }
    }
    return [pscustomobject]@{ Port = [int]$port.Value; Problem = $null }
}

function ConvertTo-BylConfigText {
    # Text of byl-config.json for $Port.
    param([Parameter(Mandatory = $true)][int]$Port)

    return "{`r`n  `"port`": $Port`r`n}`r`n"
}

function Find-NextFreePort {
    # The next port after $Start that $IsFree accepts (param($Port) -> $true if nothing listens),
    # at most $Attempts ports; skips $Skip (8099 is kept for spikes, CLAUDE.md section 11). $null if
    # none is found.
    param(
        [Parameter(Mandatory = $true)][int]$Start,
        [Parameter(Mandatory = $true)][scriptblock]$IsFree,
        [int]$Attempts = 50,
        [int[]]$Skip = @(8099)
    )

    $port = $Start
    for ($tried = 0; $tried -lt $Attempts; $tried++) {
        $port++
        if ($port -gt $BylPortMax) { return $null }
        if ($Skip -contains $port) { continue }
        if (& $IsFree $port) { return $port }
    }
    return $null
}

# --- Runtime files (ADR-0039 section 3) --------------------------------------------------------

function Get-BylRunPath {
    # Folder run\ in the app folder (gitignored): the state file of the running instance and the
    # address for the landing page becauseyoulovejira.html.
    param([Parameter(Mandatory = $true)][string]$AppDir)

    $runDir = [System.IO.Path]::Combine($AppDir, 'run')
    return [pscustomobject]@{
        Directory = $runDir
        State     = [System.IO.Path]::Combine($runDir, 'byl.state.json')
        Address   = [System.IO.Path]::Combine($runDir, 'app-adresse.js')
    }
}

function ConvertTo-AddressScript {
    # run\app-adresse.js: the landing page (file://) loads it as a classic script, because a page
    # under file:// may not read other files; without it the page uses the standard port.
    param([Parameter(Mandatory = $true)][int]$Port)

    return "// Written by byl-control.ps1: the address of the app for becauseyoulovejira.html.`r`n" +
        "window.BYL_APP_URL = 'http://127.0.0.1:$Port/';`r`n"
}

function ConvertTo-BylStateText {
    # Text of the state file. Holds no secrets: process id, port, times, the start fingerprint
    # (hashes and file stamps; the BYL_* variables only as keyed hash) and the key of that hash,
    # encrypted for the Windows account ($EnvironmentKey, Base64 of DPAPI).
    param(
        [Parameter(Mandatory = $true)][int]$ProcessId,
        [Parameter(Mandatory = $true)][int]$Port,
        [Parameter(Mandatory = $true)][DateTime]$ProcessStartUtc,
        [Parameter(Mandatory = $true)][DateTime]$StartedUtc,
        [AllowNull()][System.Collections.IDictionary]$Fingerprint,
        [AllowNull()][AllowEmptyString()][string]$EnvironmentKey
    )

    $state = [ordered]@{
        schema          = 1
        pid             = $ProcessId
        port            = $Port
        processStartUtc = $ProcessStartUtc.ToUniversalTime().ToString('o')
        startedUtc      = $StartedUtc.ToUniversalTime().ToString('o')
        fingerprint     = $Fingerprint
        environmentKey  = if ([string]::IsNullOrEmpty($EnvironmentKey)) { $null } else { $EnvironmentKey }
    }
    return ($state | ConvertTo-Json -Depth 4)
}

function ConvertFrom-BylState {
    # The state file as object (ProcessId, Port, ProcessStartUtc, StartedUtc, Fingerprint as
    # hashtable of strings or $null, EnvironmentKey or $null); $null if the text is no valid state.
    param([AllowNull()][AllowEmptyString()][string]$Text)

    if ([string]::IsNullOrWhiteSpace($Text)) { return $null }
    try {
        $value = $Text | ConvertFrom-Json
    }
    catch {
        return $null
    }
    if ($null -eq $value -or $value -isnot [System.Management.Automation.PSCustomObject]) { return $null }
    $get = {
        param($Name)
        $property = $value.PSObject.Properties[$Name]
        if ($null -eq $property) { $null } else { $property.Value }
    }
    $processId = & $get 'pid'
    $port = & $get 'port'
    if (-not (Test-WholeNumber $processId) -or $processId -eq 0) { return $null }
    if (-not (Test-WholeNumber $port) -or $port -lt 1 -or $port -gt 65535) { return $null }
    $times = @{}
    foreach ($name in @('processStartUtc', 'startedUtc')) {
        $raw = & $get $name
        if ($raw -is [DateTime]) {
            $times[$name] = $raw.ToUniversalTime()
            continue
        }
        $parsed = [DateTime]::MinValue
        if ($raw -isnot [string] -or -not [DateTime]::TryParse($raw, [Globalization.CultureInfo]::InvariantCulture,
                [Globalization.DateTimeStyles]::RoundtripKind, [ref]$parsed)) { return $null }
        $times[$name] = $parsed.ToUniversalTime()
    }
    $fingerprint = $null
    $rawFingerprint = & $get 'fingerprint'
    if ($rawFingerprint -is [System.Management.Automation.PSCustomObject]) {
        $fingerprint = @{}
        foreach ($property in $rawFingerprint.PSObject.Properties) { $fingerprint[$property.Name] = [string]$property.Value }
    }
    $key = & $get 'environmentKey'
    return [pscustomobject]@{
        ProcessId       = [int]$processId
        Port            = [int]$port
        ProcessStartUtc = $times['processStartUtc']
        StartedUtc      = $times['startedUtc']
        Fingerprint     = $fingerprint
        EnvironmentKey  = if ($key -is [string] -and $key -match '^[A-Za-z0-9+/=]+$') { $key } else { $null }
    }
}

function Resolve-StateMatch {
    # Whether the state file describes one of the own running instances $Own (process objects with
    # ProcessId and CreationDate): 'Match' for the same process id and a process start within
    # $ToleranceSeconds of the saved one, 'Stale' otherwise (the process ended, or Windows reused its
    # id), 'None' without a state. The caller removes a stale file.
    param(
        [AllowNull()][object]$State,
        [AllowNull()][AllowEmptyCollection()][object[]]$Own,
        [int]$ToleranceSeconds = 2
    )

    if ($null -eq $State) { return 'None' }
    foreach ($process in @($Own)) {
        if ($null -eq $process -or [int]$process.ProcessId -ne $State.ProcessId) { continue }
        if ($null -eq $process.CreationDate) { return 'Stale' }
        $difference = ([DateTime]$process.CreationDate).ToUniversalTime() - $State.ProcessStartUtc
        if ([Math]::Abs($difference.TotalSeconds) -le $ToleranceSeconds) { return 'Match' }
        return 'Stale'
    }
    return 'Stale'
}

# --- Start fingerprint and reload (ADR-0039 section 5) ------------------------------------------

# Parts whose change needs a restart of PocketBase, and parts that only need a reload (F5) of the
# open tabs. PocketBase 0.40.4 does not reload pb_hooks on Windows ("--hooksWatch ... has no effect
# on Windows"), runs new migrations only at the start and serves pb_public fresh at every request.
$BylRestartParts = @('server', 'migrations', 'hooks', 'port', 'environment', 'mailHelper')
$BylReloadParts = @('web')

function Get-BytesHash {
    # SHA-256 of $Bytes as lower-case hex.
    param([Parameter(Mandatory = $true)][AllowEmptyCollection()][byte[]]$Bytes)

    $sha = [System.Security.Cryptography.SHA256]::Create()
    try {
        return ([BitConverter]::ToString($sha.ComputeHash($Bytes)) -replace '-', '').ToLowerInvariant()
    }
    finally {
        $sha.Dispose()
    }
}

function Get-FolderHash {
    # SHA-256 over the relative names (lower case, "/") and the contents of the files *.js in
    # $Folder (with -Recurse also below it), in ordinal order of the names; '' if the folder is
    # missing.
    param([Parameter(Mandatory = $true)][string]$Folder, [switch]$Recurse)

    if (-not [System.IO.Directory]::Exists($Folder)) { return '' }
    $option = if ($Recurse) { [System.IO.SearchOption]::AllDirectories } else { [System.IO.SearchOption]::TopDirectoryOnly }
    $root = [System.IO.Path]::GetFullPath($Folder).TrimEnd('\') + '\'
    $byName = @{}
    foreach ($path in [System.IO.Directory]::GetFiles($Folder, '*.js', $option)) {
        $byName[[System.IO.Path]::GetFullPath($path).Substring($root.Length).Replace('\', '/').ToLowerInvariant()] = $path
    }
    $names = [string[]]@($byName.Keys)
    [Array]::Sort($names, [StringComparer]::Ordinal)
    $builder = New-Object System.Text.StringBuilder
    foreach ($name in $names) {
        [void]$builder.Append($name).Append("`n")
        [void]$builder.Append((Get-BytesHash -Bytes ([System.IO.File]::ReadAllBytes($byName[$name])))).Append("`n")
    }
    return Get-BytesHash -Bytes ([System.Text.Encoding]::UTF8.GetBytes($builder.ToString()))
}

function Get-FileStamp {
    # Length and last write time (UTC ticks) of a large file such as pocketbase.exe, instead of a
    # hash of 30 to 90 MB at every status; '' if the file is missing.
    param([Parameter(Mandatory = $true)][string]$Path)

    if (-not [System.IO.File]::Exists($Path)) { return '' }
    $info = New-Object System.IO.FileInfo($Path)
    return '{0}:{1}' -f $info.Length, $info.LastWriteTimeUtc.Ticks
}

function Get-WebBuildId {
    # Identity of the web build in pb_public: the hash of _app\version.json (SvelteKit writes a new
    # version at every build), else of index.html; '' without a build.
    param([Parameter(Mandatory = $true)][string]$AppDir)

    foreach ($relative in @('pb_public\_app\version.json', 'pb_public\index.html')) {
        $path = [System.IO.Path]::Combine($AppDir, $relative)
        if ([System.IO.File]::Exists($path)) { return Get-BytesHash -Bytes ([System.IO.File]::ReadAllBytes($path)) }
    }
    return ''
}

function Get-BylVariableName {
    # Names of the BYL_* variables PocketBase gets at a start: the valid names of the user and the
    # machine scope (Sync-BylEnvironment), sorted and without duplicates. Names only, never values.
    param(
        [AllowEmptyCollection()][string[]]$UserNames = @(),
        [AllowEmptyCollection()][string[]]$MachineNames = @()
    )

    $names = [string[]]@(@($UserNames) + @($MachineNames) | Where-Object { $_ -cmatch $BylSecretNamePattern } | Select-Object -Unique)
    [Array]::Sort($names, [StringComparer]::Ordinal)
    return , $names
}

function Get-EnvironmentHash {
    # HMAC-SHA256 with $Key over the entries "NAME=VALUE" of the BYL_* variables a start hands to
    # PocketBase, in ordinal order: changes of names AND values show, but the values never leave
    # memory. The key is random per start and lies in the state file only encrypted for the Windows
    # account (DPAPI, byl-control.ps1), so the hash cannot be attacked offline; whoever can decrypt
    # it can read the variables anyway.
    param(
        [AllowEmptyCollection()][string[]]$Entries = @(),
        [Parameter(Mandatory = $true)][byte[]]$Key
    )

    $sorted = [string[]]@($Entries | Where-Object { $null -ne $_ })
    [Array]::Sort($sorted, [StringComparer]::Ordinal)
    $hmac = New-Object System.Security.Cryptography.HMACSHA256 (, $Key)
    try {
        $digest = $hmac.ComputeHash([System.Text.Encoding]::UTF8.GetBytes(($sorted -join "`n")))
        return ([BitConverter]::ToString($digest) -replace '-', '').ToLowerInvariant()
    }
    finally {
        $hmac.Dispose()
    }
}

function Get-BylFingerprint {
    # Start fingerprint of the app folder: what a server started now would load. $EnvironmentHash is
    # Get-EnvironmentHash of the BYL_* variables ('' if it cannot be built).
    param(
        [Parameter(Mandatory = $true)][string]$AppDir,
        [Parameter(Mandatory = $true)][int]$Port,
        [AllowEmptyString()][string]$EnvironmentHash = ''
    )

    return [ordered]@{
        server      = Get-FileStamp -Path ([System.IO.Path]::Combine($AppDir, 'pocketbase.exe'))
        migrations  = Get-FolderHash -Folder ([System.IO.Path]::Combine($AppDir, 'pb_migrations'))
        hooks       = Get-FolderHash -Folder ([System.IO.Path]::Combine($AppDir, 'pb_hooks')) -Recurse
        port        = [string]$Port
        environment = $EnvironmentHash
        mailHelper  = Get-FileStamp -Path ([System.IO.Path]::Combine($AppDir, $BylMailHelperName))
        web         = Get-WebBuildId -AppDir $AppDir
    }
}

function Compare-BylFingerprint {
    # What the running instance needs, from the fingerprint of its start ($Started, $null if it
    # is unknown: started by an older script or without state file) and the current one:
    #   Verdict 'Current' (nothing), 'Reload' (only the open tabs: F5) or 'Restart',
    #   Restart  the changed parts that need a restart ('unknown' without a start fingerprint),
    #   Reload   the changed parts that need a reload only.
    param(
        [AllowNull()][System.Collections.IDictionary]$Started,
        [Parameter(Mandatory = $true)][System.Collections.IDictionary]$Current
    )

    $restart = New-Object System.Collections.Generic.List[string]
    $reload = New-Object System.Collections.Generic.List[string]
    if ($null -eq $Started) {
        $restart.Add('unknown')
    }
    else {
        foreach ($part in $BylRestartParts) {
            if (-not [string]::Equals([string]$Started[$part], [string]$Current[$part], [System.StringComparison]::Ordinal)) { $restart.Add($part) }
        }
        foreach ($part in $BylReloadParts) {
            if (-not [string]::Equals([string]$Started[$part], [string]$Current[$part], [System.StringComparison]::Ordinal)) { $reload.Add($part) }
        }
    }
    $verdict = if ($restart.Count -gt 0) { 'Restart' } elseif ($reload.Count -gt 0) { 'Reload' } else { 'Current' }
    return [pscustomobject]@{ Verdict = $verdict; Restart = @($restart.ToArray()); Reload = @($reload.ToArray()) }
}

# --- Decisions of the commands (ADR-0039 section 4) ---------------------------------------------

# Exit codes of byl-control.ps1 (documented in its help and in ADR-0039).
$BylExitOk = 0
$BylExitError = 1
$BylExitSetupPending = 2
$BylExitNotRunning = 3
$BylExitPortBusy = 4
$BylExitUnhealthy = 5
$BylExitRestartNeeded = 6

function Resolve-ServerState {
    # State of the own instance from the facts of one look:
    #   Stopped   - no own process,
    #   Running   - own process and /api/health answers,
    #   Starting  - own process without an answer, younger than $StartGraceSeconds,
    #   Unhealthy - own process without an answer for longer.
    param(
        [Parameter(Mandatory = $true)][bool]$ProcessFound,
        [Parameter(Mandatory = $true)][bool]$Healthy,
        [double]$AgeSeconds = [double]::MaxValue,
        [int]$StartGraceSeconds = 30
    )

    if (-not $ProcessFound) { return 'Stopped' }
    if ($Healthy) { return 'Running' }
    if ($AgeSeconds -lt $StartGraceSeconds) { return 'Starting' }
    return 'Unhealthy'
}

function Resolve-StartAction {
    # What "start" does: Open (runs: only open the browser), Wait (starts right now), Unhealthy
    # (runs without answering: report, restart only with -Force), Restart (-Force), PortBusy (a
    # foreign program listens on the port: report, never stop it) or Start.
    param(
        [Parameter(Mandatory = $true)][ValidateSet('Stopped', 'Running', 'Starting', 'Unhealthy')][string]$ServerState,
        [Parameter(Mandatory = $true)][ValidateSet('Free', 'App', 'Foreign')][string]$PortState,
        [bool]$Force = $false
    )

    if ($ServerState -eq 'Running') { return 'Open' }
    if ($ServerState -eq 'Starting') { return 'Wait' }
    if ($ServerState -eq 'Unhealthy') {
        if ($Force) { return 'Restart' }
        return 'Unhealthy'
    }
    if ($PortState -eq 'Foreign') { return 'PortBusy' }
    return 'Start'
}

function Resolve-ReloadAction {
    # What "reload" (neu-starten.bat) does: Start (nothing runs), Restart (-Force, no answer, or a
    # change that needs it), ReloadOnly (only the web build changed: F5 in the open tabs) or
    # Nothing. An instance that is starting right now is left alone (Wait).
    param(
        [Parameter(Mandatory = $true)][ValidateSet('Stopped', 'Running', 'Starting', 'Unhealthy')][string]$ServerState,
        [Parameter(Mandatory = $true)][ValidateSet('Current', 'Reload', 'Restart')][string]$Verdict,
        [bool]$Force = $false
    )

    if ($ServerState -eq 'Stopped') { return 'Start' }
    if ($ServerState -eq 'Starting' -and -not $Force) { return 'Wait' }
    if ($Force -or $ServerState -eq 'Unhealthy' -or $Verdict -eq 'Restart') { return 'Restart' }
    if ($Verdict -eq 'Reload') { return 'ReloadOnly' }
    return 'Nothing'
}

function Resolve-StatusExitCode {
    # Exit code of "status": 3 not running, 5 no answer (also while starting), 6 runs but needs a
    # restart, 0 otherwise (also when only a reload of the tabs is due).
    param(
        [Parameter(Mandatory = $true)][ValidateSet('Stopped', 'Running', 'Starting', 'Unhealthy')][string]$ServerState,
        [Parameter(Mandatory = $true)][ValidateSet('Current', 'Reload', 'Restart')][string]$Verdict
    )

    if ($ServerState -eq 'Stopped') { return $BylExitNotRunning }
    if ($ServerState -ne 'Running') { return $BylExitUnhealthy }
    if ($Verdict -eq 'Restart') { return $BylExitRestartNeeded }
    return $BylExitOk
}

function Get-DiskVerdict {
    # Free space on the drive of the app folder: Ok, Low (below 500 MB: warn) or Critical (below
    # 100 MB: SQLite and the backups may fail).
    param([Parameter(Mandatory = $true)][long]$FreeBytes)

    if ($FreeBytes -lt 100MB) { return 'Critical' }
    if ($FreeBytes -lt 500MB) { return 'Low' }
    return 'Ok'
}

# --- Processes ---------------------------------------------------------------------------------

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

function Test-FileInFolder {
    # True if $Path is a fully qualified path of a file directly in $Folder (Test-SamePath rules).
    param([AllowNull()][AllowEmptyString()][string]$Path, [Parameter(Mandatory = $true)][string]$Folder)

    if ([string]::IsNullOrWhiteSpace($Path) -or $Path -notmatch '^(?:[A-Za-z]:[\\/]|[\\/]{2}[^\\/])') { return $false }
    try {
        $parent = [System.IO.Path]::GetDirectoryName([System.IO.Path]::GetFullPath($Path).TrimEnd('\'))
    }
    catch {
        return $false
    }
    if ([string]::IsNullOrEmpty($parent)) { return $false }
    return Test-SamePath -Path $parent -Expected $Folder
}

function Get-HttpPort {
    # Port of a --http value "127.0.0.1:<port>"; $null for any other host (0.0.0.0, a name, IPv6)
    # or form.
    param([AllowNull()][AllowEmptyString()][string]$Value)

    if ([string]::IsNullOrEmpty($Value) -or $Value -cnotmatch '^127\.0\.0\.1:(\d{1,5})$') { return $null }
    $port = [int]$Matches[1]
    if ($port -lt 1 -or $port -gt 65535) { return $null }
    return $port
}

function Get-ProcessArgument {
    # Arguments of a process object shaped like Win32_Process, without the program itself.
    param([AllowNull()][object]$Process)

    if ($null -eq $Process) { return , @() }
    # Assign first: Split-CommandLine emits the whole array as ONE pipeline object.
    $allArguments = Split-CommandLine -CommandLine $Process.CommandLine
    return , @($allArguments | Select-Object -Skip 1)
}

function Get-ServerProcessPort {
    # Port of a PocketBase server process from its --http flag; $null if it is not 127.0.0.1:<port>.
    param([AllowNull()][object]$Process)

    return Get-HttpPort -Value (Get-FlagValue -Arguments (Get-ProcessArgument -Process $Process) -Name 'http')
}

function Select-AppProcess {
    # Returns the app's own PocketBase instance(s) from process objects shaped like Win32_Process
    # (ProcessId, ExecutablePath, CommandLine). A process qualifies only if ALL of this holds:
    #   ExecutablePath = <AppDir>\pocketbase.exe, argument "serve", --http=127.0.0.1:<any port> and
    #   --dir=<AppDir>\pb_data.
    # The program path in this folder is the safety rule of stop (ADR-0039 section 4): a copy of the
    # app in another folder never qualifies, whatever its port. Test instances of the harness (same
    # exe, --dir in the temp folder), one-shot commands (superuser, migrate), servers bound to other
    # addresses and processes whose command line is unreadable (other users) never qualify either.
    param([AllowNull()][object[]]$Process, [Parameter(Mandatory = $true)][string]$AppDir)

    $exePath = [System.IO.Path]::Combine($AppDir, 'pocketbase.exe')
    $dataDir = [System.IO.Path]::Combine($AppDir, 'pb_data')
    foreach ($candidate in @($Process)) {
        if ($null -eq $candidate) { continue }
        if (-not (Test-SamePath -Path $candidate.ExecutablePath -Expected $exePath)) { continue }
        $arguments = Get-ProcessArgument -Process $candidate
        if ($arguments -cnotcontains 'serve') { continue }
        if ($null -eq (Get-HttpPort -Value (Get-FlagValue -Arguments $arguments -Name 'http'))) { continue }
        if (-not (Test-SamePath -Path (Get-FlagValue -Arguments $arguments -Name 'dir') -Expected $dataDir)) { continue }
        $candidate
    }
}

function Select-OtherServerProcess {
    # PocketBase servers ("serve") that are not the own instance: a copy of the app in another
    # folder or a test instance. Only reported (status, doctor), never stopped. Returns ProcessId,
    # ExecutablePath, Port ($null if not on 127.0.0.1) and SameFolder (the program of this folder
    # with another data folder, e.g. the test harness).
    param([AllowNull()][object[]]$Process, [Parameter(Mandatory = $true)][string]$AppDir)

    $ownIds = @(Select-AppProcess -Process $Process -AppDir $AppDir | ForEach-Object { [int]$_.ProcessId })
    foreach ($candidate in @($Process)) {
        if ($null -eq $candidate -or $ownIds -contains [int]$candidate.ProcessId) { continue }
        $path = [string]$candidate.ExecutablePath
        $name = if ($path) { [System.IO.Path]::GetFileName($path) } else { [string]$candidate.Name }
        if (-not [string]::Equals($name, 'pocketbase.exe', [System.StringComparison]::OrdinalIgnoreCase)) { continue }
        if ((Get-ProcessArgument -Process $candidate) -cnotcontains 'serve') { continue }
        [pscustomobject]@{
            ProcessId      = [int]$candidate.ProcessId
            ExecutablePath = if ($path) { $path } else { $null }
            Port           = Get-ServerProcessPort -Process $candidate
            SameFolder     = Test-FileInFolder -Path $path -Folder $AppDir
        }
    }
}

function Resolve-PortState {
    # Classifies LISTEN sockets shaped like Get-NetTCPConnection (LocalAddress, LocalPort,
    # OwningProcess) for http://127.0.0.1:<Port>:
    #   App     - the own instance (Select-AppProcess) listens on 127.0.0.1:<Port>,
    #   Foreign - another process listens on 127.0.0.1, 0.0.0.0 or :: (the wildcards accept
    #             127.0.0.1 as well); ProcessId, ProcessName and ExecutablePath name the owner,
    #   Free    - nothing relevant listens (a socket on ::1 or another address does not collide).
    param(
        [AllowNull()][object[]]$Listener,
        [AllowNull()][object[]]$Process,
        [Parameter(Mandatory = $true)][string]$AppDir,
        [int]$Port = $BylPort
    )

    $relevant = @(@($Listener) | Where-Object {
            $null -ne $_ -and [int]$_.LocalPort -eq $Port -and @('127.0.0.1', '0.0.0.0', '::') -contains [string]$_.LocalAddress
        })
    if ($relevant.Count -eq 0) {
        return [pscustomobject]@{ State = 'Free'; ProcessId = $null; ProcessName = $null; ExecutablePath = $null }
    }
    $ownIds = @(Select-AppProcess -Process $Process -AppDir $AppDir | ForEach-Object { [int]$_.ProcessId })
    $own = @($relevant | Where-Object { [string]$_.LocalAddress -eq '127.0.0.1' -and $ownIds -contains [int]$_.OwningProcess })
    if ($own.Count -gt 0) {
        return [pscustomobject]@{
            State          = 'App'
            ProcessId      = [int]$own[0].OwningProcess
            ProcessName    = 'pocketbase.exe'
            ExecutablePath = [System.IO.Path]::Combine($AppDir, 'pocketbase.exe')
        }
    }
    $foreign = @($relevant | Where-Object { $ownIds -notcontains [int]$_.OwningProcess })
    if ($foreign.Count -eq 0) { $foreign = $relevant }
    $ownerId = [int]$foreign[0].OwningProcess
    $owner = @(@($Process) | Where-Object { $null -ne $_ -and [int]$_.ProcessId -eq $ownerId })
    $ownerName = if ($owner.Count -gt 0 -and $owner[0].Name) { [string]$owner[0].Name } else { 'unbekanntes Programm' }
    $ownerPath = if ($owner.Count -gt 0 -and $owner[0].ExecutablePath) { [string]$owner[0].ExecutablePath } else { $null }
    return [pscustomobject]@{ State = 'Foreign'; ProcessId = $ownerId; ProcessName = $ownerName; ExecutablePath = $ownerPath }
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

# --- Logs (ADR-0039 section 6) ------------------------------------------------------------------

# Log of byl-control.ps1 itself: one line per command (time, command, exit code, process id and
# port), never values of variables, passwords, e-mail addresses or contents. Rotated at this size.
$BylControlLogLimitBytes = 1MB

function Get-ControlLogPath {
    param([Parameter(Mandatory = $true)][string]$AppDir)

    return [System.IO.Path]::Combine($AppDir, 'logs', 'byl-control.log')
}

function Get-RotatedLogPath {
    # <name>.log -> <name>.1.log
    param([Parameter(Mandatory = $true)][string]$Path)

    $directory = [System.IO.Path]::GetDirectoryName($Path)
    $name = [System.IO.Path]::GetFileNameWithoutExtension($Path)
    return [System.IO.Path]::Combine($directory, "$name.1.log")
}

function Invoke-LogRotation {
    # Keeps one older generation: moves $Path to <name>.1.log (replacing it) if it exists and is at
    # least $LimitBytes long (0: always). Never fails the caller: a log that another process still
    # holds open simply stays.
    param([Parameter(Mandatory = $true)][string]$Path, [long]$LimitBytes = 0)

    try {
        if (-not [System.IO.File]::Exists($Path)) { return }
        if ((New-Object System.IO.FileInfo($Path)).Length -lt $LimitBytes) { return }
        $rotated = Get-RotatedLogPath -Path $Path
        if ([System.IO.File]::Exists($rotated)) { [System.IO.File]::Delete($rotated) }
        [System.IO.File]::Move($Path, $rotated)
    }
    catch {
        $null = $_
    }
}

function Format-ControlLogLine {
    # One line of byl-control.log: UTC time, command, exit code and details (key=value pairs of
    # numbers and fixed words only; line breaks are removed).
    param(
        [Parameter(Mandatory = $true)][DateTime]$TimeUtc,
        [Parameter(Mandatory = $true)][string]$Command,
        [Parameter(Mandatory = $true)][int]$ExitCode,
        [AllowEmptyString()][string]$Detail = ''
    )

    $line = '{0} {1} exit={2}' -f $TimeUtc.ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ'), $Command, $ExitCode
    if (-not [string]::IsNullOrWhiteSpace($Detail)) { $line += ' ' + ($Detail -replace '[\r\n]+', ' ').Trim() }
    return $line
}

function Get-LogTailLines {
    # The last $Count non-empty lines of $Text.
    param([AllowNull()][AllowEmptyString()][string]$Text, [int]$Count = 20)

    $lines = @(([string]$Text) -split "`r?`n" | Where-Object { $_.Trim() -ne '' })
    if ($lines.Count -le $Count) { return , $lines }
    return , @($lines | Select-Object -Last $Count)
}

# Log lines for the page System of the app (logs -Json, ADR-0043): values shorter than this are not
# replaced (they would hit ordinary words), and a line is cut to this length.
$BylLogSecretMinLength = 4
$BylLogLineMax = 2000

function Protect-LogText {
    # A log line without the values in $Secrets (the BYL_* variables): every value of at least
    # $BylLogSecretMinLength characters becomes ***, also URL-encoded, the longest first; the line
    # is cut to $BylLogLineMax characters. The same rule as secrets.redact of the hooks, which the
    # route applies on top (URLs, tokens, e-mail addresses).
    param([AllowNull()][AllowEmptyString()][string]$Text, [AllowEmptyCollection()][AllowNull()][string[]]$Secrets = @())

    $result = [string]$Text
    $values = @(@($Secrets) | Where-Object { $null -ne $_ -and $_.Length -ge $BylLogSecretMinLength } |
            Sort-Object -Property Length -Descending)
    foreach ($value in $values) {
        foreach ($variant in @($value, [Uri]::EscapeDataString($value))) {
            $result = $result.Replace($variant, '***')
        }
    }
    if ($result.Length -gt $BylLogLineMax) { $result = $result.Substring(0, $BylLogLineMax - 3) + '...' }
    return $result
}

function Get-DetachedRestartArgumentString {
    # Arguments of Windows PowerShell for the detached restart (restart -Detach, ADR-0043): the
    # control script $ScriptPath with restart, without browser, only errors and the result, and
    # only after process $WaitForProcess (the caller) ended. The path is quoted (spaces, #); Windows
    # paths cannot contain double quotes.
    param([Parameter(Mandatory = $true)][string]$ScriptPath, [Parameter(Mandatory = $true)][int]$WaitForProcess)

    return ('-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "{0}" restart -NoBrowser -Quiet -WaitForProcess {1}' -f
        $ScriptPath, $WaitForProcess)
}

# --- Server start --------------------------------------------------------------------------------

function Get-ServerLogPath {
    # Output of the server process (*.log is gitignored). Standard output and error need separate
    # files (Start-Process cannot redirect both into one); each start begins them anew and keeps
    # the previous run as *.1.log (Invoke-LogRotation).
    param([Parameter(Mandatory = $true)][string]$AppDir)

    $logDir = [System.IO.Path]::Combine($AppDir, 'logs')
    return [pscustomobject]@{
        Directory = $logDir
        Output    = [System.IO.Path]::Combine($logDir, 'pocketbase.out.log')
        Error     = [System.IO.Path]::Combine($logDir, 'pocketbase.err.log')
    }
}

function Get-ServerArgumentString {
    # Arguments for pocketbase.exe (CLAUDE.md sections 3 and 9): only 127.0.0.1:<Port>, data,
    # hooks, migrations and web build from the app folder, --automigrate=false, never --dev. Paths
    # are quoted (spaces, #); Windows paths cannot contain double quotes.
    param([Parameter(Mandatory = $true)][string]$AppDir, [int]$Port = $BylPort)

    $folder = { param([string]$Name) [System.IO.Path]::Combine($AppDir, $Name) }
    return ('serve --http=127.0.0.1:{0} --dir="{1}" --hooksDir="{2}" --migrationsDir="{3}" --publicDir="{4}" --automigrate=false --indexFallback=true' -f
        $Port, (& $folder 'pb_data'), (& $folder 'pb_hooks'), (& $folder 'pb_migrations'), (& $folder 'pb_public'))
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
    # $Progress param($Seconds) is called about once a second while waiting.
    param(
        [Parameter(Mandatory = $true)][object]$Process,
        [string]$Url = $BylHealthUrl,
        [int]$TimeoutSeconds = 30,
        [int]$RequestTimeoutMilliseconds = 2000,
        [scriptblock]$Progress = { param($Seconds) $null = $Seconds }
    )

    $started = [DateTime]::UtcNow
    $deadline = $started.AddSeconds($TimeoutSeconds)
    $reported = 0
    while ($true) {
        if ($Process.HasExited) { return 'Exited' }
        if (Test-Health -Url $Url -TimeoutMilliseconds $RequestTimeoutMilliseconds) {
            if ($Process.HasExited) { return 'Exited' }
            return 'Ready'
        }
        if ([DateTime]::UtcNow -ge $deadline) { return 'Timeout' }
        $elapsed = [int][Math]::Floor(([DateTime]::UtcNow - $started).TotalSeconds)
        if ($elapsed -gt $reported) {
            $reported = $elapsed
            & $Progress $elapsed
        }
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
    # All processes with the fields Select-AppProcess, Resolve-PortState and Resolve-StateMatch need
    # (CIM instead of the deprecated WMI command-line tool).
    return @(Get-CimInstance -ClassName Win32_Process -Property ProcessId, Name, ExecutablePath, CommandLine, CreationDate)
}

function Get-ListenerSnapshot {
    # LISTEN sockets on $Port (empty if there are none).
    param([int]$Port = $BylPort)

    return @(Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue)
}

# --- Orderly stop (ADR-0039 section 4) -----------------------------------------------------------

# Console control in a child process: it leaves its own (hidden) console, attaches to the console
# of the target and sends CTRL_BREAK_EVENT there. PocketBase (Go) turns it into os.Interrupt and
# shuts down in order (OnTerminate, database closed, WAL checkpointed); byl-mail.exe ends its loop
# on SIGBREAK. CTRL_C_EVENT is not used: a process can inherit the flag that ignores it. The child
# sends nothing if other processes share the console (a server started by hand in a terminal), so
# no other program ever gets the signal.
# Exit codes: 0 sent, 2 no console to attach, 3 console shared, 4 sending failed.
$BylConsoleBreakSource = @'
using System;
using System.Runtime.InteropServices;
public static class BylConsoleBreak {
    public delegate bool Handler(uint controlType);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool AttachConsole(uint processId);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool FreeConsole();
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool SetConsoleCtrlHandler(Handler handler, bool add);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool GenerateConsoleCtrlEvent(uint controlEvent, uint processGroupId);
    [DllImport("kernel32.dll", SetLastError = true)] static extern uint GetConsoleProcessList(uint[] processIds, uint count);
    static readonly Handler Ignore = delegate (uint controlType) { return true; };
    public static int Send(uint processId) {
        FreeConsole();
        if (!AttachConsole(processId)) return 2;
        // Registered after attaching (a new console resets the handling of this process): the
        // break goes to every process of the console, this one included, and must not end it.
        SetConsoleCtrlHandler(null, true);
        SetConsoleCtrlHandler(Ignore, true);
        try {
            uint self = (uint)System.Diagnostics.Process.GetCurrentProcess().Id;
            uint[] ids = new uint[16];
            uint count = GetConsoleProcessList(ids, (uint)ids.Length);
            if (count == 0 || count > ids.Length) return 3;
            for (int i = 0; i < count; i++) {
                if (ids[i] != processId && ids[i] != self) return 3;
            }
            if (!GenerateConsoleCtrlEvent(1, 0)) return 4;
            System.Threading.Thread.Sleep(200);
            return 0;
        }
        finally {
            FreeConsole();
        }
    }
}
'@

function Get-ConsoleBreakCommand {
    # -EncodedCommand for powershell.exe that sends the console break to $ProcessId.
    param([Parameter(Mandatory = $true)][ValidateRange(1, [int]::MaxValue)][int]$ProcessId)

    $script = "Add-Type -TypeDefinition @'`r`n$BylConsoleBreakSource`r`n'@`r`nexit ([BylConsoleBreak]::Send([uint32]$ProcessId))"
    return [Convert]::ToBase64String([System.Text.Encoding]::Unicode.GetBytes($script))
}

# Exit code of a sender that the break ended itself (STATUS_CONTROL_C_EXIT, 0xC000013A as Int32):
# the break reached its console, so it reached the target as well.
$BylBreakEndedSender = -1073741510

function Resolve-BreakCode {
    # What the exit code of the sending child says about the console break (plan test-haertung,
    # T-3): 'Sent' (0, or the sender ended by the break itself), 'Refused' (3: the console is
    # shared, no other program may get the signal), 'NotSent' (2 no console to attach, 4 sending
    # failed, 1 the child failed before sending, e.g. compiling its code under load, -2 the child
    # did not start) or 'Unknown' (-1 the child hung and was ended, anything else).
    param([Parameter(Mandatory = $true)][int]$Code)

    if ($Code -eq 0 -or $Code -eq $BylBreakEndedSender) { return 'Sent' }
    if ($Code -eq 3) { return 'Refused' }
    if ($Code -in -2, 1, 2, 4) { return 'NotSent' }
    return 'Unknown'
}

function Stop-Gracefully {
    # Ends one process in order: the console break ($SendBreak param($ProcessId) -> exit code of the
    # sending child, see Resolve-BreakCode), then up to $GraceMilliseconds for the process to end
    # ($WaitExit param($ProcessId, $Milliseconds) -> $true once it ended; it asks the process and
    # returns as soon as it is gone), and only then hard ($Kill param($ProcessId), may throw),
    # followed by up to 10 s of waiting. Whether the stop was in order is decided by the process,
    # not by the sender: after a break that went out or may have gone out the process gets its
    # grace time. A break that did not go out, or of unknown fate while the process runs on, is sent
    # again, up to $Attempts in all; after one that did not go out the process gets up to
    # $RetryMilliseconds first (it may end meanwhile, and a passing failure does not come right
    # back). A refused break (shared console) is never repeated. The codes of the attempts go to
    # $Codes (for the log). Returns 'Graceful', 'Forced' or 'Running' (still there).
    param(
        [Parameter(Mandatory = $true)][int]$ProcessId,
        [Parameter(Mandatory = $true)][scriptblock]$SendBreak,
        [Parameter(Mandatory = $true)][scriptblock]$WaitExit,
        [Parameter(Mandatory = $true)][scriptblock]$Kill,
        [int]$GraceMilliseconds = 15000,
        [ValidateRange(1, 10)][int]$Attempts = 2,
        [int]$RetryMilliseconds = 1000,
        [AllowEmptyCollection()][System.Collections.Generic.List[int]]$Codes
    )

    for ($attempt = 1; $attempt -le $Attempts; $attempt++) {
        try {
            $code = [int](& $SendBreak $ProcessId)
        }
        catch {
            $code = -2
        }
        if ($null -ne $Codes) { $Codes.Add($code) }
        $kind = Resolve-BreakCode -Code $code
        if ($kind -eq 'Refused') { break }
        $wait = if ($kind -eq 'NotSent') { $RetryMilliseconds } else { $GraceMilliseconds }
        if (& $WaitExit $ProcessId $wait) { return 'Graceful' }
        if ($kind -eq 'Sent') { break }
    }
    try {
        & $Kill $ProcessId
    }
    catch {
        $null = $_
    }
    if (& $WaitExit $ProcessId 10000) { return 'Forced' }
    return 'Running'
}

function Stop-SelectedProcess {
    # Stops the processes of $Candidates by process id (stop), each only if $Select still chooses
    # the process right before (the PID could have been reused since the snapshot).
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
    # the log (pattern /_/#/pbinstall/<jwt>); the URL is rebuilt on the app's own address, so
    # nothing but the local admin UI is ever opened. Returns Url, Token and ExpiresUtc of the LAST
    # link, or $null if there is none, if it was issued before $ProcessStartUtc (a log of an older
    # run) or if it has expired at $NowUtc. The token is a JWT without "iat"; issue time = exp - 30 min.
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
    # Which BYL_* variables the start hands to PocketBase (ADR-0018 section 6): every valid name of
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

function Get-MailHelperArgumentString {
    # Arguments for byl-mail.exe: fetch the mailboxes of the app's own PocketBase.
    return "run --url=$BylMailHelperUrl"
}

function Get-MailHelperLogPath {
    # Output of the helper (begun anew at every start, the previous run stays as *.1.log, like the
    # server log). It logs counts and cleaned errors only, never access data or contents of mails.
    param([Parameter(Mandatory = $true)][string]$AppDir)

    $logDir = [System.IO.Path]::Combine($AppDir, 'logs')
    return [pscustomobject]@{
        Directory = $logDir
        Output    = [System.IO.Path]::Combine($logDir, 'byl-mail.log')
        Error     = [System.IO.Path]::Combine($logDir, 'byl-mail.err.log')
    }
}

function Select-MailHelperProcess {
    # Returns the app's own mail helper(s) from process objects shaped like Win32_Process, by the
    # same safety rule as Select-AppProcess: the program is byl-mail.exe directly in the app folder,
    # the first argument is "run" and --url is one of $Url (the addresses of the own instance). A
    # helper that scripts\build-mail-helper.ps1 renamed to byl-mail.exe.old-<time> while it ran
    # still qualifies: Windows keeps reporting the path it was started from. Helpers of the tests
    # (other folder or port), one-shot calls (--version, --self-test) and processes with an
    # unreadable command line never qualify.
    param(
        [AllowNull()][object[]]$Process,
        [Parameter(Mandatory = $true)][string]$AppDir,
        [string[]]$Url = @($BylMailHelperUrl)
    )

    foreach ($candidate in @($Process)) {
        if ($null -eq $candidate) { continue }
        if (-not (Test-SamePath -Path $candidate.ExecutablePath -Expected ([System.IO.Path]::Combine($AppDir, $BylMailHelperName)))) { continue }
        $arguments = Get-ProcessArgument -Process $candidate
        if ($arguments.Count -eq 0 -or $arguments[0] -cne 'run') { continue }
        if ($Url -cnotcontains (Get-FlagValue -Arguments $arguments -Name 'url')) { continue }
        $candidate
    }
}

function Get-MailHelperDecision {
    # Whether the start runs byl-mail.exe (E4 plan package 11): only if the file is in the app
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

$BylAttentionReasons = @('start', 'datei', 'stop')
# A landing page (file://) that reported within this window opens the app itself.
$BylLandingWindowMs = 10000
# After a restart the open tabs reconnect on their own (SDK steps of 0.2 to 2 s), so a cold start
# waits this long for them before it opens a tab.
$BylColdStartWaitMs = 3000
# How long the start waits for a tab to confirm the message, and the step of all waits.
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
    # What the start does next with an answer of the presence route:
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
    # a-p>; an --app-url, if present, must be the app on its current address (port $Port). Returns
    # the Path of the first match (sorted by path) or $null.
    param([AllowNull()][AllowEmptyCollection()][object[]]$Shortcuts, [int]$Port = $BylPort)

    $appUrl = '(^|\s)"?--app-url=http://127\.0\.0\.1:' + $Port + '/?(\s|"|$)'
    $matching = @(@($Shortcuts) | Where-Object {
            $null -ne $_ -and
            [string]::Equals([string]$_.Name, 'becauseyoulovejira', [System.StringComparison]::OrdinalIgnoreCase) -and
            @('chrome_proxy.exe', 'msedge_proxy.exe') -contains ([System.IO.Path]::GetFileName([string]$_.TargetPath)).ToLowerInvariant() -and
            [string]$_.Arguments -cmatch '(^|\s)--app-id=[a-p]{32}(\s|$)' -and
            ([string]$_.Arguments -notmatch '--app-url=' -or [string]$_.Arguments -match $appUrl)
        } | Sort-Object -Property Path)
    if ($matching.Count -eq 0) { return $null }
    return [string]$matching[0].Path
}

function Resolve-BrowserAction {
    # Whether the start opens a browser tab ('Open') or leaves it to an open tab or the landing
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
