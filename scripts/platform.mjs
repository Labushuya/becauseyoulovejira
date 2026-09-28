// Names of the executables per operating system (ADR-0028, plan plattformen S0): Windows needs the
// ending ".exe", Linux and macOS use the bare name. Used by the fetch and build scripts and by the
// test harness, so no script assumes Windows.

/**
 * File name of an executable on `platform`.
 * @param {string} base name without ending, e.g. "pocketbase" or "byl-mail"
 * @param {NodeJS.Platform} [platform]
 */
export function executableName(base, platform = process.platform) {
	return platform === 'win32' ? `${base}.exe` : base;
}
