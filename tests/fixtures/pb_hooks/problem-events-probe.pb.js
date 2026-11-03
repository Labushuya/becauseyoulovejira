/// <reference path="../pb_data/types.d.ts" />
// Test-only routes of the error log of the server (FP-2, ADR-0077). The harness copies this file next
// to app/pb_hooks in every integration test instance; it is never part of the portable app folder.
//
// - GET /api/byl-test/problems/fail: an unexpected error (500) whose message holds invented secrets,
//   an e-mail address, a query and a number; for every account and without one.
// - GET /api/byl-test/problems/crash: a plain Error, which PocketBase 0.40.4 answers with 400
//   ("Something went wrong …"); an entry with http_400_unexpected.
// - GET /api/byl-test/problems/refuse, /unavailable, /written, /invalid, /gone: a refusal (400), the
//   deliberate 503 of "after the next restart", a 500 the route writes itself, a validation of save()
//   and a missing record (404); none of them is an entry.
// - POST /api/byl-test/problems/body: the body, at most 64 bytes; a broken one fails in requestInfo, a
//   larger one is refused (413); none is an entry.
// - GET /api/byl-test/problems/cancelled: waits until the client goes away and then fails with the
//   error of the cancelled request; GET …/cancelled/state (superusers) tells how far it got.
// - The model hook of problem_events fails with a plain Error for the code __byl_fail_problem_create__
//   ("Failed to create record." of the record API; an entry).
// - POST /api/byl-test/problems/record, /rule and /job (superusers): lib/problem-service.js with the
//   given input, the failure of a rule or the failure of a job.
// - POST /api/byl-test/problems/aged (superusers): `count` rows with the last occurrence `last_at`,
//   written by SQL, so a test sees the limits without waiting. Their IDs start with `prefix` (four
//   characters a-z0-9).
// - POST /api/byl-test/problems/break (superusers): breaks a job of the server on purpose, only for an
//   instance of its own: `job` "client-ops" (a trigger fails every delete of the notes of the outbox,
//   so the cron byl-client-ops-cleanup fails) or "startup-recurrence" (the column next_due of the rules
//   gets another name, so the catch-up of the recurrences fails at the next start).
routerAdd('GET', '/api/byl-test/problems/fail', function () {
  throw new ApiError(
    500,
    'Kaputt bei Zeile 1234: token=geheim-wert-123 und Authorization: Bearer abc.def.ghi für anna@example.com, ' +
      'Abruf von /api/byl/x?key=abfrage-geheim'
  );
});

routerAdd('GET', '/api/byl-test/problems/crash', function () {
  throw new Error('Kaputt im Hook');
});

routerAdd('GET', '/api/byl-test/problems/refuse', function () {
  throw new BadRequestError('Abgelehnt.');
});

routerAdd('GET', '/api/byl-test/problems/unavailable', function () {
  throw new ApiError(503, 'Steht nach dem nächsten Neustart bereit.');
});

routerAdd('GET', '/api/byl-test/problems/written', function (e) {
  return e.json(500, { status: 500, message: 'Von der Route selbst geschrieben.' });
});

// A failed save in a request: the validation of PocketBase (required fields of problem_events).
routerAdd('GET', '/api/byl-test/problems/invalid', function (e) {
  e.app.save(new Record(e.app.findCollectionByNameOrId('problem_events')));
  return e.json(200, {});
});

// A record that is not there (sql: no rows in result set), which PocketBase answers with 404.
routerAdd('GET', '/api/byl-test/problems/gone', function (e) {
  e.app.findRecordById('problem_events', 'abcdefghij12345');
  return e.json(200, {});
});

// The body of a request, at most 64 bytes: a broken one fails in requestInfo, a larger one is refused.
routerAdd(
  'POST',
  '/api/byl-test/problems/body',
  function (e) {
    return e.json(200, { keys: Object.keys(e.requestInfo().body).length });
  },
  $apis.bodyLimit(64)
);

