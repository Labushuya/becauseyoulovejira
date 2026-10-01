$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'build-functions.ps1')

# Node.js is a dev tool only (CLAUDE.md section 3). It must be reachable via PATH;
# this script does not assume any install location.
$requiredNodeMajor = 24
$node = Get-Command node -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $node) {
	Write-Host "Node.js was not found in PATH." -ForegroundColor Red
	Write-Host "Install Node.js $requiredNodeMajor or newer, or put the folder containing node.exe in front of PATH, e.g.:"
	Write-Host '  $env:Path = "<folder with node.exe>;$env:Path"'
	exit 1
}
$nodeVersion = (& $node.Source --version | Out-String).Trim()
if ($LASTEXITCODE -ne 0 -or $nodeVersion -notmatch '^v(\d+)\.') {
	Write-Host "Could not determine the Node.js version of $($node.Source)." -ForegroundColor Red
	exit 1
}
if ([int]$Matches[1] -lt $requiredNodeMajor) {
	Write-Host "Node.js $nodeVersion at $($node.Source) is too old; version $requiredNodeMajor or newer is required." -ForegroundColor Red
	exit 1
}
if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
	Write-Host "npm was not found in PATH (expected next to $($node.Source))." -ForegroundColor Red
	exit 1
}
Write-Host "Using Node.js $nodeVersion ($($node.Source))"

# Root directory
$rootDir = Split-Path -Parent $PSScriptRoot
Push-Location $rootDir

try {
	# Dependencies of the root, the web app, the mail helper (E4 plan, package 11), the backup helper
	# (ADR-0046) and the browser extension for WhatsApp Web (ADR-0038): "npm ci" wherever
	# node_modules is missing or does not match the package-lock.json of the folder any more (an
	# update of a dependency or a merge of main), so the build never tests the versions of an older
	# lockfile (ADR-0040, addendum "Build und Abhaengigkeiten"; scripts\build-functions.ps1).
	foreach ($folder in $BylDependencyFolders) {
		try {
			[void](Update-BylDependency -Root $rootDir -Folder $folder)
		}
		catch {
			Write-Host $_.Exception.Message -ForegroundColor Red
			exit 1
		}
	}

	# Run check (web app, mail helper, backup helper and extension)
	Write-Host "Running check..."
	npm run check
	if ($LASTEXITCODE -ne 0) { exit 1 }

	# Run lint
	Write-Host "Running lint..."
	npm run lint
	if ($LASTEXITCODE -ne 0) { exit 1 }

	# Run build (before the tests: the SPA fallback test serves app/pb_public). The web app goes to
	# web/build and scripts/publish-web.mjs moves it into app/pb_public without a gap, so open tabs
	# of a running instance keep working (ADR-0040); the extension goes to app/erweiterung-whatsapp-web
	Write-Host "Running build..."
	npm run build
	if ($LASTEXITCODE -ne 0) { exit 1 }

	# Build the mail helper app/byl-mail.exe and check it without Node (before the tests: they run it)
	Write-Host "Building mail helper..."
	& powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'build-mail-helper.ps1')
	if ($LASTEXITCODE -ne 0) { exit 1 }

	# Build the backup helper app/byl-backup.exe and check it without Node (ADR-0046; the tests run it)
	Write-Host "Building backup helper..."
	& powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'build-backup-helper.ps1')
	if ($LASTEXITCODE -ne 0) { exit 1 }

	# Run tests (root unit, helper and integration tests, then the web and extension tests)
	Write-Host "Running tests..."
	npm test
	if ($LASTEXITCODE -ne 0) { exit 1 }

	Write-Host "Build complete!"
	exit 0
} finally {
	Pop-Location
}
