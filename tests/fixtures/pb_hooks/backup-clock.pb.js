/// <reference path="../pb_data/types.d.ts" />
// Test-only routes for the backups (ADR-0046). The harness copies this file next to app/pb_hooks in
// every integration test instance, tests/integration/backup-control.test.mjs into its disposable
// copy of the app folder; it is never part of the portable app folder. Superusers only.

// One run of the backups with a given clock: runOnce with `now` (ms since the epoch) instead of
// the time of the machine; `force` like "Jetzt sichern". Answers the summary.
routerAdd(
  'POST',
  '/api/byl-test/backup/run',
  function (e) {
    var body = e.requestInfo().body;
    var now = Number(body['now']);
    if (!isFinite(now)) {
      throw new BadRequestError('now fehlt');
    }
    return e.json(200, require(`${__hooks}/lib/backup-service.js`).runOnce(e.app, now, body['force'] === true));
  },
  $apis.requireSuperuserAuth()
);

// The cron of the backups with a given clock; answers { result } (null: nothing ran, e.g. in the
// test mode of the harness).
routerAdd(
  'POST',
  '/api/byl-test/backup/tick',
  function (e) {
    var now = Number(e.requestInfo().body['now']);
    if (!isFinite(now)) {
      throw new BadRequestError('now fehlt');
    }
    return e.json(200, { result: require(`${__hooks}/lib/backup-service.js`).tick(e.app, now) });
  },
  $apis.requireSuperuserAuth()
);
