/// <reference path="../pb_data/types.d.ts" />
// Test-only routes of the error log of the server (FP-2, ADR-0077). The harness copies this file next
// to app/pb_hooks in every integration test instance; it is never part of the portable app folder.
//
// - GET /api/byl-test/problems/fail: an unexpected error (500) whose message holds invented secrets,
//   an e-mail address, a query and a number; for every account and without one.
// - GET /api/byl-test/problems/refuse, /unavailable, /written, /crash: a refusal (400), the
//   deliberate 503 of "after the next restart", a 500 the route writes itself and a plain Error, which
//   PocketBase 0.40.4 answers with 400 ("Something went wrong …"); none of them is an entry.
// - POST /api/byl-test/problems/record and /rule (superusers): lib/problem-service.js with the given
//   input, or with the failure of a rule.
// - POST /api/byl-test/problems/aged (superusers): `count` rows with the last occurrence `last_at`,
//   written by SQL, so a test sees the limits without waiting. Their IDs start with `prefix` (four
//   characters a-z0-9).
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
