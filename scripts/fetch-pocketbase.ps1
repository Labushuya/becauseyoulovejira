$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'build-functions.ps1')

# Windows entry of scripts/fetch-pocketbase.mjs (ADR-0028, plan plattformen S0): the Node script
# holds the pinned version and the SHA256 of every platform and writes app\pocketbase.exe here,
# app/pocketbase on Linux. Node.js 24 must be in PATH, as for scripts\build.ps1. Its exit code names
# the cause (FETCH_EXIT_CODES); this script shows the entry of the catalog for it (ADR-0048), its
# message in English stands above.
#
# Call: powershell -NoProfile -ExecutionPolicy Bypass -File scripts\fetch-pocketbase.ps1

$FetchProblem = @{ 2 = 'pocketbase-download'; 3 = 'pocketbase-checksum'; 4 = 'pocketbase-write'; 5 = 'pocketbase-version'; 6 = 'pocketbase-platform' }

try {
    $node = Assert-BylNode
    if ($node -is [int]) { exit $node }
    & $node.Source (Join-Path $PSScriptRoot 'fetch-pocketbase.mjs')
    $code = $LASTEXITCODE
    if ($code -eq 0) { exit 0 }
    if ($FetchProblem.ContainsKey($code)) {
        exit (Write-BylBuildProblem -Code $FetchProblem[$code] -Values @{ detail = 'Meldung oben' })
    }
    exit (Write-BylBuildProblem -Code 'build-unexpected' -Values @{ detail = "fetch-pocketbase.mjs endete mit Exit-Code $code (Meldung oben)" })
}
catch {
    exit (Write-BylBuildError -ErrorRecord $_)
}
