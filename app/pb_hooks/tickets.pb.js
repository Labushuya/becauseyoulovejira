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
// The fields of the trash belong to the server (ADR-0037, lib/trash-service.js).
onRecordCreateRequest(function (e) {
  require(`${__hooks}/lib/recurrence-service.js`).guardTicketCreate(e);
  require(`${__hooks}/lib/trash-service.js`).guardTrashFields(e, true);
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
  require(`${__hooks}/lib/trash-service.js`).guardTrashFields(e, false);
  service.rememberActor(e);
  service.rememberExpectedUpdated(e);
  service.rememberCompletion(e);
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
// A change sent with `expected_updated` (ADR-0032 section 6) is refused first if the ticket
// changed meanwhile. Completing a ticket with open blocking sub-tickets (ADR-0033 section 2) needs
// `force` or `complete_children`; the latter completes them in the same transaction.
// Writes of the trash and internal saves of a ticket in the trash (ADR-0037) skip all of this.
onRecordUpdate(function (e) {
  if (require(`${__hooks}/lib/trash-service.js`).skipsTicketHooks(e.record)) {
    e.next();
    return;
  }
  var service = require(`${__hooks}/lib/ticket-service.js`);
  var recurrence = require(`${__hooks}/lib/recurrence-service.js`);
  require(`${__hooks}/lib/transaction.js`).inTransaction(e, function (txApp) {
    service.checkExpectedUpdated(txApp, e.record);
    var before = service.prepareUpdate(txApp, e.record);
    var children = service.prepareCompletion(txApp, e.record);
    recurrence.prepareTicketUpdate(txApp, e.record, Date.now());
    e.next();
    service.recordChanges(txApp, e.record, before);
    service.completeChildren(txApp, e.record, children);
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

// Since the trash (ADR-0037) every delete through the Record API moves the ticket to the trash
// (lib/trash-service.js answers 204 itself); before its migration it deletes as before.
onRecordDeleteRequest(function (e) {
  var trash = require(`${__hooks}/lib/trash-service.js`);
  if (!trash.trashReady(e.app)) {
    e.next();
    return;
  }
  return trash.deleteRequest(e);
}, 'tickets');

// Deleting the open instance of a series (ADR-0023 section 6): a calendar date counts as skipped,
// an after-completion rule waits as if the instance was done today. The sources of the ticket go
// back to the inbox or are discarded in the same transaction, never deleted and never left as
// converted items without a ticket (ADR-0031, addendum B). Every way to delete gives them back to
// the inbox unless the route below asks to discard them. Since the trash this runs when a ticket
// is deleted for good (the trash cleared its series already), and since ADR-0047 only for a group
// without bound sources, so there is nothing to settle then.
onRecordDelete(function (e) {
  var recurrence = require(`${__hooks}/lib/recurrence-service.js`);
  var inbox = require(`${__hooks}/lib/inbox-service.js`);
  require(`${__hooks}/lib/transaction.js`).inTransaction(e, function (txApp) {
    recurrence.prepareTicketDelete(txApp, e.record, Date.now());
    var sources = inbox.sourcesOfDeletedTicket(txApp, e.record);
    e.next();
    var handling = e.record.get(inbox.SOURCE_HANDLING_KEY);
    inbox.settleSourcesOfDeletedTicket(txApp, sources, handling ? String(handling) : '', e.record.getString('key'));
  });
}, 'tickets');

// "Ticket löschen mit Quellenbehandlung" (ADR-0031, addendum B): JSON { sources: 'inbox' |
// 'discard' }; moves a ticket the request may delete (deleteRule, else 404) to the trash with its
// sub-tickets and settles its sources as chosen (ADR-0037). Answers 200 { id, updated, tickets }
// for "Rückgängig"; before the migration of the trash it deletes as before and answers 204.
routerAdd(
  'POST',
  '/api/byl/tickets/{id}/delete',
  function (e) {
    var moved = require(`${__hooks}/lib/ticket-service.js`).deleteWithSources(e, e.request.pathValue('id'));
    return moved ? e.json(200, moved) : e.noContent(204);
  },
  $apis.requireAuth('users')
);

// "Ticket duplizieren" (ADR-0045): JSON with the title, the required status, the project and what
// to take over (description, priority, tags, due, parent, sub-tickets, comments) and whether the
// main source is copied ({ source: 'none' | 'copy' }). Creates the duplicate with everything
// chosen in one transaction, or nothing; only for a ticket the request may see (else 404, the
// trash included) in an area where the user may create tickets (else 403).
routerAdd(
  'POST',
  '/api/byl/tickets/{id}/duplicate',
  function (e) {
    var result = require(`${__hooks}/lib/duplicate-service.js`).duplicate(e, e.request.pathValue('id'));
    return e.json(200, result);
  },
  $apis.requireAuth('users')
);
