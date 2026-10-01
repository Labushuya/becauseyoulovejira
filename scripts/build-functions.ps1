# Helpers of the build scripts (scripts\build.ps1, build-mail-helper.ps1, build-backup-helper.ps1;
# ADR-0040, addendum "Build und Abhaengigkeiten"). Plain ASCII, dot-sourced; only
# Update-BylDependency prints (its progress and the output of npm).
#
# A folder with a package-lock.json keeps the SHA-256 of that lockfile in node_modules after an
# "npm ci". The next build compares it: a changed lockfile (an update of a dependency, a merge of
# main) means "npm ci" again, so the build never checks, builds and tests with the versions of an
# older lockfile. node_modules without the marker (installed by an older build or by hand) counts
# as unknown and is installed once more; "npm ci" removes node_modules first, so a failed install
# never leaves a marker behind.

# The folders with their own package-lock.json, relative to the root of the repository.
$BylDependencyFolders = @('.', 'web', 'helpers/mail', 'helpers/backup', 'extensions/whatsapp-web')
$BylDependencyMarkerName = '.byl-lockfile.sha256'

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
    # remembers the lockfile afterwards. Returns 'Current' or 'Installed'; throws if there is no
    # lockfile or npm ci fails (exit code in the message).
    param([Parameter(Mandatory = $true)][string]$Root, [Parameter(Mandatory = $true)][string]$Folder)

    $path = [System.IO.Path]::GetFullPath([System.IO.Path]::Combine($Root, $Folder))
    $label = if ($Folder -eq '.') { 'root' } else { $Folder }
    $state = Get-BylDependencyState -Folder $path
    if ($state.State -eq 'NoLockfile') { throw "No package-lock.json in $path." }
    if ($state.State -eq 'Current') {
        Write-Host "Dependencies of ${label}: up to date."
        return 'Current'
    }
    Write-Host "Dependencies of ${label}: $(Get-BylDependencyReason -State $state.State), installing (npm ci) ..."
    # Out-Host: the output of npm must not become the return value of this function.
    & npm --prefix $path ci | Out-Host
    if ($LASTEXITCODE -ne 0) { throw "npm ci failed in $path (exit code $LASTEXITCODE)." }
    Set-BylDependencyMarker -Folder $path -Hash $state.Hash
    return 'Installed'
}
