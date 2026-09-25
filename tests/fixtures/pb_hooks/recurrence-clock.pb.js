/// <reference path="../pb_data/types.d.ts" />
// Test-only routes for recurring tasks (E5 plan, packages 2 and 3; ADR-0022, consequences). The
// harness copies this file next to app/pb_hooks in every integration test instance; it is never
// part of the portable app folder. Superusers only.

// Links a ticket to a rule with a plain server-side save, past the request hooks that keep
// clients from setting tickets.recurrence: the unique partial index idx_tickets_open_recurrence
// is the only thing that can stop a second open instance here. Answers 200 or 400 with the error.
routerAdd(
  'POST',
  '/api/byl-test/tickets/{id}/link',
  function (e) {
    var ticket = e.app.findRecordById('tickets', e.request.pathValue('id'));
    ticket.set('recurrence', String(e.requestInfo().body['rule'] || ''));
    try {
      e.app.save(ticket);
    } catch (err) {
      return e.json(400, { error: String(err) });
    }
    return e.json(200, { id: ticket.id, recurrence: ticket.getString('recurrence') });
  },
  $apis.requireSuperuserAuth()
);
