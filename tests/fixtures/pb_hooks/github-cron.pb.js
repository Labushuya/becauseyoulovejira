/// <reference path="../pb_data/types.d.ts" />
// Test-only route for the cron of the GitHub channel (ADR-0050). The harness copies this file next
// to app/pb_hooks in every integration test instance; it is never part of the portable app folder.
// In the test mode the cron job "byl-github" itself does nothing (app/pb_hooks/github.pb.js), so
// no run starts in the middle of a test; this route runs the same function with a given clock.
// Superusers only.
routerAdd(
  'POST',
  '/api/byl-test/github/cron',
  function (e) {
    var now = Number(e.requestInfo().body['now']);
    if (!isFinite(now)) {
      throw new BadRequestError('now fehlt');
    }
    return e.json(200, { runs: require(`${__hooks}/lib/github-service.js`).runDue(e.app, now) });
  },
  $apis.requireSuperuserAuth()
);
