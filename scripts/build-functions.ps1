# Helpers of the build scripts (scripts\build.ps1, build-mail-helper.ps1, build-backup-helper.ps1,
# fetch-pocketbase.ps1; ADR-0040, addendum "Build und Abhaengigkeiten"). Plain ASCII, dot-sourced;
# only Update-BylDependency (its progress and the output of npm) and the problems print.
#
# Problems (ADR-0048): the entries of the catalog app\byl-problems.ps1, printed by
# Write-BylBuildProblem with the paths of this repository. No log file: the output above a problem
# is its detail.
#
# A folder with a package-lock.json keeps the SHA-256 of that lockfile in node_modules after an
# "npm ci". The next build compares it: a changed lockfile (an update of a dependency, a merge of
# main) means "npm ci" again, so the build never checks, builds and tests with the versions of an
# older lockfile. node_modules without the marker (installed by an older build or by hand) counts
# as unknown and is installed once more; "npm ci" removes node_modules first, so a failed install
# never leaves a marker behind.

$BylRepositoryRoot = Split-Path -Parent $PSScriptRoot
. ([System.IO.Path]::Combine($BylRepositoryRoot, 'app', 'byl-problems.ps1'))

# The folders with their own package-lock.json, relative to the root of the repository.
$BylDependencyFolders = @('.', 'web', 'helpers/mail', 'helpers/backup', 'extensions/whatsapp-web')
$BylDependencyMarkerName = '.byl-lockfile.sha256'
# Node.js the build needs (engines of package.json).
$BylNodeMajor = 24

function Write-BylBuildProblem {
    # Prints the entry $Code of the catalog with the paths of this repository (Get-BylProblemValues
    # without a log) and returns its exit code, for "exit (Write-BylBuildProblem ...)".
    param(
        [Parameter(Mandatory = $true)][string]$Code,
        [System.Collections.IDictionary]$Values = @{},
        [AllowEmptyCollection()][string[]]$Facts = @()
    )

    $all = Get-BylProblemValues -AppDir ([System.IO.Path]::Combine($BylRepositoryRoot, 'app')) -Log '' -RepositoryRoot $BylRepositoryRoot
    foreach ($key in @($Values.Keys)) { $all[[string]$key] = $Values[$key] }
    $report = Get-BylProblemReport -Code $Code -Values $all -Facts $Facts
    $lines = @(Format-BylProblem -Report $report)
    Write-Host ''
    Write-Host $lines[0] -ForegroundColor $(if ($report.Level -eq 'error') { 'Red' } else { 'Yellow' })
    foreach ($line in @($lines | Select-Object -Skip 1)) { Write-Host $line }
    return $report.Exit
}

function Write-BylBuildError {
    # The error $ErrorRecord of a catch in a build script: its entry when it was thrown with
    # New-BylProblemError, else build-unexpected with its message. Returns the exit code.
    param([Parameter(Mandatory = $true)][object]$ErrorRecord)

    $thrown = Get-BylProblemOfError -ErrorRecord $ErrorRecord
    if ($null -ne $thrown) { return Write-BylBuildProblem -Code $thrown.Code -Values $thrown.Values -Facts $thrown.Facts }
    $position = '{0}:{1}' -f [System.IO.Path]::GetFileName([string]$ErrorRecord.InvocationInfo.ScriptName), $ErrorRecord.InvocationInfo.ScriptLineNumber
    return Write-BylBuildProblem -Code 'build-unexpected' -Values @{ detail = $ErrorRecord.Exception.Message } -Facts @("Stelle: $position")
}

function Find-BylNodeFolder {
    # A folder with node.exe of version $BylNodeMajor or newer outside PATH, for the command of
    # node-missing and node-old: the usual places of an installation and a folder tools\node next to
    # the repository or one of the folders above it (a portable Node of the developer). '' if none.
    $candidates = New-Object System.Collections.Generic.List[string]
    foreach ($base in @($env:ProgramFiles, ${env:ProgramFiles(x86)}, $env:LOCALAPPDATA)) {
        if (-not [string]::IsNullOrEmpty($base)) {
            $candidates.Add([System.IO.Path]::Combine($base, 'nodejs'))
            $candidates.Add([System.IO.Path]::Combine($base, 'Programs', 'nodejs'))
        }
    }
    if (-not [string]::IsNullOrEmpty($env:NVM_SYMLINK)) { $candidates.Add($env:NVM_SYMLINK) }
    $folder = $BylRepositoryRoot
    while (-not [string]::IsNullOrEmpty($folder)) {
        $candidates.Add([System.IO.Path]::Combine($folder, 'tools', 'node'))
        $folder = [System.IO.Path]::GetDirectoryName($folder)
    }
    foreach ($candidate in $candidates) {
        $node = [System.IO.Path]::Combine($candidate, 'node.exe')
        if (-not [System.IO.File]::Exists($node)) { continue }
        try {
            $version = (& $node --version | Out-String).Trim()
        }
        catch {
            continue
        }
        if ($version -match '^v(\d+)\.' -and [int]$Matches[1] -ge $BylNodeMajor) { return $candidate }
    }
    return ''
}

