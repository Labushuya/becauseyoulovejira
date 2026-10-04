# Functions for byl-control.ps1: start, stop, restart, status and autostart of becauseyoulovejira
# (E1 plan package 8, ADR-0039).
#
# Dot-sourced by byl-control.ps1 and by the tests; loading the file has no side effects. The
# selection and decision logic is pure (every input is a parameter), so the tests check it with
# fake processes, sockets, files and log texts. The file stays ASCII: German texts for the user
# live in byl-control.ps1 (UTF-8 with BOM).

# --- Address and port (ADR-0039 section 2) ----------------------------------------------------

# Standard port of the app. The only place to change it is byl-config.json in the app folder
# ({"port": <number>}, written by "byl-control.ps1 port <number>"); the app binds to the loopback
# address 127.0.0.1 (CLAUDE.md section 3), with the access in the home network switched on to all
# addresses of the computer (0.0.0.0, plan heimnetz); every address of the scripts stays 127.0.0.1.
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

# --- Further hosts and CORS origins (ADR-0055 section 3) ----------------------------------------

# Hosts besides this machine under which the app may be reached later, only over HTTPS through a
# proxy such as Tailscale (ADR-0001 section 3): byl-config.json {"security": {"hosts": [...]}},
# empty by default. A host is a DNS name with at least one dot and an optional port; IP addresses,
# single names (localhost) and anything else are left out. Same rule as normalizeExtraHost in
# pb_hooks/lib/security-rules.js (parity test).
$BylExtraHostsMax = 10
$BylExtraHostPattern = '^(?=.{1,253}(?::[0-9]{1,5})?$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?(?::([0-9]{1,5}))?$'

function ConvertTo-BylExtraHost {
    # $Text trimmed and in lower case if it is a valid further host, otherwise $null.
    param([AllowNull()][AllowEmptyString()][string]$Text)

    if ($null -eq $Text) { return $null }
    $value = $Text.Trim().ToLowerInvariant()
    $match = [regex]::Match($value, $BylExtraHostPattern)
    if (-not $match.Success) { return $null }
    if ($match.Groups[1].Success) {
        $port = [int]$match.Groups[1].Value
        if ($port -lt 1 -or $port -gt 65535) { return $null }
    }
    return $value
}

function ConvertFrom-BylSecurityConfig {
    # Further hosts from the text of byl-config.json: Present (the file has a section "security")
    # and Hosts (the valid entries of security.hosts in lower case, without duplicates, at most
    # $BylExtraHostsMax). Never throws: invalid entries are left out, so a typing error can only
    # allow less, never more; a broken file is the business of the port check.
    param([AllowNull()][AllowEmptyString()][string]$Text)

    $result = [pscustomobject]@{ Present = $false; Hosts = [string[]]@() }
    try {
        $value = if ([string]::IsNullOrWhiteSpace($Text)) { $null } else { $Text | ConvertFrom-Json }
    }
    catch {
        return $result
    }
    if ($null -eq $value -or $value -isnot [System.Management.Automation.PSCustomObject] -or $null -eq $value.PSObject.Properties['security']) {
        return $result
    }
    $security = $value.security
    if ($null -eq $security -or $security -isnot [System.Management.Automation.PSCustomObject]) { return $result }
    $result.Present = $true
    $property = $security.PSObject.Properties['hosts']
    if ($null -eq $property -or $null -eq $property.Value) { return $result }
    $names = New-Object System.Collections.Generic.List[string]
    foreach ($entry in @($property.Value)) {
        if ($entry -isnot [string]) { continue }
        $name = ConvertTo-BylExtraHost -Text $entry
        if ($null -ne $name -and -not $names.Contains($name) -and $names.Count -lt $BylExtraHostsMax) { $names.Add($name) }
    }
    $result.Hosts = [string[]]$names.ToArray()
    return $result
}

function Get-BylOrigins {
    # CORS origins of the server (--origins, ADR-0055 section 3): the app on this machine under
    # 127.0.0.1 and localhost with $Port, then the addresses $Lan of the home network over plain
    # HTTP with the same port (plan heimnetz), then every further host over HTTPS. PocketBase allows
    # "*" without the flag. The browser extension needs no origin (host_permissions), the landing
    # page per file:// gets its answers from the guard of pb_hooks (security.pb.js), which also
    # takes the hosts of these origins as the only names besides this machine.
    param(
        [Parameter(Mandatory = $true)][int]$Port,
        [AllowNull()][AllowEmptyCollection()][string[]]$Hosts = @(),
        [AllowNull()][AllowEmptyCollection()][string[]]$Lan = @()
    )

    $origins = New-Object System.Collections.Generic.List[string]
    $origins.Add("http://127.0.0.1:$Port")
    $origins.Add("http://localhost:$Port")
    foreach ($address in @($Lan)) {
        if (-not [string]::IsNullOrEmpty($address)) { $origins.Add("http://$($address):$Port") }
    }
    foreach ($name in @($Hosts)) {
        if (-not [string]::IsNullOrEmpty($name)) { $origins.Add("https://$name") }
    }
    return ($origins -join ',')
}

# --- Access in the home network (plan docs/plan/heimnetz.md, ADR-0055 addendum) ------------------

# Other devices of the home network reach the app over plain HTTP under an address of this
# computer: byl-config.json {"network": {"lan": {"enabled": true, "addresses": [...]}}}, off by
# default. An address is a private IPv4 address (10/8, 172.16/12, 192.168/16, written without
# leading zeros as a browser sends it in the Host header) or a name of the computer in the local
# network with one of the local endings below (a FRITZ!Box names its devices <name>.fritz.box),
# without a port: the port stays the one of the app. At most $BylLanMax. The same rule as
# normalizeLanAddress in pb_hooks/lib/lan-rules.js and web/src/lib/domain/lan.ts (parity tests).
$BylLanMax = 5
$BylLanOctet = '(25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])'
$BylLanIPv4Pattern = "^$BylLanOctet\.$BylLanOctet\.$BylLanOctet\.$BylLanOctet$"
$BylLanNamePattern = '^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:fritz\.box|local|lan|home\.arpa|internal)$'
$BylLanNameSuffixes = @('fritz.box', 'local', 'lan', 'home.arpa', 'internal')
# Display name of the inbound rule of the Windows firewall for pocketbase.exe of a folder; one rule
# per folder (the program path tells them apart), only private networks, only TCP on the port.
$BylLanRuleName = 'becauseyoulovejira (Heimnetz)'
$BylLanRuleDescription = 'Access of devices in the home network to becauseyoulovejira (private networks only), created by byl-control.ps1'

function Test-BylPrivateIPv4 {
    # True for an IPv4 address in 10.0.0.0/8, 172.16.0.0/12 or 192.168.0.0/16, written in the form a
    # browser sends (four decimal numbers without leading zeros).
    param([AllowNull()][AllowEmptyString()][string]$Text)

    if ($null -eq $Text -or $Text -cnotmatch $BylLanIPv4Pattern) { return $false }
    $first = [int]$Matches[1]
    $second = [int]$Matches[2]
    return $first -eq 10 -or ($first -eq 172 -and $second -ge 16 -and $second -le 31) -or ($first -eq 192 -and $second -eq 168)
}

