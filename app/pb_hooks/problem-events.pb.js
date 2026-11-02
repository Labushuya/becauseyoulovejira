/// <reference path="../pb_data/types.d.ts" />
// The error log of the server (FP-2, ADR-0077): unexpected failures of requests, of the channels in
// the background and of other jobs, kept together and for a limited time in problem_events. Only
// lib/problem-service.js writes it; the SPA reads it through the record API, whose list and view
// rules show an entry of the private area only to its owner (also not to the administrator), one of
// a household to its members and one of the app to the administrator. The failures of requests are
// taken in the existing wrapper of every request (static-cache.pb.js), not in one of their own: each
// global JS middleware around e.next() holds a runtime of the JSVM pool for the whole request, also
// for every open realtime connection (ADR-0077, Konsequenzen).

// Entries whose last occurrence is older than 30 days and beyond the newest 5000 go once a day at
// 11:55 UTC, when the app usually runs (and with every new entry); idempotent, so a missed day is
// caught up by the next run. Before the migration it does nothing; it never throws.
cronAdd('byl-problem-events-cleanup', '55 11 * * *', function () {
  try {
    require(`${__hooks}/lib/problem-service.js`).prune($app, Date.now());
  } catch (err) {
    $app.logger().error('byl-problems: Bereinigung des Fehlerprotokolls gescheitert', 'error', String(err));
  }
});
