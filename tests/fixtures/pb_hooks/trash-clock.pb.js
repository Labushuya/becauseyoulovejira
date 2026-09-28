/// <reference path="../pb_data/types.d.ts" />
// Test-only route for the trash (ADR-0037, package PB-1). The harness copies this file next to
// app/pb_hooks in every integration test instance; it is never part of the portable app folder.
// Superusers only.

// The daily run of the trash with a given clock: purgeDue with `now` (ms since the epoch) instead
// of the time of the machine. Answers the counts.
routerAdd(
  'POST',
  '/api/byl-test/trash/run',
  function (e) {
    var now = Number(e.requestInfo().body['now']);
    if (!isFinite(now)) {
      throw new BadRequestError('now fehlt');
    }
    return e.json(200, require(`${__hooks}/lib/trash-service.js`).purgeDue(e.app, now));
  },
  $apis.requireSuperuserAuth()
);
