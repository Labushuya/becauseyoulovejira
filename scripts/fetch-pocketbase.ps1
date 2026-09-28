$ErrorActionPreference = 'Stop'

# Windows entry of scripts/fetch-pocketbase.mjs (ADR-0028, plan plattformen S0): the Node script
# holds the pinned version and the SHA256 of every platform and writes app\pocketbase.exe here,
# app/pocketbase on Linux. Node.js 24 must be in PATH, as for scripts\build.ps1.
#
# Call: powershell -NoProfile -ExecutionPolicy Bypass -File scripts\fetch-pocketbase.ps1

$node = Get-Command node -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $node) {
    Write-Host 'Node.js was not found in PATH; it is needed to fetch PocketBase.' -ForegroundColor Red
    exit 1
}
& $node.Source (Join-Path $PSScriptRoot 'fetch-pocketbase.mjs')
exit $LASTEXITCODE