function ConvertTo-BylLanAddress {
    # $Text trimmed and in lower case if it is an address of the home network (a private IPv4
    # address or a local name, see above), otherwise $null.
    param([AllowNull()][AllowEmptyString()][string]$Text)

    if ($null -eq $Text) { return $null }
    $value = $Text.Trim().ToLowerInvariant()
    if (Test-BylPrivateIPv4 -Text $value) { return $value }
    if ($value -cmatch $BylLanNamePattern) { return $value }
    return $null
}

function ConvertFrom-BylLanConfig {
    # The access in the home network from the text of byl-config.json: Present (the file has the
    # section network.lan), Enabled (only a real true switches it on) and Addresses (the valid
    # entries in lower case, without duplicates, at most $BylLanMax). Never throws: invalid entries
    # are left out, so a typing error can only allow less; a broken file is the business of the
    # port check.
    param([AllowNull()][AllowEmptyString()][string]$Text)

    $result = [pscustomobject]@{ Present = $false; Enabled = $false; Addresses = [string[]]@() }
    try {
        $value = if ([string]::IsNullOrWhiteSpace($Text)) { $null } else { $Text | ConvertFrom-Json }
    }
    catch {
        return $result
    }
    if ($null -eq $value -or $value -isnot [System.Management.Automation.PSCustomObject] -or $null -eq $value.PSObject.Properties['network']) {
        return $result
    }
    $network = $value.network
    if ($null -eq $network -or $network -isnot [System.Management.Automation.PSCustomObject] -or $null -eq $network.PSObject.Properties['lan']) {
        return $result
    }
    $lan = $network.lan
    if ($null -eq $lan -or $lan -isnot [System.Management.Automation.PSCustomObject]) { return $result }
    $result.Present = $true
    $enabled = $lan.PSObject.Properties['enabled']
    $result.Enabled = $null -ne $enabled -and $enabled.Value -is [bool] -and $enabled.Value
    $property = $lan.PSObject.Properties['addresses']
    if ($null -eq $property -or $null -eq $property.Value) { return $result }
    $addresses = New-Object System.Collections.Generic.List[string]
    foreach ($entry in @($property.Value)) {
        if ($entry -isnot [string]) { continue }
        $address = ConvertTo-BylLanAddress -Text $entry
        if ($null -ne $address -and -not $addresses.Contains($address) -and $addresses.Count -lt $BylLanMax) { $addresses.Add($address) }
    }
    $result.Addresses = [string[]]$addresses.ToArray()
    return $result
}

function Get-BylLanAddress {
    # The addresses of the home network a start uses ($Lan in the shape of ConvertFrom-BylLanConfig):
    # its addresses while it is switched on, none otherwise (then the app binds to 127.0.0.1 only).
    # Assign first: the list comes as one pipeline object.
    param([AllowNull()][object]$Lan)

    if ($null -eq $Lan -or -not $Lan.Enabled) { return , [string[]]@() }
    return , [string[]]@($Lan.Addresses | Where-Object { -not [string]::IsNullOrEmpty($_) })
}

function Get-BylActiveLan {
    # What the running server allows in the home network, read from its arguments: Bound (it listens
    # on every address, --http=0.0.0.0:<port>) and Hosts (the hosts of its http origins besides this
    # machine, e.g. 192.168.178.20:8090, as the guard of pb_hooks allows them).
    param([AllowNull()][AllowEmptyCollection()][string[]]$Arguments)

    $http = Get-FlagValue -Arguments $Arguments -Name 'http'
    $bound = $null -ne $http -and $http -cmatch '^0\.0\.0\.0:\d{1,5}$'
    $hosts = New-Object System.Collections.Generic.List[string]
    $origins = Get-FlagValue -Arguments $Arguments -Name 'origins'
    foreach ($origin in @(([string]$origins) -split ',')) {
        if ($origin.Trim() -notmatch '^http://([^/?#*\s]+)$') { continue }
        $name = $Matches[1].ToLowerInvariant()
        if ($name -match '^(?:127\.0\.0\.1|localhost|\[::1\])(?::\d+)?$' -or $hosts.Contains($name)) { continue }
        $hosts.Add($name)
    }
    return [pscustomobject]@{ Bound = $bound; Hosts = [string[]]$hosts.ToArray() }
}

function ConvertTo-BylNetworkCategory {
    # The network category of a connection profile of Windows (NetworkCategory of
    # Get-NetConnectionProfile: Private, Public, DomainAuthenticated) as 'private', 'public',
    # 'domain' or 'unknown'.
    param([AllowNull()][object]$Value)

    switch ([string]$Value) {
        'Private' { return 'private' }
        'Public' { return 'public' }
        'DomainAuthenticated' { return 'domain' }
        default { return 'unknown' }
    }
}

function Select-BylLanCandidate {
    # The addresses of this computer that devices of the home network can use: every private IPv4
    # address in use (AddressState Preferred) with the adapter and the network category of its
    # connection profile, then the name of the computer with the DNS suffix of such an adapter when
    # the suffix is a local one (a FRITZ!Box hands out fritz.box). Inputs shaped like
    # Get-NetIPAddress (IPAddress, InterfaceIndex, InterfaceAlias, AddressState),
    # Get-NetConnectionProfile (InterfaceIndex, NetworkCategory) and Get-DnsClient (InterfaceIndex,
    # ConnectionSpecificSuffix); $HostName is the DNS name of the computer. Returns Address, Kind
    # ('ip' or 'name'), Adapter, Index and Category, private networks first; assign first (one
    # pipeline object).
    param(
        [AllowNull()][AllowEmptyCollection()][object[]]$Addresses = @(),
        [AllowNull()][AllowEmptyCollection()][object[]]$Profiles = @(),
        [AllowNull()][AllowEmptyCollection()][object[]]$Suffixes = @(),
        [AllowNull()][AllowEmptyString()][string]$HostName = ''
    )

    $categoryOf = @{}
    foreach ($profile in @($Profiles)) {
        if ($null -ne $profile) { $categoryOf[[int]$profile.InterfaceIndex] = ConvertTo-BylNetworkCategory -Value $profile.NetworkCategory }
    }
    $suffixOf = @{}
    foreach ($entry in @($Suffixes)) {
        if ($null -ne $entry -and -not [string]::IsNullOrWhiteSpace([string]$entry.ConnectionSpecificSuffix)) {
            $suffixOf[[int]$entry.InterfaceIndex] = ([string]$entry.ConnectionSpecificSuffix).Trim().TrimEnd('.').ToLowerInvariant()
        }
    }
    $found = New-Object System.Collections.Generic.List[object]
    $seen = New-Object System.Collections.Generic.List[string]
    $add = {
        param([string]$Address, [string]$Kind, [object]$Source)
        if ([string]::IsNullOrEmpty($Address) -or $seen.Contains($Address)) { return }
        $seen.Add($Address)
        $index = [int]$Source.InterfaceIndex
        $category = if ($categoryOf.ContainsKey($index)) { $categoryOf[$index] } else { 'unknown' }
        $found.Add([pscustomobject]@{ Address = $Address; Kind = $Kind; Adapter = [string]$Source.InterfaceAlias; Index = $index; Category = $category })
    }
    $used = @(@($Addresses) | Where-Object {
            $null -ne $_ -and (Test-BylPrivateIPv4 -Text ([string]$_.IPAddress)) -and ([string]::IsNullOrEmpty([string]$_.AddressState) -or [string]$_.AddressState -eq 'Preferred')
        })
    foreach ($address in $used) { & $add ([string]$address.IPAddress) 'ip' $address }
    $name = ([string]$HostName).Trim().ToLowerInvariant()
    foreach ($address in $used) {
        $index = [int]$address.InterfaceIndex
        if ($name -eq '' -or -not $suffixOf.ContainsKey($index) -or $BylLanNameSuffixes -notcontains $suffixOf[$index]) { continue }
        & $add (ConvertTo-BylLanAddress -Text "$name.$($suffixOf[$index])") 'name' $address
    }
    # Private networks first, then the others in the order found (Sort-Object of Windows PowerShell
    # 5.1 is not stable, hence the passes).
    $sorted = New-Object System.Collections.Generic.List[object]
    foreach ($category in @('private', 'domain', 'unknown', 'public')) {
        foreach ($candidate in $found) {
            if ($candidate.Category -eq $category) { $sorted.Add($candidate) }
        }
    }
    return , @($sorted.ToArray())
}

