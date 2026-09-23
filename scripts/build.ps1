$ErrorActionPreference = 'Stop'

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
	# Install root dependencies if node_modules missing
	if (-not (Test-Path 'node_modules')) {
		Write-Host "Installing root dependencies..."
		npm ci
		if ($LASTEXITCODE -ne 0) { exit 1 }
	}

	# Install web dependencies if node_modules missing
	if (-not (Test-Path 'web/node_modules')) {
		Write-Host "Installing web dependencies..."
		npm --prefix web ci
		if ($LASTEXITCODE -ne 0) { exit 1 }
	}

	# Run check
	Write-Host "Running check..."
	npm run check
	if ($LASTEXITCODE -ne 0) { exit 1 }

	# Run lint
	Write-Host "Running lint..."
	npm run lint
	if ($LASTEXITCODE -ne 0) { exit 1 }

	# Run tests
	Write-Host "Running tests..."
	npm test
	if ($LASTEXITCODE -ne 0) { exit 1 }

	# Run build
	Write-Host "Running build..."
	npm run build
	if ($LASTEXITCODE -ne 0) { exit 1 }

	Write-Host "Build complete!"
	exit 0
} finally {
	Pop-Location
}
