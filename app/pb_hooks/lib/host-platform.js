// Operating system of the server for the guides of the SPA (ADR-0028, plan plattformen S0-2).
// The guides name start.bat, stop.bat and setx; they describe the machine the server runs on, not
// the device with the open tab. Pure module: the route passes BYL_HOST_PLATFORM and the path of the
// running executable ($os.args[0]).

var ENV = 'BYL_HOST_PLATFORM';
var PLATFORMS = ['windows', 'linux', 'container'];

/**
 * "windows", "linux" or "container". A known value of BYL_HOST_PLATFORM wins (the container image
 * of stage S3 sets "container"); otherwise the executable decides: "pocketbase.exe" is Windows,
 * any other name Linux. Without both it stays Windows, the reference platform.
 */
function hostPlatform(value, executable) {
  var named = String(value || '').replace(/^\s+|\s+$/g, '').toLowerCase();
  if (PLATFORMS.indexOf(named) !== -1) return named;
  var path = String(executable || '').replace(/^\s+|\s+$/g, '');
  if (path === '') return 'windows';
  return /\.exe$/i.test(path) ? 'windows' : 'linux';
}

module.exports = {
  ENV: ENV,
  PLATFORMS: PLATFORMS,
  hostPlatform: hostPlatform
};