function Assert-BylNode {
    # Node.js $BylNodeMajor or newer and npm in PATH; the node.exe found, or the exit code of the
    # problem (node-missing, node-version, node-old, npm-missing) as a number.
    $node = Get-Command node -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
    if (-not $node) { return Write-BylBuildProblem -Code 'node-missing' -Values @{ nodeDir = Find-BylNodeFolder } }
    $version = (& $node.Source --version | Out-String).Trim()
    if ($LASTEXITCODE -ne 0 -or $version -notmatch '^v(\d+)\.') {
        return Write-BylBuildProblem -Code 'node-version' -Values @{ path = $node.Source }
    }
    if ([int]$Matches[1] -lt $BylNodeMajor) {
        return Write-BylBuildProblem -Code 'node-old' -Values @{ version = $version; path = $node.Source; major = $BylNodeMajor; nodeDir = Find-BylNodeFolder }
    }
    if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
        return Write-BylBuildProblem -Code 'npm-missing' -Values @{ path = $node.Source }
    }
    return $node
}

function Get-BylLockfileHash {
    # SHA-256 of the bytes of the file $Path, as lower-case hex.
    param([Parameter(Mandatory = $true)][string]$Path)

    $sha = [System.Security.Cryptography.SHA256]::Create()
    try {
        $bytes = [System.IO.File]::ReadAllBytes($Path)
        return (($sha.ComputeHash($bytes) | ForEach-Object { $_.ToString('x2') }) -join '')
    }
    finally {
        $sha.Dispose()
    }
}

function Get-BylDependencyState {
    # Whether the dependencies of the folder $Folder match its lockfile. State: 'Current',
    # 'Missing' (no node_modules), 'Unknown' (node_modules without marker), 'Changed' (the
    # lockfile differs from the one of the last "npm ci") or 'NoLockfile'. Hash: of the lockfile
    # now ($null without one).
    param([Parameter(Mandatory = $true)][string]$Folder)

    $lockfile = [System.IO.Path]::Combine($Folder, 'package-lock.json')
    if (-not [System.IO.File]::Exists($lockfile)) { return [pscustomobject]@{ State = 'NoLockfile'; Hash = $null } }
    $hash = Get-BylLockfileHash -Path $lockfile
    $modules = [System.IO.Path]::Combine($Folder, 'node_modules')
    if (-not [System.IO.Directory]::Exists($modules)) { return [pscustomobject]@{ State = 'Missing'; Hash = $hash } }
    $marker = [System.IO.Path]::Combine($modules, $BylDependencyMarkerName)
    if (-not [System.IO.File]::Exists($marker)) { return [pscustomobject]@{ State = 'Unknown'; Hash = $hash } }
    $stored = ([System.IO.File]::ReadAllText($marker)).Trim()
    if ($stored -ne $hash) { return [pscustomobject]@{ State = 'Changed'; Hash = $hash } }
    return [pscustomobject]@{ State = 'Current'; Hash = $hash }
}

function Set-BylDependencyMarker {
    # Remembers $Hash in node_modules of $Folder, after a successful "npm ci" only.
    param([Parameter(Mandatory = $true)][string]$Folder, [Parameter(Mandatory = $true)][string]$Hash)

    $marker = [System.IO.Path]::Combine($Folder, 'node_modules', $BylDependencyMarkerName)
    [System.IO.File]::WriteAllText($marker, $Hash, (New-Object System.Text.UTF8Encoding($false)))
}

function Get-BylDependencyReason {
    # Why a folder is installed again, for the output of the build ($null if it is current).
    param([Parameter(Mandatory = $true)][string]$State)

    switch ($State) {
        'Missing' { return 'node_modules is missing' }
        'Unknown' { return 'installed without a lockfile marker (older build or by hand)' }
        'Changed' { return 'package-lock.json changed since the last install' }
        default { return $null }
    }
}

function Update-BylDependency {
    # Runs "npm ci" in $Folder (below $Root) if its node_modules does not match the lockfile and
    # remembers the lockfile afterwards. Returns 'Current' or 'Installed'; throws the problem
    # lockfile-missing or npm-ci (New-BylProblemError, reported by Write-BylBuildError).
    param([Parameter(Mandatory = $true)][string]$Root, [Parameter(Mandatory = $true)][string]$Folder)

    $path = [System.IO.Path]::GetFullPath([System.IO.Path]::Combine($Root, $Folder))
    $label = if ($Folder -eq '.') { 'root' } else { $Folder }
    $state = Get-BylDependencyState -Folder $path
    if ($state.State -eq 'NoLockfile') { throw (New-BylProblemError -Code 'lockfile-missing' -Values @{ folder = $path }) }
    if ($state.State -eq 'Current') {
        Write-Host "Dependencies of ${label}: up to date."
        return 'Current'
    }
    Write-Host "Dependencies of ${label}: $(Get-BylDependencyReason -State $state.State), installing (npm ci) ..."
    # Out-Host: the output of npm must not become the return value of this function.
    & npm --prefix $path ci | Out-Host
    if ($LASTEXITCODE -ne 0) { throw (New-BylProblemError -Code 'npm-ci' -Values @{ folder = $path; code = $LASTEXITCODE }) }
    Set-BylDependencyMarker -Folder $path -Hash $state.Hash
    return 'Installed'
}
