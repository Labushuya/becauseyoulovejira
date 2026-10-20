/// <reference path="../pb_data/types.d.ts" />
// The notes of the outbox of the SPA (OF-1, ADR-0074): client_ops is written only by the hooks of
// tickets, comments, the inbox and the day plan (lib/client-ops.js) and read by nobody else; its API
// rules are null.

// Notes older than 30 days go once a day at 11:50 UTC, after the cleanup of the inbox and the trash,
// when the app usually runs; idempotent, so a missed day is caught up by the next run. The SPA gives
// an action up after 7 days, so the server never forgets one it may still receive. Before the
// migration it does nothing; it never throws.
cronAdd('byl-client-ops-cleanup', '50 11 * * *', function () {
  try {
    require(`${__hooks}/lib/client-ops.js`).cleanup($app, Date.now());
  } catch (err) {
    $app.logger().error('Postausgang: Bereinigung der Kennungen gescheitert', 'error', String(err));
  }
});
