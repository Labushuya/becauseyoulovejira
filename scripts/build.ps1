$ErrorActionPreference = 'Stop'

# Verify node is now available
try {
	node --version | Out-Null
} catch {
	Write-Error "Node.js not found. Please ensure it is installed at $nodePath"
	exit 1
}

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