function Resolve-BylLanAddressState {
    # For every address of the home network in $Lan: whether it belongs to an adapter of this
    # computer now (Present; $null for a name, which only the router resolves) with Adapter, Index
    # and Category of its connection profile. Inputs as for Select-BylLanCandidate; assign first
    # (one pipeline object).
    param(
        [AllowNull()][AllowEmptyCollection()][string[]]$Lan = @(),
        [AllowNull()][AllowEmptyCollection()][object[]]$Addresses = @(),
        [AllowNull()][AllowEmptyCollection()][object[]]$Profiles = @()
    )

    $categoryOf = @{}
    foreach ($profile in @($Profiles)) {
        if ($null -ne $profile) { $categoryOf[[int]$profile.InterfaceIndex] = ConvertTo-BylNetworkCategory -Value $profile.NetworkCategory }
    }
    $result = foreach ($address in @($Lan | Where-Object { -not [string]::IsNullOrEmpty($_) })) {
        if (-not (Test-BylPrivateIPv4 -Text $address)) {
            [pscustomobject]@{ Address = $address; Present = $null; Adapter = ''; Index = $null; Category = 'unknown' }
            continue
        }
        $match = @(@($Addresses) | Where-Object { $null -ne $_ -and [string]$_.IPAddress -eq $address } | Select-Object -First 1)
        if ($match.Count -eq 0) {
            [pscustomobject]@{ Address = $address; Present = $false; Adapter = ''; Index = $null; Category = 'unknown' }
            continue
        }
        $index = [int]$match[0].InterfaceIndex
        [pscustomobject]@{
            Address  = $address
            Present  = $true
            Adapter  = [string]$match[0].InterfaceAlias
            Index    = $index
            Category = if ($categoryOf.ContainsKey($index)) { $categoryOf[$index] } else { 'unknown' }
        }
    }
    return , @($result)
}

function Resolve-BylFirewallState {
    # State of the inbound rule of the home network for $Program (pocketbase.exe of this folder) on
    # TCP $Port. $Rules: the rules with the display name $BylLanRuleName, each with Enabled,
    # Direction, Action, Profile (as Get-NetFirewallRule writes them), Program, Protocol and
    # LocalPort (of their filters); $Blocks: switched-on inbound block rules for the program (they
    # win over every allow rule, e.g. after "Abbrechen" in the alert of Windows). Returns State:
    #   present  - a switched-on inbound allow rule for the program, TCP (or any) on the port (or
    #              any), for private networks,
    #   mismatch - a rule for the program exists, but for another port, profile or switched off,
    #   missing  - none for this program,
    # and Blocked.
    param(
        [AllowNull()][AllowEmptyCollection()][object[]]$Rules = @(),
        [AllowNull()][AllowEmptyCollection()][object[]]$Blocks = @(),
        [Parameter(Mandatory = $true)][string]$Program,
        [Parameter(Mandatory = $true)][int]$Port
    )

    $own = @(@($Rules) | Where-Object {
            $null -ne $_ -and (Test-SamePath -Path ([Environment]::ExpandEnvironmentVariables([string]$_.Program)) -Expected $Program)
        })
    $fits = @($own | Where-Object {
            $ports = @(@($_.LocalPort) | ForEach-Object { [string]$_ })
            $profiles = @(([string]$_.Profile) -split ',\s*')
            [string]$_.Enabled -eq 'True' -and [string]$_.Direction -eq 'Inbound' -and [string]$_.Action -eq 'Allow' -and
            @('TCP', 'Any') -contains [string]$_.Protocol -and
            ($ports -contains [string]$Port -or $ports -contains 'Any') -and
            ($profiles -contains 'Private' -or $profiles -contains 'Any')
        })
    $state = if ($fits.Count -gt 0) { 'present' } elseif ($own.Count -gt 0) { 'mismatch' } else { 'missing' }
    return [pscustomobject]@{ State = $state; Blocked = @(@($Blocks) | Where-Object { $null -ne $_ }).Count -gt 0 }
}

function ConvertTo-BylQuotedText {
    # $Text as a single-quoted PowerShell string (a quote doubled), for the elevated script.
    param([AllowEmptyString()][string]$Text)

    return "'" + $Text.Replace("'", "''") + "'"
}

function Get-BylFirewallScript {
    # The script the elevated Windows PowerShell runs for lan-firewall: it removes every rule named
    # $BylLanRuleName for $Program (also one of an earlier port) and, for 'add', creates the one
    # inbound rule: only $Program, only TCP on $Port, only private networks. Exit code 0 when done,
    # 1 after an error. Fixed text and the quoted path only; nothing of a request reaches it.
    param(
        [Parameter(Mandatory = $true)][ValidateSet('add', 'remove')][string]$Action,
        [Parameter(Mandatory = $true)][string]$Program,
        [Parameter(Mandatory = $true)][ValidateRange(1, 65535)][int]$Port
    )

    $lines = New-Object System.Collections.Generic.List[string]
    $lines.Add('$ErrorActionPreference = ''Stop''')
    $lines.Add('$name = ' + (ConvertTo-BylQuotedText -Text $BylLanRuleName))
    $lines.Add('$program = ' + (ConvertTo-BylQuotedText -Text $Program))
    $lines.Add('try {')
    $lines.Add('    foreach ($rule in @(Get-NetFirewallRule -DisplayName $name -ErrorAction SilentlyContinue)) {')
    $lines.Add('        $filter = $rule | Get-NetFirewallApplicationFilter')
    $lines.Add('        if ([string]::Equals([string]$filter.Program, $program, [System.StringComparison]::OrdinalIgnoreCase)) { $rule | Remove-NetFirewallRule }')
    $lines.Add('    }')
    if ($Action -eq 'add') {
        $lines.Add('    New-NetFirewallRule -DisplayName $name -Description ' + (ConvertTo-BylQuotedText -Text $BylLanRuleDescription) +
            " -Direction Inbound -Action Allow -Protocol TCP -LocalPort $Port -Program `$program -Profile Private -Enabled True | Out-Null")
    }
    $lines.Add('    exit 0')
    $lines.Add('}')
    $lines.Add('catch {')
    $lines.Add('    exit 1')
    $lines.Add('}')
    return ($lines -join "`r`n")
}

