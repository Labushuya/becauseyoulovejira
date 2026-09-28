/// <reference path="../pb_data/types.d.ts" />
// Operating system of the server (ADR-0028, plan plattformen S0-2): the SPA picks its guides
// (setx and start.bat on Windows, the environment of the server elsewhere) by it. Signed-in app
// users only; the answer holds nothing but the platform. Handlers run in isolated scopes, so the
// module is required inside.

routerAdd(
  'GET',
  '/api/byl/host',
  function (e) {
    var host = require(`${__hooks}/lib/host-platform.js`);
    var args = $os.args || [];
    return e.json(200, { platform: host.hostPlatform($os.getenv(host.ENV), args.length > 0 ? args[0] : '') });
  },
  $apis.requireAuth('users')
);
