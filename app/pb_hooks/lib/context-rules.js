// The context of a signed-in request for the SPA (KOB-1, ADR-0057): whether the account is the
// administrator of the app, whether the request comes from this machine, the system of the server
// and, from these, whether the scripts of the folder app are in reach. The server stays the one that
// decides on every route; the SPA only leaves out what a route would refuse. CommonJS module, ES5
// only, no dependencies (Goja runtime and Vitest load it the same way); the route lives in
// context.pb.js with lib/system-service.js.
'use strict';

// The systems of lib/host-platform.js (parity test).
var PLATFORMS = ['windows', 'linux', 'container'];
// PocketBase listens here unless --http says otherwise (lib/system-rules.js DEFAULT_PORT).
var DEFAULT_PORT = 8090;

/**
 * The answer of GET /api/byl/context from what the route found out: `admin` (an active
 * administrator), `local` (the connection comes from this machine), `platform` (a value of
 * PLATFORMS) and `port` (of --http). `scripts` only for the administrator on this machine of a
 * server under Windows; `localUrl` (the address of the app on this machine) only for the
 * administrator, null for every other account.
 */
function contextView(input) {
  var source = input !== null && typeof input === 'object' ? input : {};
  var admin = source.admin === true;
  var local = source.local === true;
  var platform = PLATFORMS.indexOf(source.platform) !== -1 ? source.platform : 'windows';
  var port =
    typeof source.port === 'number' && Math.floor(source.port) === source.port && source.port >= 1 && source.port <= 65535
      ? source.port
      : DEFAULT_PORT;
  return {
    admin: admin,
    local: local,
    platform: platform,
    scripts: admin && local && platform === 'windows',
    localUrl: admin ? 'http://127.0.0.1:' + port : null
  };
}

module.exports = {
  PLATFORMS: PLATFORMS,
  DEFAULT_PORT: DEFAULT_PORT,
  contextView: contextView
};