function Get-BylElevatedArgumentString {
    # Arguments of the elevated Windows PowerShell: the script $Script as -EncodedCommand (UTF-16LE,
    # Base64), so no quote of a path can break the command line.
    param([Parameter(Mandatory = $true)][string]$Script)

    $encoded = [Convert]::ToBase64String([System.Text.Encoding]::Unicode.GetBytes($Script))
    return "-NoProfile -NonInteractive -ExecutionPolicy Bypass -EncodedCommand $encoded"
}

function Get-BylFirewallCommand {
    # The same change as one command to copy into a prompt started "as administrator" (netsh works in
    # the command prompt and in PowerShell): the way by hand next to the offer, also in the entries
    # lan-firewall-* of the catalog.
    param(
        [Parameter(Mandatory = $true)][ValidateSet('add', 'remove')][string]$Action,
        [Parameter(Mandatory = $true)][string]$Program,
        [Parameter(Mandatory = $true)][ValidateRange(1, 65535)][int]$Port
    )

    if ($Action -eq 'add') {
        return ('netsh advfirewall firewall add rule name="{0}" dir=in action=allow protocol=TCP localport={1} program="{2}" profile=private' -f
            $BylLanRuleName, $Port, $Program)
    }
    return ('netsh advfirewall firewall delete rule name="{0}" program="{1}"' -f $BylLanRuleName, $Program)
}

