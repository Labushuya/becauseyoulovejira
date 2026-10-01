/// <reference path="../pb_data/types.d.ts" />
// Trash for tickets (ADR-0037, docs/plan/papierkorb.md). The API rules hide tickets in the trash
// everywhere (migration 1790202300); the trash view reads and changes them only through these
// routes, which check the visibility of the ticket without the trash condition
// (trash-service VISIBLE_RULE). Logic in lib/trash-service.js; handlers run in isolated scopes,
// so modules are required inside them. Before the migration every route answers 503.

// { items: [summary], retention } of the signed-in user, newest first; groups by their first
// ticket only.
routerAdd(
  'GET',
  '/api/byl/trash',
  function (e) {
    var service = require(`${__hooks}/lib/trash-service.js`);
    service.assertReady(e.app);
    return e.json(200, service.list(e));
  },
  $apis.requireAuth('users')
);

// Read-only preview of one ticket of the trash.
routerAdd(
  'GET',
  '/api/byl/trash/{id}',
  function (e) {
    var service = require(`${__hooks}/lib/trash-service.js`);
    service.assertReady(e.app);
    return e.json(200, service.preview(e, e.request.pathValue('id')));
  },
  $apis.requireAuth('users')
);

// "Wiederherstellen" and "Rückgängig": JSON { expected_updated?, project?, detach_series?,
// detach_parent? } (detach_parent: a sub-task of a group alone, ADR-0047).
routerAdd(
  'POST',
  '/api/byl/trash/{id}/restore',
  function (e) {
    var service = require(`${__hooks}/lib/trash-service.js`);
    service.assertReady(e.app);
    return e.json(200, service.restore(e, e.request.pathValue('id')));
  },
  $apis.requireAuth('users')
);

// Decision help (ADR-0047): JSON { actions: [...] } for the dependencies of a group; answers the
// preview afterwards.
routerAdd(
  'POST',
  '/api/byl/trash/{id}/resolve',
  function (e) {
    var service = require(`${__hooks}/lib/trash-service.js`);
    service.assertReady(e.app);
    return e.json(200, service.resolve(e, e.request.pathValue('id')));
  },
  $apis.requireAuth('users')
);

// "Endgültig löschen" of one ticket with its sub-tickets; 400 validation_trash_blocked with the
// dependencies while the group is blocked (ADR-0047).
routerAdd(
  'POST',
  '/api/byl/trash/{id}/purge',
  function (e) {
    var service = require(`${__hooks}/lib/trash-service.js`);
    service.assertReady(e.app);
    service.purge(e, e.request.pathValue('id'));
    return e.noContent(204);
  },
  $apis.requireAuth('users')
);

// "Papierkorb leeren": { purged, blocked } (number of tickets, sub-tickets included; the blocked
// groups that stay, [{ id, key, count }], ADR-0047).
routerAdd(
  'POST',
  '/api/byl/trash/empty',
  function (e) {
    var service = require(`${__hooks}/lib/trash-service.js`);
    service.assertReady(e.app);
    return e.json(200, service.empty(e));
  },
  $apis.requireAuth('users')
);

// Daily at 11:45 UTC, after the cleanup of the inbox, when the app usually runs (ADR-0037 §8);
// the start catches up (recurrence-service runStartup). Blocked groups stay (ADR-0047).
// Idempotent, never throws.
cronAdd('byl-trash-purge', '45 11 * * *', function () {
  try {
    require(`${__hooks}/lib/trash-service.js`).purgeDue($app, Date.now());
  } catch (err) {
    $app.logger().error('Papierkorb: Cron-Lauf gescheitert', 'error', String(err));
  }
});
