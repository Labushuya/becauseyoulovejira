$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'build-functions.ps1')

# Builds the backup helper app\byl-backup.exe (ADR-0046 section 3): a single executable application
# of Node 24 with the bundled helpers\backup, like the mail helper (scripts\build-mail-helper.ps1).
# The executable is checked without Node (PATH only with the Windows folders): "--version" and a
# self-test that seals and opens an invented backup in a temporary folder. app\byl-backup.exe is
# gitignored like pocketbase.exe. The helper runs only for a moment (one command per call); should
# it run while the build replaces it, the old file is renamed and removed at a later build or the
# next start of the app (AR-4). Problems are entries of the catalog app\byl-problems.ps1 (ADR-0048).
#
# Call: powershell -NoProfile -ExecutionPolicy Bypass -File scripts\build-backup-helper.ps1

$rootDir = $BylRepositoryRoot
$helperDir = [System.IO.Path]::Combine($rootDir, 'helpers', 'backup')
$appDir = [System.IO.Path]::Combine($rootDir, 'app')
$built = [System.IO.Path]::Combine($helperDir, 'dist', 'byl-backup.exe')
$target = [System.IO.Path]::Combine($appDir, 'byl-backup.exe')
$problemValues = @{ exe = 'byl-backup.exe'; rerun = 'powershell -NoProfile -ExecutionPolicy Bypass -File "{0}"' -f $PSCommandPath }

function Invoke-WithoutNode {
    # Runs the built executable with an environment that has no Node: PATH only with the Windows
    # folders, no NODE_* and no BYL_* variables. Returns ExitCode and Output (stdout and stderr).
    param([Parameter(Mandatory = $true)][string]$Arguments)

    $startInfo = New-Object System.Diagnostics.ProcessStartInfo
    $startInfo.FileName = $built
    $startInfo.Arguments = $Arguments
    $startInfo.UseShellExecute = $false
    $startInfo.CreateNoWindow = $true
    $startInfo.RedirectStandardInput = $true
    $startInfo.RedirectStandardOutput = $true
    $startInfo.RedirectStandardError = $true
    $startInfo.WorkingDirectory = [System.IO.Path]::GetTempPath()
    $startInfo.EnvironmentVariables['PATH'] = "$env:SystemRoot\System32;$env:SystemRoot"
    foreach ($name in @($startInfo.EnvironmentVariables.Keys)) {
        if ($name -like 'NODE_*' -or $name -like 'BYL_*' -or $name -like 'npm_*') {
            $startInfo.EnvironmentVariables.Remove($name)
        }
    }
    $process = [System.Diagnostics.Process]::Start($startInfo)
    try {
        $process.StandardInput.Close()
        $standardOutput = $process.StandardOutput.ReadToEndAsync()
        $standardError = $process.StandardError.ReadToEndAsync()
        if (-not $process.WaitForExit(60000)) {
            $process.Kill()
            throw (New-BylProblemError -Code 'helper-check' -Values ($problemValues + @{ check = $Arguments; code = 'keiner, nach 60 Sekunden beendet' }))
        }
        $process.WaitForExit()
        return [pscustomobject]@{
            ExitCode = $process.ExitCode
            Output   = ($standardOutput.Result + $standardError.Result).Trim()
        }
    }
    finally {
        $process.Dispose()
    }
}

try {
    Push-Location $helperDir
    try {
        # npm ci if node_modules is missing or older than the lockfile (scripts\build-functions.ps1).
        [void](Update-BylDependency -Root $rootDir -Folder 'helpers/backup')
        Write-Host 'Building byl-backup.exe...'
        node build.mjs
        if ($LASTEXITCODE -ne 0) {
            exit (Write-BylBuildProblem -Code 'helper-build' -Values ($problemValues + @{ detail = "node build.mjs, Exit-Code $LASTEXITCODE" }))
        }
    }
    finally {
        Pop-Location
    }

    $version = Invoke-WithoutNode -Arguments '--version'
    if ($version.ExitCode -ne 0 -or $version.Output -notmatch '^byl-backup \d+\.\d+\.\d+$') {
        exit (Write-BylBuildProblem -Code 'helper-check' -Values ($problemValues + @{ check = '--version'; code = $version.ExitCode }) -Facts @($version.Output -split "`r?`n"))
    }
    $selfTest = Invoke-WithoutNode -Arguments '--self-test'
    $selfTestOk = $false
    try {
        $selfTestOk = $selfTest.ExitCode -eq 0 -and ($selfTest.Output | ConvertFrom-Json).ok -eq $true
    }
    catch {
        $selfTestOk = $false
    }
    if (-not $selfTestOk) {
        exit (Write-BylBuildProblem -Code 'helper-check' -Values ($problemValues + @{ check = '--self-test'; code = $selfTest.ExitCode }) -Facts @($selfTest.Output -split "`r?`n"))
    }
    Write-Host "$($version.Output): self-test without Node passed."

    # Leftovers of earlier builds that replaced a running helper (exact names, each removal printed).
    Remove-BylHelperLeftover -AppDir $appDir -Helper $BylBackupHelperName

    try {
        if (Test-Path -LiteralPath $target -PathType Leaf) {
            try {
                Remove-Item -LiteralPath $target -Force
            }
            catch {
                # A running helper locks its file; Windows still allows renaming it.
                $old = 'byl-backup.exe.old-' + [DateTime]::UtcNow.ToString('yyyyMMddHHmmss')
                Rename-Item -LiteralPath $target -NewName $old
                Write-Host "app\byl-backup.exe is running; the old file is now app\$old." -ForegroundColor Yellow
            }
        }
        Copy-Item -LiteralPath $built -Destination $target
    }
    catch {
        exit (Write-BylBuildProblem -Code 'helper-install' -Values ($problemValues + @{ detail = $_.Exception.Message }))
    }
    $megabytes = [Math]::Round((Get-Item -LiteralPath $target).Length / 1MB, 1)
    Write-Host "Installed app\byl-backup.exe ($megabytes MB)."
    exit 0
}
catch {
    exit (Write-BylBuildError -ErrorRecord $_)
}
