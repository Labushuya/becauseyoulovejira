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

// Recurring tasks (ADR-0022 section 4, ADR-0023 sections 2, 3 and 6; E5 plan package 3): in the
// same transaction, completing an instance fixes the next date of an after-completion rule,
// reopening one removes an untouched follow-up (or is refused), and releasing an open instance
// works like deleting it. The next ticket follows after the commit, so completing never fails
// because of the generation. Before the E5 migrations lib/recurrence-service.js does nothing.
onRecordUpdate(function (e) {
  var service = require(`${__hooks}/lib/ticket-service.js`);
  var recurrence = require(`${__hooks}/lib/recurrence-service.js`);
  require(`${__hooks}/lib/transaction.js`).inTransaction(e, function (txApp) {
    var before = service.prepareUpdate(txApp, e.record);
    recurrence.prepareTicketUpdate(txApp, e.record, Date.now());
    e.next();
    service.recordChanges(txApp, e.record, before);
  });
}, 'tickets');

onRecordAfterUpdateSuccess(function (e) {
  e.next();
  try {
    require(`${__hooks}/lib/recurrence-service.js`).afterTicketUpdate(e.app, e.record, Date.now());
  } catch (err) {
    e.app.logger().warn('Wiederholung: Folgeticket nicht erzeugt', 'ticket', e.record.id, 'error', String(err));
  }
}, 'tickets');

// Deleting the open instance of a series (ADR-0023 section 6): a calendar date counts as skipped,
// an after-completion rule waits as if the instance was done today.
onRecordDelete(function (e) {
  var recurrence = require(`${__hooks}/lib/recurrence-service.js`);
  require(`${__hooks}/lib/transaction.js`).inTransaction(e, function (txApp) {
    recurrence.prepareTicketDelete(txApp, e.record, Date.now());
    e.next();
  });
}, 'tickets');
