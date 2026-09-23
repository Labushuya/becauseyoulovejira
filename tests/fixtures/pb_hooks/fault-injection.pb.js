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
