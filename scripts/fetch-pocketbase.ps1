param(
    [string]$Version = "0.40.4"
)

$ErrorActionPreference = "Stop"
$scriptPath = Split-Path -Parent $MyInvocation.MyCommand.Path
$appDir = Join-Path $scriptPath "..\app"
$pbExePath = Join-Path $appDir "pocketbase.exe"
$tempDir = [System.IO.Path]::GetTempPath()
$workDir = Join-Path $tempDir "pb-fetch-$([guid]::NewGuid().ToString().Substring(0, 8))"

# Ensure app directory exists
New-Item -ItemType Directory -Path $appDir -Force | Out-Null

# Check if already exists and version matches
if (Test-Path $pbExePath) {
    try {
        $currentVersion = & $pbExePath --version 2>&1 | Select-Object -First 1
        if ($currentVersion -like "*$Version*") {
            Write-Host "PocketBase $Version already present at $pbExePath"
            exit 0
        }
    }
    catch {
        # If version check fails, proceed with download
    }
}

try {
    New-Item -ItemType Directory -Path $workDir -Force | Out-Null

    $zipUrl = "https://github.com/pocketbase/pocketbase/releases/download/v$Version/pocketbase_${Version}_windows_amd64.zip"
    $checksumUrl = "https://github.com/pocketbase/pocketbase/releases/download/v$Version/checksums.txt"
    $zipPath = Join-Path $workDir "pocketbase.zip"
    $checksumPath = Join-Path $workDir "checksums.txt"

    Write-Host "Downloading PocketBase $Version from $zipUrl..."
    Invoke-WebRequest -Uri $zipUrl -OutFile $zipPath -ErrorAction Stop

    Write-Host "Downloading checksums from $checksumUrl..."
    Invoke-WebRequest -Uri $checksumUrl -OutFile $checksumPath -ErrorAction Stop

    # Verify SHA256
    Write-Host "Verifying SHA256 checksum..."
    $fileHash = (Get-FileHash -Path $zipPath -Algorithm SHA256).Hash
    $checksumContent = Get-Content $checksumPath -Raw

    # Find the line with pocketbase_<version>_windows_amd64.zip
    $checksumLine = $checksumContent -split "`n" | Where-Object { $_ -match "pocketbase_${Version}_windows_amd64\.zip" } | Select-Object -First 1

    if (-not $checksumLine) {
        throw "Could not find checksum for pocketbase_${Version}_windows_amd64.zip in checksums.txt"
    }

    $expectedHash = ($checksumLine -split "\s+")[0].ToUpper()

    if ($fileHash -ne $expectedHash) {
        throw "SHA256 mismatch! Expected: $expectedHash, Got: $fileHash"
    }

    Write-Host "Checksum verified: $fileHash"

    # Extract pocketbase.exe
    Write-Host "Extracting pocketbase.exe..."
    $extractDir = Join-Path $workDir "extract"
    New-Item -ItemType Directory -Path $extractDir -Force | Out-Null
    Expand-Archive -Path $zipPath -DestinationPath $extractDir -Force

    $extractedExe = Join-Path $extractDir "pocketbase.exe"
    if (-not (Test-Path $extractedExe)) {
        throw "pocketbase.exe not found in archive"
    }

    # Copy to app directory
    Copy-Item -Path $extractedExe -Destination $pbExePath -Force
    Write-Host "PocketBase installed to $pbExePath"

    # Verify installation
    $installed = & $pbExePath --version 2>&1 | Select-Object -First 1
    Write-Host "Installed version: $installed"
}
finally {
    # Clean up temp directory
    if (Test-Path $workDir) {
        Remove-Item -Path $workDir -Recurse -Force -ErrorAction SilentlyContinue
    }
}

Write-Host "Done."
