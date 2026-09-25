/// <reference path="../pb_data/types.d.ts" />
// Test-only routes and probes for recurring tasks (E5 plan, packages 2 and 3; ADR-0022). The
// harness copies this file next to app/pb_hooks in every integration test instance; it is never
// part of the portable app folder. Routes for superusers only.

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

// The cron job with a given clock (package 3): runDue with `now` (ms since the epoch) instead of
// the time of the machine. Answers the counts.
routerAdd(
  'POST',
  '/api/byl-test/recurrence/run',
  function (e) {
    var now = Number(e.requestInfo().body['now']);
    if (!isFinite(now)) {
      throw new BadRequestError('now fehlt');
    }
    return e.json(200, require(`${__hooks}/lib/recurrence-service.js`).runDue(e.app, now));
  },
  $apis.requireSuperuserAuth()
);

// When the start hook sees the migrated schema (package 3, T-10): onBootstrap notes after
// e.next() whether recurrence_rules has its E5 fields and whether the command is `serve`;
// GET /api/byl-test/startup answers the notes and the state at the time of the request.
onBootstrap(function (e) {
  e.next();
  e.app.store().set('byl-test-bootstrap-schema', require(`${__hooks}/lib/recurrence-service.js`).schemaReady(e.app));
  e.app.store().set('byl-test-bootstrap-serve', $os.args.indexOf('serve') !== -1);
});

routerAdd(
  'GET',
  '/api/byl-test/startup',
  function (e) {
    return e.json(200, {
      bootstrap: e.app.store().get('byl-test-bootstrap-schema'),
      serve: e.app.store().get('byl-test-bootstrap-serve'),
      request: require(`${__hooks}/lib/recurrence-service.js`).schemaReady(e.app)
    });
  },
  $apis.requireSuperuserAuth()
);
