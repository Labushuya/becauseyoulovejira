/// <reference path="../pb_data/types.d.ts" />
// Access data of the channels set from the browser (BW-3, ADR-0075): the BYL_* variables in the
// Windows user environment (ADR-0018), set and removed through fixed commands of byl-control.ps1.
// Signed-in app users only; lib/credential-service.js checks the rest like the page System
// (Windows, this machine, the address of the app, the administrator of the app, rate limit, the own
// instance) and which names may be set. A value comes only in the body of a POST and never goes
// back. Handlers run in isolated scopes, so the module is required inside them.

// The state of the variables of the connections (and of the names of a setup, ?names=A,B): per name
// only "set" or not, the connections that use it, and whether a change waits for a restart.
routerAdd(
  'GET',
  '/api/byl/credentials',
  function (e) {
    return require(`${__hooks}/lib/credential-service.js`).status(e);
  },
  $apis.requireAuth('users')
);

// "Setzen" and "Ersetzen": JSON { name, value }; the value goes only to the standard input of the
// control script.
routerAdd(
  'POST',
  '/api/byl/credentials/set',
  function (e) {
    return require(`${__hooks}/lib/credential-service.js`).set(e);
  },
  $apis.requireAuth('users')
);

// "Entfernen": JSON { name }.
routerAdd(
  'POST',
  '/api/byl/credentials/remove',
  function (e) {
    return require(`${__hooks}/lib/credential-service.js`).remove(e);
  },
  $apis.requireAuth('users')
);

// The hint "Neustart nötig, damit geänderte Zugangsdaten wirken": yes or no, for the administrator
// on every device; the mark lives in the memory of the server and goes with the next restart.
routerAdd(
  'GET',
  '/api/byl/credentials/restart-notice',
  function (e) {
    return require(`${__hooks}/lib/credential-service.js`).notice(e);
  },
  $apis.requireAuth('users')
);
