/// <reference path="../pb_data/types.d.ts" />
// Page "Einstellungen → Speicher" (ADR-0047 §6 to §9, SPE-2): what the app takes, measured when the
// page asks, and the actions "Datenbank verdichten", "Liegengebliebenes aufräumen" and "Verworfene
// jetzt leeren". The checks of the page System (lib/system-service.js: this machine, the address of
// the app, the owner of the instance, rate limit) on every platform; logic in
// lib/storage-service.js. Handlers run in isolated scopes, so modules are required inside them.

routerAdd(
  'GET',
  '/api/byl/storage',
  function (e) {
    return require(`${__hooks}/lib/storage-service.js`).read(e);
  },
  $apis.requireAuth('users')
);

// JSON {} or, for "leftovers", { groups: ['programs' | 'safety' | 'pocketbase', ...] }.
routerAdd(
  'POST',
  '/api/byl/storage/actions/{action}',
  function (e) {
    return require(`${__hooks}/lib/storage-service.js`).act(e, e.request.pathValue('action'));
  },
  $apis.requireAuth('users')
);
