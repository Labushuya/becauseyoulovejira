param(
	# Skips only the test runs (root, web, extension): check, lint, build, the publishing to
	# app\pb_public without a gap (ADR-0040) and the helpers run as always. Only on a clean working
	# tree whose HEAD is a commit of origin/main, a state the CI tested (Get-BylSkipTestsProblem): the
	# fast build of the live folder after a merge (CLAUDE.md section 11.6).
	[switch]$SkipTests
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'build-functions.ps1')

# Build of the repository: dependencies, check, lint, build, the helpers and the tests. Every problem
# is an entry of the catalog app\byl-problems.ps1 with cause, steps and a command with the paths of
# this repository (Write-BylBuildProblem, ADR-0048); the output above it is its detail.
#
# Node.js is a dev tool only (CLAUDE.md section 3). It must be reachable via PATH; this script does
# not assume an install location (Find-BylNodeFolder only suggests one in the problem).

# Root directory
$rootDir = $BylRepositoryRoot

function Invoke-BylBuildStep {
	# Runs one step ($Run, a native command) and ends the build with the entry build-step when it
	# fails; $Rerun is the command that repeats the step alone.
	param([Parameter(Mandatory = $true)][string]$Name, [Parameter(Mandatory = $true)][string]$Rerun, [Parameter(Mandatory = $true)][scriptblock]$Run)

	& $Run
	if ($LASTEXITCODE -ne 0) {
		exit (Write-BylBuildProblem -Code 'build-step' -Values @{ step = $Name; code = $LASTEXITCODE; rerun = $Rerun })
	}
}

try {
	# -SkipTests: the state is checked first, before anything is installed or built
	if ($SkipTests) {
		$refused = Get-BylSkipTestsProblem -Root $rootDir
		if ($null -ne $refused) {
			exit (Write-BylBuildProblem -Code $refused.Code -Values $refused.Values -Facts $refused.Facts)
		}
		Write-Host "Skipping the tests (-SkipTests): clean working tree, HEAD is a commit of origin/main."
	}

	$node = Assert-BylNode
	if ($node -is [int]) { exit $node }
	Write-Host "Using Node.js $((& $node.Source --version | Out-String).Trim()) ($($node.Source))"

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
				exit (Write-BylBuildError -ErrorRecord $_)
			}
		}

		$npm = 'npm --prefix "{0}" run {1}'
		$helper = 'powershell -NoProfile -ExecutionPolicy Bypass -File "{0}"'

		# Run check (web app, mail helper, backup helper and extension)
		Write-Host "Running check..."
		Invoke-BylBuildStep -Name 'npm run check' -Rerun ($npm -f $rootDir, 'check') -Run { npm run check }

		# Run lint
		Write-Host "Running lint..."
		Invoke-BylBuildStep -Name 'npm run lint' -Rerun ($npm -f $rootDir, 'lint') -Run { npm run lint }

		# Run build (before the tests: the SPA fallback test serves app/pb_public). The web app goes to
		# web/build and scripts/publish-web.mjs moves it into app/pb_public without a gap, so open tabs
		# of a running instance keep working (ADR-0040); the extension goes to app/erweiterung-whatsapp-web
		Write-Host "Running build..."
		Invoke-BylBuildStep -Name 'npm run build' -Rerun ($npm -f $rootDir, 'build') -Run { npm run build }

		# Build the mail helper app/byl-mail.exe and check it without Node (before the tests: they run it)
		Write-Host "Building mail helper..."
		$mailHelper = Join-Path $PSScriptRoot 'build-mail-helper.ps1'
		Invoke-BylBuildStep -Name 'build-mail-helper.ps1' -Rerun ($helper -f $mailHelper) -Run {
			& powershell -NoProfile -ExecutionPolicy Bypass -File $mailHelper
		}

		# Build the backup helper app/byl-backup.exe and check it without Node (ADR-0046; the tests run it)
		Write-Host "Building backup helper..."
		$backupHelper = Join-Path $PSScriptRoot 'build-backup-helper.ps1'
		Invoke-BylBuildStep -Name 'build-backup-helper.ps1' -Rerun ($helper -f $backupHelper) -Run {
			& powershell -NoProfile -ExecutionPolicy Bypass -File $backupHelper
		}

		# Run tests (root unit, helper and integration tests, then the web and extension tests); with
		# -SkipTests only the hint build-tests-skipped of the catalog
		if ($SkipTests) {
			[void](Write-BylBuildProblem -Code 'build-tests-skipped')
		}
		else {
			Write-Host "Running tests..."
			Invoke-BylBuildStep -Name 'npm test' -Rerun ($npm -f $rootDir, 'test') -Run { npm test }
		}

		Write-Host "Build complete!"
		exit 0
	}
	finally {
		Pop-Location
	}
}
catch {
	exit (Write-BylBuildError -ErrorRecord $_)
}