function Merge-BylConfigText {
    # Text of byl-config.json from the current text $Text with a new $Port, new backup settings
    # $Backup (ConvertFrom-BylBackupConfig shape), new further hosts $Hosts (an empty list removes
    # them) and/or a new access in the home network $Lan (ConvertFrom-BylLanConfig shape; switched
    # off without addresses removes it); what is not given stays as it was. The file holds only
    # these settings: the port (ADR-0039 section 2), the backup (ADR-0046), the further hosts
    # (ADR-0055) and the home network (plan heimnetz).
    param(
        [AllowNull()][AllowEmptyString()][string]$Text,
        [AllowNull()][object]$Port,
        [AllowNull()][object]$Backup,
        [AllowNull()][AllowEmptyCollection()][string[]]$Hosts,
        [AllowNull()][object]$Lan
    )

    $current = $null
    try {
        if (-not [string]::IsNullOrWhiteSpace($Text)) { $current = $Text | ConvertFrom-Json }
    }
    catch {
        $current = $null
    }
    if ($null -ne $current -and $current -isnot [System.Management.Automation.PSCustomObject]) { $current = $null }
    if ($null -eq $Port -and $null -ne $current -and $null -ne $current.PSObject.Properties['port'] -and (Test-PortNumber $current.port)) {
        $Port = [int]$current.port
    }
    if ($null -eq $Backup) {
        $parsed = ConvertFrom-BylBackupConfig -Text $Text
        if ($parsed.Present) { $Backup = $parsed }
    }
    $parts = New-Object System.Collections.Generic.List[string]
    if ($null -ne $Port) { $parts.Add("  `"port`": $([int]$Port)") }
    if ($null -ne $Backup) {
        $target = if ([string]::IsNullOrEmpty($Backup.Target)) { 'null' } else { ConvertTo-Json -InputObject ([string]$Backup.Target) -Compress }
        $credentials = if ($Backup.Credentials) { 'true' } else { 'false' }
        $parts.Add(("  `"backup`": {{`r`n    `"target`": {0},`r`n    `"daily`": {1},`r`n    `"weekly`": {2},`r`n    `"monthly`": {3},`r`n    `"credentials`": {4}`r`n  }}" -f
                $target, [int]$Backup.Daily, [int]$Backup.Weekly, [int]$Backup.Monthly, $credentials))
    }
    if (-not $PSBoundParameters.ContainsKey('Hosts')) {
        $Hosts = (ConvertFrom-BylSecurityConfig -Text $Text).Hosts
    }
    $kept = New-Object System.Collections.Generic.List[string]
    foreach ($entry in @($Hosts)) {
        $name = ConvertTo-BylExtraHost -Text $entry
        if ($null -ne $name -and -not $kept.Contains($name) -and $kept.Count -lt $BylExtraHostsMax) { $kept.Add($name) }
    }
    if ($kept.Count -gt 0) {
        $list = ($kept | ForEach-Object { ConvertTo-Json -InputObject ([string]$_) -Compress }) -join ', '
        $parts.Add("  `"security`": {`r`n    `"hosts`": [$list]`r`n  }")
    }
    if (-not $PSBoundParameters.ContainsKey('Lan') -or $null -eq $Lan) {
        $Lan = ConvertFrom-BylLanConfig -Text $Text
    }
    $addresses = New-Object System.Collections.Generic.List[string]
    foreach ($entry in @($Lan.Addresses)) {
        $address = ConvertTo-BylLanAddress -Text $entry
        if ($null -ne $address -and -not $addresses.Contains($address) -and $addresses.Count -lt $BylLanMax) { $addresses.Add($address) }
    }
    # Switched off, the addresses stay for switching on again; without any the section goes (on
    # without an address would mean nothing).
    if ($addresses.Count -gt 0) {
        $switch = if ($Lan.Enabled) { 'true' } else { 'false' }
        $list = ($addresses | ForEach-Object { ConvertTo-Json -InputObject ([string]$_) -Compress }) -join ', '
        $parts.Add("  `"network`": {`r`n    `"lan`": {`r`n      `"enabled`": $switch,`r`n      `"addresses`": [$list]`r`n    }`r`n  }")
    }
    if ($parts.Count -eq 0) { return "{`r`n}`r`n" }
    return "{`r`n" + ($parts -join ",`r`n") + "`r`n}`r`n"
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

# --- Backup (ADR-0046) -------------------------------------------------------------------------
# Constants here; the functions follow at the end of this file (ConvertFrom-BylBackupConfig ...).

# The helper that seals (encrypts) and opens backups; next to pocketbase.exe, gitignored.
$BylBackupHelperName = 'byl-backup.exe'
# Backups of the app itself in pb_data\backups (UTC time stamp); other ZIP files there (manual
# backups of the admin UI, the former automatic ones) are never touched.
$BylLocalBackupPattern = '^byl-\d{8}-\d{6}\.zip$'
# Sealed backups in the target folder, same stamp as the local backup they come from.
$BylSealedBackupPattern = '^byl-\d{8}-\d{6}\.tar\.age$'
# Generations kept (GFS), defaults and limits; the same numbers as lib/backup-rules.js.
$BylBackupKeep = [ordered]@{
    daily   = [pscustomobject]@{ Default = 7; Min = 1; Max = 30 }
    weekly  = [pscustomobject]@{ Default = 4; Min = 0; Max = 12 }
    monthly = [pscustomobject]@{ Default = 6; Min = 0; Max = 24 }
}
$BylBackupTargetMaxLength = 240
$BylPassphraseMinLength = 12
$BylPassphraseMaxBytes = 1024
# Free space a target needs at least, besides the size of the backup itself.
$BylBackupReserveBytes = 200MB
# Restore (ADR-0046 section 7). The data folder before a restore stays next to pb_data under this
# prefix and the UTC time stamp for $BylSafetyKeepDays days (the cron of the backups removes older
# ones); the backup is unpacked first under the staging prefix, on the same drive.
$BylSafetyCopyPrefix = 'pb_data.vor-wiederherstellung-'
$BylStagingPrefix = 'pb_data.neu-'
$BylSafetyKeepDays = 7
# The word that confirms a restore, in the console and on the page (also lib/backup-rules.js).
$BylRestoreConfirmWord = 'WIEDERHERSTELLEN'
# What a restore does with the access data of a backup: write those missing in the account
# (default), all of them (overwriting) or none.
$BylCredentialModes = @('missing', 'all', 'none')

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
$BylRestartParts = @('server', 'migrations', 'hooks', 'port', 'hosts', 'lan', 'environment', 'mailHelper')
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
    # Get-EnvironmentHash of the BYL_* variables ('' if it cannot be built); $Hosts the further hosts
    # of byl-config.json (ADR-0055), '' without any, also in a state file of before; $Lan the
    # addresses of the home network a start uses (Get-BylLanAddress, plan heimnetz), likewise.
    param(
        [Parameter(Mandatory = $true)][string]$AppDir,
        [Parameter(Mandatory = $true)][int]$Port,
        [AllowNull()][AllowEmptyCollection()][string[]]$Hosts = @(),
        [AllowNull()][AllowEmptyCollection()][string[]]$Lan = @(),
        [AllowEmptyString()][string]$EnvironmentHash = ''
    )

    return [ordered]@{
        server      = Get-FileStamp -Path ([System.IO.Path]::Combine($AppDir, 'pocketbase.exe'))
        migrations  = Get-FolderHash -Folder ([System.IO.Path]::Combine($AppDir, 'pb_migrations'))
        hooks       = Get-FolderHash -Folder ([System.IO.Path]::Combine($AppDir, 'pb_hooks')) -Recurse
        port        = [string]$Port
        hosts       = (@($Hosts) | Where-Object { -not [string]::IsNullOrEmpty($_) }) -join ','
        lan         = (@($Lan) | Where-Object { -not [string]::IsNullOrEmpty($_) }) -join ','
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
    # Port of a --http value "127.0.0.1:<port>", or "0.0.0.0:<port>" of a start with the access in
    # the home network (plan heimnetz); $null for any other host (a name, IPv6, another address) or
    # form.
    param([AllowNull()][AllowEmptyString()][string]$Value)

    if ([string]::IsNullOrEmpty($Value) -or $Value -cnotmatch '^(?:127\.0\.0\.1|0\.0\.0\.0):(\d{1,5})$') { return $null }
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
    # Port of a PocketBase server process from its --http flag; $null if it is neither
    # 127.0.0.1:<port> nor 0.0.0.0:<port>.
    param([AllowNull()][object]$Process)

    return Get-HttpPort -Value (Get-FlagValue -Arguments (Get-ProcessArgument -Process $Process) -Name 'http')
}

function Select-AppProcess {
    # Returns the app's own PocketBase instance(s) from process objects shaped like Win32_Process
    # (ProcessId, ExecutablePath, CommandLine). A process qualifies only if ALL of this holds:
    #   ExecutablePath = <AppDir>\pocketbase.exe, argument "serve", --http=127.0.0.1:<any port> (or
    #   0.0.0.0:<any port> with the access in the home network, plan heimnetz) and
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

function Test-DevelopmentPath {
    # Whether $Path lies in a working copy for development or tests (plan robuste-skripte RS-4): a
    # folder on the way whose name starts with byl-worktree (a git worktree of an agent) or is .tmp
    # (the disposable copies of the tests). A server from there is a test instance, not a second
    # installation of the user.
    param([AllowNull()][AllowEmptyString()][string]$Path)

    if ([string]::IsNullOrEmpty($Path)) { return $false }
    foreach ($part in ($Path -split '[\\/]')) {
        if ($part -like 'byl-worktree*' -or $part -eq '.tmp') { return $true }
    }
    return $false
}

function Select-OtherServerProcess {
    # PocketBase servers ("serve") that are not the own instance: a copy of the app in another
    # folder or a test instance. Only reported (status, doctor), never stopped. Returns ProcessId,
    # ExecutablePath, Port ($null if not on 127.0.0.1 or 0.0.0.0), SameFolder (the program of this folder
    # with another data folder, e.g. the test harness) and TestInstance (SameFolder, or a program
    # in a worktree or a disposable copy, Test-DevelopmentPath): status and the page System fold
    # test instances into one line, a real second installation stays visible.
    param([AllowNull()][object[]]$Process, [Parameter(Mandatory = $true)][string]$AppDir)

    $ownIds = @(Select-AppProcess -Process $Process -AppDir $AppDir | ForEach-Object { [int]$_.ProcessId })
    foreach ($candidate in @($Process)) {
        if ($null -eq $candidate -or $ownIds -contains [int]$candidate.ProcessId) { continue }
        $path = [string]$candidate.ExecutablePath
        $name = if ($path) { [System.IO.Path]::GetFileName($path) } else { [string]$candidate.Name }
        if (-not [string]::Equals($name, 'pocketbase.exe', [System.StringComparison]::OrdinalIgnoreCase)) { continue }
        if ((Get-ProcessArgument -Process $candidate) -cnotcontains 'serve') { continue }
        $sameFolder = Test-FileInFolder -Path $path -Folder $AppDir
        [pscustomobject]@{
            ProcessId      = [int]$candidate.ProcessId
            ExecutablePath = if ($path) { $path } else { $null }
            Port           = Get-ServerProcessPort -Process $candidate
            SameFolder     = $sameFolder
            TestInstance   = $sameFolder -or (Test-DevelopmentPath -Path $path)
        }
    }
}

function Get-TestInstanceSummary {
    # "1 Test-Instanz (Entwicklung) auf Port 53211" or "3 Test-Instanzen (Entwicklung) auf Port
    # 53211, 53212": the test instances of Select-OtherServerProcess in one line (status, doctor).
    param([AllowNull()][AllowEmptyCollection()][object[]]$Server)

    $list = @(@($Server) | Where-Object { $null -ne $_ })
    $noun = if ($list.Count -eq 1) { 'Test-Instanz' } else { 'Test-Instanzen' }
    $ports = @($list | Where-Object { $null -ne $_.Port } | ForEach-Object { [int]$_.Port } | Sort-Object -Unique)
    $where = if ($ports.Count -gt 0) { ' auf Port ' + ($ports -join ', ') } else { '' }
    return "$($list.Count) $noun (Entwicklung)$where"
}

function Resolve-PortState {
    # Classifies LISTEN sockets shaped like Get-NetTCPConnection (LocalAddress, LocalPort,
    # OwningProcess) for http://127.0.0.1:<Port>:
    #   App     - the own instance (Select-AppProcess) listens on 127.0.0.1:<Port>, or on 0.0.0.0 or
    #             :: with the access in the home network (Go listens on both stacks for 0.0.0.0),
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
    $own = @($relevant | Where-Object { $ownIds -contains [int]$_.OwningProcess })
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

# An unexpected error in byl-control.log: its message is cut to this length.
$BylErrorMessageMax = 300

function Format-ControlErrorLine {
    # The second line of byl-control.log after an unexpected error (ADR-0048): UTC time, command,
    # type of the exception, place in the script and its message on one line, without the values in
    # $Secrets (Protect-LogText) and without e-mail addresses, cut to $BylErrorMessageMax characters.
    # These lines are what a person sends to Claude (catalog entry "unexpected").
    param(
        [Parameter(Mandatory = $true)][DateTime]$TimeUtc,
        [Parameter(Mandatory = $true)][string]$Command,
        [AllowEmptyString()][string]$ErrorType = '',
        [AllowEmptyString()][string]$Position = '',
        [AllowNull()][AllowEmptyString()][string]$Message = '',
        [AllowEmptyCollection()][AllowNull()][string[]]$Secrets = @()
    )

    $text = Protect-LogText -Text (([string]$Message -replace '[\r\n]+', ' ').Trim()) -Secrets $Secrets
    $text = [regex]::Replace($text, '[\w.+-]+@[\w-]+(\.[\w-]+)+', '***')
    if ($text.Length -gt $BylErrorMessageMax) { $text = $text.Substring(0, $BylErrorMessageMax - 3) + '...' }
    return '{0} {1} error type={2} at={3} message="{4}"' -f $TimeUtc.ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ'), $Command, $ErrorType, $Position, $text
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
    # Arguments for pocketbase.exe (CLAUDE.md sections 3 and 9): only 127.0.0.1:<Port>, CORS only
    # for the own origins and the further hosts $Hosts (Get-BylOrigins, ADR-0055), data, hooks,
    # migrations and web build from the app folder, --automigrate=false, never --dev. With addresses
    # of the home network $Lan (Get-BylLanAddress, plan heimnetz) on every address of the computer,
    # 0.0.0.0:<Port>, and with their http origins: PocketBase takes one address for --http only, and
    # the guard of pb_hooks lets through only the hosts of the origins. Paths are quoted (spaces, #);
    # Windows paths cannot contain double quotes, origins contain no spaces.
    param(
        [Parameter(Mandatory = $true)][string]$AppDir,
        [int]$Port = $BylPort,
        [AllowNull()][AllowEmptyCollection()][string[]]$Hosts = @(),
        [AllowNull()][AllowEmptyCollection()][string[]]$Lan = @()
    )

    $folder = { param([string]$Name) [System.IO.Path]::Combine($AppDir, $Name) }
    $bind = if (@(@($Lan) | Where-Object { -not [string]::IsNullOrEmpty($_) }).Count -gt 0) { '0.0.0.0' } else { '127.0.0.1' }
    return ('serve --http={0}:{1} --origins={2} --dir="{3}" --hooksDir="{4}" --migrationsDir="{5}" --publicDir="{6}" --automigrate=false --indexFallback=true' -f
        $bind, $Port, (Get-BylOrigins -Port $Port -Hosts $Hosts -Lan $Lan), (& $folder 'pb_data'), (& $folder 'pb_hooks'), (& $folder 'pb_migrations'), (& $folder 'pb_public'))
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
# on SIGBREAK. CTRL_C_EVENT is not used: a process can inherit the flag that ignores it. The break
# reaches every process of the console, so the child sends only while the console belongs to the
# target alone:
# - Another program shares it (a server started by hand in a terminal): nothing is sent (3), so no
#   other program ever gets the signal.
# - Only processes the target started share it (ST-1): the hooks of the app run byl-control.ps1
#   (backup-verify of the cron job byl-backup, the commands of the page System) and the hashing of
#   the folders as children of PocketBase, which inherit its console. The child waits up to
#   $WaitMilliseconds for them to end and sends then; they never get the signal. Still there after
#   that: nothing is sent (5). A process counts as started by the target when the chain of its
#   parents leads to the target and every process of the chain started after its parent (a parent
#   ID that Windows gave to a newer process does not count). A verdict "another program" is looked
#   at once more after 100 ms, in case a child of the target ended right in between.
# Exit codes: 0 sent, 2 no console to attach, 3 console shared with another program, 4 sending
# failed, 5 processes of the target still on its console.
$BylConsoleBreakSource = @'
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Runtime.InteropServices;
public static class BylConsoleBreak {
    public delegate bool Handler(uint controlType);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool AttachConsole(uint processId);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool FreeConsole();
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool SetConsoleCtrlHandler(Handler handler, bool add);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool GenerateConsoleCtrlEvent(uint controlEvent, uint processGroupId);
    [DllImport("kernel32.dll", SetLastError = true)] static extern uint GetConsoleProcessList(uint[] processIds, uint count);
    [DllImport("kernel32.dll", SetLastError = true)] static extern IntPtr CreateToolhelp32Snapshot(uint flags, uint processId);
    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)] static extern bool Process32FirstW(IntPtr snapshot, ref ProcessEntry entry);
    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)] static extern bool Process32NextW(IntPtr snapshot, ref ProcessEntry entry);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool CloseHandle(IntPtr handle);
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    struct ProcessEntry {
        public uint Size; public uint Usage; public uint ProcessId; public IntPtr DefaultHeapId; public uint ModuleId;
        public uint Threads; public uint ParentProcessId; public int PriorityBase; public uint Flags;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 260)] public string ExeFile;
    }
    static readonly Handler Ignore = delegate (uint controlType) { return true; };
    // Parent of every running process (TH32CS_SNAPPROCESS); empty if Windows gives no snapshot.
    static Dictionary<uint, uint> Parents() {
        Dictionary<uint, uint> parents = new Dictionary<uint, uint>();
        IntPtr snapshot = CreateToolhelp32Snapshot(2, 0);
        if (snapshot == new IntPtr(-1)) return parents;
        try {
            ProcessEntry entry = new ProcessEntry();
            entry.Size = (uint)Marshal.SizeOf(typeof(ProcessEntry));
            for (bool more = Process32FirstW(snapshot, ref entry); more; more = Process32NextW(snapshot, ref entry)) {
                parents[entry.ProcessId] = entry.ParentProcessId;
            }
        }
        finally {
            CloseHandle(snapshot);
        }
        return parents;
    }
    static DateTime? Started(uint processId) {
        try {
            using (Process process = Process.GetProcessById((int)processId)) { return process.StartTime; }
        }
        catch {
            return null;
        }
    }
    static bool Descends(uint processId, uint target, Dictionary<uint, uint> parents) {
        uint current = processId;
        for (int depth = 0; depth < 16; depth++) {
            uint parent;
            if (!parents.TryGetValue(current, out parent) || parent == 0 || parent == current) return false;
            DateTime? child = Started(current);
            DateTime? started = Started(parent);
            if (child == null || started == null || child.Value < started.Value) return false;
            if (parent == target) return true;
            current = parent;
        }
        return false;
    }
    // 0 the console belongs to the target (and this process), 5 also to processes the target
    // started, 3 also to another program.
    static int Sharing(uint processId, uint self) {
        uint[] ids = new uint[64];
        uint count = GetConsoleProcessList(ids, (uint)ids.Length);
        if (count == 0 || count > ids.Length) return 3;
        Dictionary<uint, uint> parents = null;
        int sharing = 0;
        for (int i = 0; i < count; i++) {
            if (ids[i] == processId || ids[i] == self) continue;
            if (parents == null) parents = Parents();
            // Ended since the list was taken: gone at the next look.
            if (!parents.ContainsKey(ids[i])) { sharing = 5; continue; }
            if (!Descends(ids[i], processId, parents)) return 3;
            sharing = 5;
        }
        return sharing;
    }
    public static int Send(uint processId, int waitMilliseconds) {
        FreeConsole();
        if (!AttachConsole(processId)) return 2;
        // Registered after attaching (a new console resets the handling of this process): the
        // break goes to every process of the console, this one included, and must not end it.
        SetConsoleCtrlHandler(null, true);
        SetConsoleCtrlHandler(Ignore, true);
        try {
            uint self = (uint)Process.GetCurrentProcess().Id;
            DateTime deadline = DateTime.UtcNow.AddMilliseconds(waitMilliseconds);
            while (true) {
                int sharing = Sharing(processId, self);
                if (sharing == 3) {
                    System.Threading.Thread.Sleep(100);
                    sharing = Sharing(processId, self);
                    if (sharing == 3) return 3;
                }
                if (sharing == 0) break;
                if (DateTime.UtcNow >= deadline) return 5;
                System.Threading.Thread.Sleep(100);
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
    # -EncodedCommand for powershell.exe that sends the console break to $ProcessId, waiting up to
    # $WaitMilliseconds for processes the target started to leave its console.
    param(
        [Parameter(Mandatory = $true)][ValidateRange(1, [int]::MaxValue)][int]$ProcessId,
        [ValidateRange(0, 600000)][int]$WaitMilliseconds = 0
    )

    $script = "Add-Type -TypeDefinition @'`r`n$BylConsoleBreakSource`r`n'@`r`nexit ([BylConsoleBreak]::Send([uint32]$ProcessId, $WaitMilliseconds))"
    return [Convert]::ToBase64String([System.Text.Encoding]::Unicode.GetBytes($script))
}

# Exit code of a sender that the break ended itself (STATUS_CONTROL_C_EXIT, 0xC000013A as Int32):
# the break reached its console, so it reached the target as well.
$BylBreakEndedSender = -1073741510

function Resolve-BreakCode {
    # What the exit code of the sending child says about the console break (plan test-haertung,
    # T-3): 'Sent' (0, or the sender ended by the break itself), 'Refused' (3: another program
    # shares the console, it may not get the signal), 'Busy' (5, since ST-1: processes the target
    # started still shared its console after the wait of the sender), 'NotSent' (2 no console to
    # attach, 4 sending failed, 1 the child failed before sending, e.g. compiling its code under
    # load, -2 the child did not start) or 'Unknown' (-1 the child hung and was ended, anything else).
    param([Parameter(Mandatory = $true)][int]$Code)

    if ($Code -eq 0 -or $Code -eq $BylBreakEndedSender) { return 'Sent' }
    if ($Code -eq 3) { return 'Refused' }
    if ($Code -eq 5) { return 'Busy' }
    if ($Code -in -2, 1, 2, 4) { return 'NotSent' }
    return 'Unknown'
}

function Resolve-HardStopReason {
    # Why a process had to be ended hard, from the codes of its senders (Resolve-BreakCode):
    # 'Refused' (another program shares its console), 'Busy' (processes it started were still
    # running after the wait) or 'Timeout' (no break went out or the process did not end in time).
    param([AllowEmptyCollection()][int[]]$Codes = @())

    $kinds = @(foreach ($code in $Codes) { Resolve-BreakCode -Code $code })
    if ($kinds -contains 'Refused') { return 'Refused' }
    if ($kinds -contains 'Busy') { return 'Busy' }
    return 'Timeout'
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
    # back). A refused break (another program on the console) and one the sender held back because
    # processes of the target still ran after its wait ('Busy', ST-1) are never repeated. The codes
    # of the attempts go to $Codes (for the log and Resolve-HardStopReason). Returns 'Graceful',
    # 'Forced' or 'Running' (still there).
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
        if ($kind -eq 'Refused' -or $kind -eq 'Busy') { break }
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
    # folders (as Get-ServerArgumentString) with --automigrate=false; with -DataDir and -HooksDir
    # on the unpacked copy of a backup for the throwaway server of a check (ADR-0046 section 6).
    # The flags come first and "--" ends them, so an e-mail or password starting with "-" is never
    # read as a flag.
    param(
        [Parameter(Mandatory = $true)][string]$AppDir,
        [Parameter(Mandatory = $true)][string]$Email,
        [Parameter(Mandatory = $true)][string]$Password,
        [string]$DataDir,
        [string]$HooksDir
    )

    $folder = { param([string]$Name) [System.IO.Path]::Combine($AppDir, $Name) }
    if ([string]::IsNullOrEmpty($DataDir)) { $DataDir = & $folder 'pb_data' }
    if ([string]::IsNullOrEmpty($HooksDir)) { $HooksDir = & $folder 'pb_hooks' }
    $arguments = @(
        'superuser', 'upsert',
        "--dir=$DataDir",
        "--hooksDir=$HooksDir",
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

function ConvertFrom-BylBackupConfig {
    # Backups (ADR-0046; constants under "Backup" at the top of this file).
    # Backup settings from the text of byl-config.json: Target ($null without one), Daily, Weekly,
    # Monthly (defaults outside the limits) and Credentials (on unless switched off), Present (the
    # file has a backup section). Never throws: a broken file is the business of the port check.
    param([AllowNull()][AllowEmptyString()][string]$Text)

    $result = [pscustomobject]@{
        Present     = $false
        Target      = $null
        Daily       = $BylBackupKeep.daily.Default
        Weekly      = $BylBackupKeep.weekly.Default
        Monthly     = $BylBackupKeep.monthly.Default
        Credentials = $true
    }
    try {
        $value = if ([string]::IsNullOrWhiteSpace($Text)) { $null } else { $Text | ConvertFrom-Json }
    }
    catch {
        return $result
    }
    if ($null -eq $value -or $value -isnot [System.Management.Automation.PSCustomObject] -or $null -eq $value.PSObject.Properties['backup']) {
        return $result
    }
    $backup = $value.backup
    if ($null -eq $backup -or $backup -isnot [System.Management.Automation.PSCustomObject]) { return $result }
    $result.Present = $true
    if ($null -ne $backup.PSObject.Properties['target'] -and $backup.target -is [string] -and $backup.target.Trim() -ne '') {
        $result.Target = $backup.target.Trim()
    }
    foreach ($name in @($BylBackupKeep.Keys)) {
        $property = $backup.PSObject.Properties[$name]
        $limit = $BylBackupKeep[$name]
        if ($null -ne $property -and ($property.Value -is [int] -or $property.Value -is [long]) -and $property.Value -ge $limit.Min -and $property.Value -le $limit.Max) {
            $result.($name.Substring(0, 1).ToUpperInvariant() + $name.Substring(1)) = [int]$property.Value
        }
    }
    if ($null -ne $backup.PSObject.Properties['credentials'] -and $backup.credentials -is [bool]) { $result.Credentials = $backup.credentials }
    return $result
}

function Test-BylBackupTarget {
    # Whether $Path can be a target folder of backups: a full path (drive letter, colon and
    # backslash, or \\server\share\...),
    # without "." or ".." parts and characters Windows does not allow, at most
    # $BylBackupTargetMaxLength characters, and not inside the app folder (a copy of the folder would
    # take the backups along, a lost disk both). $null if it can, otherwise 'Format', 'TooLong' or
    # 'InsideApp'. Existence, write access and space are checked by the caller.
    param([AllowNull()][AllowEmptyString()][string]$Path, [Parameter(Mandatory = $true)][string]$AppDir)

    if ([string]::IsNullOrWhiteSpace($Path)) { return 'Format' }
    $value = $Path.Trim()
    if ($value.Length -gt $BylBackupTargetMaxLength) { return 'TooLong' }
    if ($value -notmatch '^(?:[A-Za-z]:\\|\\\\[^\\/:*?"<>|]+\\[^\\/:*?"<>|]+)') { return 'Format' }
    $rest = if ($value -match '^[A-Za-z]:\\') { $value.Substring(3) } else { $value.Substring(2) }
    if ($rest -match '[/:*?"<>|]' -or $rest -match '[\x00-\x1f]') { return 'Format' }
    foreach ($part in ($rest -split '\\')) {
        if ($part -eq '.' -or $part -eq '..') { return 'Format' }
    }
    $folder = $value.TrimEnd('\') + '\'
    $app = $AppDir.TrimEnd('\') + '\'
    if ($folder.StartsWith($app, [System.StringComparison]::OrdinalIgnoreCase)) { return 'InsideApp' }
    return $null
}

function Test-BylPassphrase {
    # $null for a usable passphrase, otherwise 'Mismatch', 'TooShort' (fewer than
    # $BylPassphraseMinLength characters), 'TooLong' (more than $BylPassphraseMaxBytes bytes in
    # UTF-8) or 'Character' (control characters). Spaces and every other character are fine.
    param([AllowNull()][AllowEmptyString()][string]$Passphrase, [AllowNull()][AllowEmptyString()][string]$Confirmation)

    if ($Passphrase -cne $Confirmation) { return 'Mismatch' }
    if ([string]::IsNullOrEmpty($Passphrase) -or $Passphrase.Length -lt $BylPassphraseMinLength) { return 'TooShort' }
    if ([System.Text.Encoding]::UTF8.GetByteCount($Passphrase) -gt $BylPassphraseMaxBytes) { return 'TooLong' }
    if ($Passphrase -match '[\x00-\x1f\x7f]') { return 'Character' }
    return $null
}

function Get-BylPassphrasePath {
    # File of the passphrase of this app folder under $BaseDir (%LOCALAPPDATA%\becauseyoulovejira):
    # outside the app folder and pb_data, so no copy and no backup takes it along, and one per app
    # folder (SHA-256 of the full path in lower case), so two copies never share a passphrase.
    param([Parameter(Mandatory = $true)][string]$AppDir, [Parameter(Mandatory = $true)][string]$BaseDir)

    $bytes = [System.Text.Encoding]::UTF8.GetBytes($AppDir.TrimEnd('\').ToLowerInvariant())
    $id = (Get-BytesHash -Bytes $bytes).Substring(0, 16)
    return [System.IO.Path]::Combine($BaseDir, "sicherung-$id.passphrase")
}

function Select-BylSecretVariable {
    # The BYL_* variables of $Variables (name -> value) a backup takes along, sorted by name: valid
    # names (ADR-0018) with a value, without the switches of the tests (BYL_TEST_*).
    param([AllowNull()][System.Collections.IDictionary]$Variables)

    $result = [ordered]@{}
    if ($null -eq $Variables) { return $result }
    foreach ($name in (@($Variables.Keys) | ForEach-Object { [string]$_ } | Sort-Object)) {
        if ($name -cnotmatch $BylSecretNamePattern -or $name.StartsWith('BYL_TEST_')) { continue }
        $value = [string]$Variables[$name]
        if ($value -ne '') { $result[$name] = $value }
    }
    return $result
}

function Get-BylSealedName {
    # Name of the sealed backup of the local backup $LocalName (byl-<stamp>.zip -> byl-<stamp>.tar.age).
    param([Parameter(Mandatory = $true)][string]$LocalName)

    if ($LocalName -notmatch $BylLocalBackupPattern) { throw "not a backup of the app: $LocalName" }
    return $LocalName.Substring(0, $LocalName.Length - 4) + '.tar.age'
}

function Get-BylBackupSpaceVerdict {
    # Whether $FreeBytes on the target suffice for a backup of $NeededBytes: 'Ok', or 'Low' when
    # less than the backup plus $BylBackupReserveBytes is free.
    param([Parameter(Mandatory = $true)][double]$FreeBytes, [double]$NeededBytes = 0)

    if ($FreeBytes -lt ($NeededBytes + $BylBackupReserveBytes)) { return 'Low' }
    return 'Ok'
}

function Get-BylFolderStamp {
    # Name of a folder next to pb_data: $Prefix and the UTC time stamp of $TimeUtc (yyyyMMdd-HHmmss).
    param([Parameter(Mandatory = $true)][string]$Prefix, [Parameter(Mandatory = $true)][DateTime]$TimeUtc)

    return $Prefix + $TimeUtc.ToUniversalTime().ToString('yyyyMMdd-HHmmss', [System.Globalization.CultureInfo]::InvariantCulture)
}

function Test-BylRestoreConfirmation {
    # Whether $Text is the word that confirms a restore (spaces around it do not count, the case does).
    param([AllowNull()][AllowEmptyString()][string]$Text)

    return -not [string]::IsNullOrEmpty($Text) -and $Text.Trim() -ceq $BylRestoreConfirmWord
}

function Select-BylRestoreVariable {
    # The access data of a backup ($Secrets, name -> value) a restore writes into the account in
    # $Mode: 'all' every valid one (Select-BylSecretVariable) with a value an environment variable
    # can hold, 'missing' only those without a value in the account ($Current, name -> value),
    # 'none' nothing. Write (ordered name -> value) and Skipped (names).
    param(
        [AllowNull()][System.Collections.IDictionary]$Secrets,
        [AllowNull()][System.Collections.IDictionary]$Current,
        [Parameter(Mandatory = $true)][ValidateSet('missing', 'all', 'none')][string]$Mode
    )

    $write = [ordered]@{}
    $skipped = New-Object System.Collections.Generic.List[string]
    $valid = Select-BylSecretVariable -Variables $Secrets
    foreach ($name in @($valid.Keys)) {
        $value = [string]$valid[$name]
        $present = $null -ne $Current -and -not [string]::IsNullOrEmpty([string]$Current[$name])
        $holdable = $value.Length -le 32766 -and $value.IndexOf([char]0) -lt 0
        if ($Mode -eq 'none' -or ($Mode -eq 'missing' -and $present) -or -not $holdable) {
            $skipped.Add($name)
            continue
        }
        $write[$name] = $value
    }
    return [pscustomobject]@{ Write = $write; Skipped = @($skipped) }
}

function Get-DetachedRestoreArgumentString {
    # Arguments of Windows PowerShell for the detached restore (restore -Detach, ADR-0046 section 7):
    # the control script $ScriptPath with restore, without browser, only errors and the result, and
    # only after process $WaitForProcess (the caller) ended. The job comes in the environment, never
    # here.
    param([Parameter(Mandatory = $true)][string]$ScriptPath, [Parameter(Mandatory = $true)][int]$WaitForProcess)

    return ('-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "{0}" restore -NoBrowser -Quiet -WaitForProcess {1}' -f
        $ScriptPath, $WaitForProcess)
}
