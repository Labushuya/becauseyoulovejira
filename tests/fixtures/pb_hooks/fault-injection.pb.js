/// <reference path="../pb_data/types.d.ts" />
// Test-only fault injection (E1 plan, OF-15). The harness copies this file next to app/pb_hooks
// in every integration test instance, so each hook fires only for a reserved marker title and
// leaves all other records untouched. Never part of the portable app folder.

// Fails a ticket insert after the key was assigned (runs inside the transaction of the ticket
// hook, after validation): the counter must stay unchanged.
onRecordCreateExecute(function (e) {
  if (e.record.getString('title') === '__byl_fail_ticket_insert__') {
    throw new BadRequestError('Injected ticket insert failure.');
  }
  e.next();
}, 'tickets');

// Fails the save of a ticket with the marker title once it gets a recurrence rule (E5 plan,
// package 2): "Wiederholen…" links the ticket after the insert of the rule, in the same
// transaction, so the rule must be rolled back with it.
onRecordUpdateExecute(function (e) {
  if (e.record.getString('title') === '__byl_fail_ticket_link__' && e.record.getString('recurrence') !== '') {
    throw new BadRequestError('Injected ticket link failure.');
  }
  e.next();
}, 'tickets');

// Fails the history entry of a ticket whose (new) title is the marker. The history is written
// in the transaction of the ticket hook, so the lookup sees the uncommitted ticket; the ticket
// change and its key must be rolled back with it.
onRecordCreate(function (e) {
  var found = e.app.findRecordsByFilter('tickets', 'id = {:id}', '', 1, 0, {
    id: e.record.getString('ticket')
  });
  if (found.length > 0 && found[0].getString('title') === '__byl_fail_history__') {
    throw new BadRequestError('Injected history failure.');
  }
  e.next();
}, 'ticket_history');
