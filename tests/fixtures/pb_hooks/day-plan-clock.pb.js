/// <reference path="../pb_data/types.d.ts" />
// Test-only clock of the day plan (TP-1, ADR-0065). The harness copies this file next to app/pb_hooks
// in every integration test instance; it is never part of the portable app folder. Superusers only.

// Sets the time the routes of the day plan read instead of the time of the machine: `now` in ms since
// the epoch; null goes back to the time of the machine. lib/day-plan-service.js reads it only in an
// instance with the mark of the test mode (test-mode.pb.js), so in the app it changes nothing.
routerAdd(
  'POST',
  '/api/byl-test/dayplan/clock',
  function (e) {
    var key = require(`${__hooks}/lib/day-plan-service.js`).TEST_NOW_KEY;
    var now = e.requestInfo().body['now'];
    if (now === null || now === undefined) {
      e.app.store().remove(key);
      return e.json(200, { now: null });
    }
    var ms = Number(now);
    if (!isFinite(ms)) {
      throw new BadRequestError('now fehlt');
    }
    e.app.store().set(key, ms);
    return e.json(200, { now: ms });
  },
  $apis.requireSuperuserAuth()
);
