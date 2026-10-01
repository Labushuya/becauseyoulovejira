$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'build-functions.ps1')

# Builds the mail helper app\byl-mail.exe (E4 plan package 11, ADR-0016 section 5): a single
# executable application of Node 24 with the bundled helpers\mail. The executable is checked
# without Node (PATH only with the Windows folders): "--version" and a self-test without network.
# app\byl-mail.exe is gitignored like pocketbase.exe. If it is running (the app of the user runs
# from the same folder), the old file is renamed and removed at a later build; the running helper
# keeps working and the next start uses the new file. Problems are entries of the catalog
# app\byl-problems.ps1 (ADR-0048).
#
# Call: powershell -NoProfile -ExecutionPolicy Bypass -File scripts\build-mail-helper.ps1

$rootDir = $BylRepositoryRoot
$helperDir = [System.IO.Path]::Combine($rootDir, 'helpers', 'mail')
$appDir = [System.IO.Path]::Combine($rootDir, 'app')
$built = [System.IO.Path]::Combine($helperDir, 'dist', 'byl-mail.exe')
$target = [System.IO.Path]::Combine($appDir, 'byl-mail.exe')
$problemValues = @{ exe = 'byl-mail.exe'; rerun = 'powershell -NoProfile -ExecutionPolicy Bypass -File "{0}"' -f $PSCommandPath }

function Invoke-WithoutNode {
    # Runs the built executable with an environment that has no Node: PATH only with the Windows
    # folders, no NODE_* variables. Returns ExitCode and Output (stdout and stderr).
    param([Parameter(Mandatory = $true)][string]$Arguments)

    $startInfo = New-Object System.Diagnostics.ProcessStartInfo
    $startInfo.FileName = $built
    $startInfo.Arguments = $Arguments
    $startInfo.UseShellExecute = $false
    $startInfo.CreateNoWindow = $true
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
        [void](Update-BylDependency -Root $rootDir -Folder 'helpers/mail')
        Write-Host 'Building byl-mail.exe...'
        node build.mjs
        if ($LASTEXITCODE -ne 0) {
            exit (Write-BylBuildProblem -Code 'helper-build' -Values ($problemValues + @{ detail = "node build.mjs, Exit-Code $LASTEXITCODE" }))
        }
    }
    finally {
        Pop-Location
    }

    $version = Invoke-WithoutNode -Arguments '--version'
    if ($version.ExitCode -ne 0 -or $version.Output -notmatch '^byl-mail \d+\.\d+\.\d+$') {
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

    # Leftovers of earlier builds that replaced a running helper.
    Get-ChildItem -LiteralPath $appDir -Filter 'byl-mail.exe.old-*' -ErrorAction SilentlyContinue |
        ForEach-Object { Remove-Item -LiteralPath $_.FullName -Force -ErrorAction SilentlyContinue }

    try {
        if (Test-Path -LiteralPath $target -PathType Leaf) {
            try {
                Remove-Item -LiteralPath $target -Force
            }
            catch {
                # A running helper locks its file; Windows still allows renaming it.
                $old = 'byl-mail.exe.old-' + [DateTime]::UtcNow.ToString('yyyyMMddHHmmss')
                Rename-Item -LiteralPath $target -NewName $old
                Write-Host "app\byl-mail.exe is running; the old file is now app\$old. The new version runs after neu-starten.bat." -ForegroundColor Yellow
            }
        }
        Copy-Item -LiteralPath $built -Destination $target
    }
    catch {
        exit (Write-BylBuildProblem -Code 'helper-install' -Values ($problemValues + @{ detail = $_.Exception.Message }))
    }
    $megabytes = [Math]::Round((Get-Item -LiteralPath $target).Length / 1MB, 1)
    Write-Host "Installed app\byl-mail.exe ($megabytes MB)."
    exit 0
}
catch {
    exit (Write-BylBuildError -ErrorRecord $_)
}
