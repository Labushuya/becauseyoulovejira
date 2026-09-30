/// <reference path="../pb_data/types.d.ts" />
// Comment hooks (ADR-0044 section 2). Visibility and "only the author" are API rules (CLAUDE.md
// section 5); these hooks only keep the pinned comment of the ticket right. Deleting the pinned
// comment releases the pin in the same transaction, named after the user who deleted it: the
// ticket hooks write the history entry ("Anpinnen gelöst") and every tab gets the ticket by
// realtime. Before the migration of the pin the ticket has no such field and nothing happens.

// Request hook: remembers the acting user for the history of the ticket (like tickets.pb.js).
onRecordDeleteRequest(function (e) {
  require(`${__hooks}/lib/ticket-service.js`).rememberActor(e);
  e.next();
}, 'comments');

// Model hook: every way to delete a comment, also the admin UI. When a ticket is deleted for good,
// PocketBase removes the ticket row before its comments; the ticket is then gone and nothing is
// left to release.
onRecordDelete(function (e) {
  var service = require(`${__hooks}/lib/ticket-service.js`);
  require(`${__hooks}/lib/transaction.js`).inTransaction(e, function (txApp) {
    service.releasePinOf(txApp, e.record);
    e.next();
  });
}, 'comments');