// Waits at most 10 s for the client to go away (the context of the request ends), then throws the error
// of the cancelled request, as the database or another service would. The JSVM throws the error that
// Err() of the context returns (a GoError with context.Canceled).
routerAdd('GET', '/api/byl-test/problems/cancelled', function (e) {
  var context = e.request.context();
  e.app.store().set('byl-test-problems-cancelled', 'waiting');
  for (var i = 0; i < 500; i++) {
    try {
      context.err();
    } catch (cause) {
      e.app.store().set('byl-test-problems-cancelled', 'cancelled');
      throw cause;
    }
    sleep(20);
  }
  e.app.store().set('byl-test-problems-cancelled', 'timeout');
  return e.json(200, { cancelled: false });
});

routerAdd(
  'GET',
  '/api/byl-test/problems/cancelled/state',
  function (e) {
    return e.json(200, { state: String(e.app.store().get('byl-test-problems-cancelled') || '') });
  },
  $apis.requireSuperuserAuth()
);

// An Error of a model hook in the record API ("Failed to create record."): only for the marker code.
onRecordCreate(function (e) {
  if (e.record.getString('code') === '__byl_fail_problem_create__') {
    throw new Error('Kaputt im Model-Hook');
  }
  e.next();
}, 'problem_events');

routerAdd(
  'POST',
  '/api/byl-test/problems/record',
  function (e) {
    var body = e.requestInfo().body;
    var id = require(`${__hooks}/lib/problem-service.js`).record(e.app, {
      source: body['source'],
      area: body['area'],
      owner: body['owner'],
      household: body['household'],
      code: body['code'],
      message: body['message'],
      context: body['context']
    });
    return e.json(200, { id: id });
  },
  $apis.requireSuperuserAuth()
);

routerAdd(
  'POST',
  '/api/byl-test/problems/rule',
  function (e) {
    var body = e.requestInfo().body;
    var id = require(`${__hooks}/lib/problem-service.js`).recordRule(
      e.app,
      String(body['rule']),
      new Error(String(body['message'] || 'Ticket nicht erzeugt'))
    );
    return e.json(200, { id: id });
  },
  $apis.requireSuperuserAuth()
);

routerAdd(
  'POST',
  '/api/byl-test/problems/job',
  function (e) {
    var body = e.requestInfo().body;
    var id = require(`${__hooks}/lib/problem-service.js`).recordJob(e.app, String(body['job']), new Error(String(body['message'])));
    return e.json(200, { id: id });
  },
  $apis.requireSuperuserAuth()
);

routerAdd(
  'POST',
  '/api/byl-test/problems/aged',
  function (e) {
    var body = e.requestInfo().body;
    var prefix = String(body['prefix']);
    if (!/^[a-z0-9]{4}$/.test(prefix)) {
      throw new BadRequestError('prefix: four characters a-z0-9');
    }
    e.app
      .db()
      .newQuery(
        'WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < {:count}) ' +
          'INSERT INTO problem_events (id, source, area, owner, household, code, message, context, fingerprint, count, first_at, last_at) ' +
          "SELECT {:prefix} || printf('%011d', i), 'job', 'system', '', '', 'test_aged', 'Alt', '{}', " +
          "{:prefix} || printf('%060d', i), 1, {:at}, {:at} FROM n"
      )
      .bind({ count: Number(body['count']), prefix: prefix, at: String(body['last_at']) })
      .execute();
    return e.json(200, { prefix: prefix });
  },
  $apis.requireSuperuserAuth()
);

routerAdd(
  'POST',
  '/api/byl-test/problems/break',
  function (e) {
    var job = String(e.requestInfo().body['job']);
    if (job === 'client-ops') {
      e.app
        .db()
        .newQuery(
          'CREATE TRIGGER IF NOT EXISTS byl_test_break_client_ops BEFORE DELETE ON client_ops ' +
            "BEGIN SELECT RAISE(ABORT, 'Bereinigung absichtlich gescheitert'); END"
        )
        .execute();
    } else if (job === 'startup-recurrence') {
      e.app.db().newQuery('ALTER TABLE recurrence_rules RENAME COLUMN next_due TO next_due_broken').execute();
    } else {
      throw new BadRequestError('job: client-ops or startup-recurrence');
    }
    return e.json(200, { job: job });
  },
  $apis.requireSuperuserAuth()
);
