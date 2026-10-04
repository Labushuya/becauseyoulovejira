/// <reference path="../pb_data/types.d.ts" />
// Moving records between the areas Privat and Haushalt (E7-4, ADR-0060): a ticket with its sub-tasks,
// a project with its sub projects and tickets, a rule or an entry of the inbox, also several of one
// kind, into the household of the account or into its private area. JSON { kind, ids, to, preview?,
// project?, dependencies?, codes? }; with `preview` nothing changes. For every app account on every
// device (nothing here acts on the machine of the app); the route checks the area and the right for
// every record of the cascade itself. The logic lives in lib/area-move-service.js; handlers run in
// isolated scopes, so the module is required inside them.

routerAdd(
  'POST',
  '/api/byl/area/move',
  function (e) {
    return require(`${__hooks}/lib/area-move-service.js`).move(e);
  },
  $apis.requireAuth('users')
);
