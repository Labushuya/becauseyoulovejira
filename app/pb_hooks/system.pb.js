/// <reference path="../pb_data/types.d.ts" />
// Page "Einstellungen → System" (ADR-0043): operation of the app from the dashboard through fixed
// commands of byl-control.ps1 (ADR-0039). Signed-in app users only; lib/system-service.js checks
// the rest (Windows, this machine, the address of the app, the administrator of the app, rate limit,
// the own instance). Handlers run in isolated scopes, so the module is required inside them.

// Status of the app: state, address, mail helper, start fingerprint, autostart, other copies.
routerAdd(
  'GET',
  '/api/byl/system',
  function (e) {
    return require(`${__hooks}/lib/system-service.js`).read(e, 'status');
  },
  $apis.requireAuth('users')
);

// "Umgebung prüfen": the checks of doctor.
routerAdd(
  'GET',
  '/api/byl/system/doctor',
  function (e) {
    return require(`${__hooks}/lib/system-service.js`).read(e, 'doctor');
  },
  $apis.requireAuth('users')
);

// "Logs ansehen": the last lines of the server, mail helper and script logs, without secrets.
routerAdd(
  'GET',
  '/api/byl/system/logs',
  function (e) {
    return require(`${__hooks}/lib/system-service.js`).read(e, 'logs');
  },
  $apis.requireAuth('users')
);

// Actions of the whitelist: restart (detached), mail-restart, autostart-on, autostart-off.
routerAdd(
  'POST',
  '/api/byl/system/actions/{action}',
  function (e) {
    return require(`${__hooks}/lib/system-service.js`).act(e, e.request.pathValue('action'));
  },
  $apis.requireAuth('users')
);
