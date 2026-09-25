/// <reference path="../pb_data/types.d.ts" />
// Ticket hooks (CLAUDE.md sections 3 and 5, E1 plan packages 5 and 6). The logic lives in
// lib/ticket-service.js; handlers run in isolated scopes, so modules are required inside them.
// Create and update through the Record API are not transactional in PocketBase 0.40.4, hence
// each model hook runs in its own transaction (lib/transaction.js, OF-1): key, ticket and
// history entries (and the converted inbox item, ADR-0014 section 2) are written together or not
// at all.

// Request hooks: remember the acting user for the history (OF-4, variant A). blocks_parent
// defaults to true unless the client sends the field (OF-11); bool fields have no schema default
// and the model hook cannot tell "false" from "not sent". A client never sets `recurrence`, it
// may only clear it (ADR-0023 section 1; lib/recurrence-service.js, only after the E5 migrations).
onRecordCreateRequest(function (e) {
  require(`${__hooks}/lib/recurrence-service.js`).guardTicketCreate(e);
  require(`${__hooks}/lib/ticket-service.js`).rememberActor(e);
  if (e.requestInfo().body['blocks_parent'] === undefined) {
    e.record.set('blocks_parent', true);
  }
  e.next();
}, 'tickets');

onRecordUpdateRequest(function (e) {
  var service = require(`${__hooks}/lib/ticket-service.js`);
  service.guardSourceChange(e.record);
  require(`${__hooks}/lib/recurrence-service.js`).guardTicketUpdate(e);
  service.rememberActor(e);
  e.next();
}, 'tickets');

onRecordCreate(function (e) {
  var service = require(`${__hooks}/lib/ticket-service.js`);
  require(`${__hooks}/lib/transaction.js`).inTransaction(e, function (txApp) {
    var item = service.prepareCreate(txApp, e.record);
    e.next();
    service.recordCreation(txApp, e.record, item);
  });
}, 'tickets');

onRecordUpdate(function (e) {
  var service = require(`${__hooks}/lib/ticket-service.js`);
  require(`${__hooks}/lib/transaction.js`).inTransaction(e, function (txApp) {
    var before = service.prepareUpdate(txApp, e.record);
    e.next();
    service.recordChanges(txApp, e.record, before);
  });
}, 'tickets');
