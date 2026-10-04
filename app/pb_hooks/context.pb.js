/// <reference path="../pb_data/types.d.ts" />
// Context of the SPA (KOB-1, ADR-0057): whether the signed-in account is the administrator of the
// app, whether the request comes from this machine and the system of the server. The SPA shows by it
// only what works here: the pages of the administrator, commands and scripts, "Ansehen" of files.
// Signed-in app accounts only (401 without a session); the answer holds the address of the app only
// for the administrator. Handlers run in isolated scopes, so the module is required inside.
routerAdd(
  'GET',
  '/api/byl/context',
  function (e) {
    return require(`${__hooks}/lib/system-service.js`).context(e);
  },
  $apis.requireAuth('users')
);
