/// <reference path="../pb_data/types.d.ts" />
// GitHub channel (ADR-0050, plan beobachtete-quellen, package 2): watched repositories, read only.
// The logic lives in lib/github-service.js (runs, cron, check, details, the list of the
// repositories of the token), the rules in
// lib/github-rules.js and the client (GET only) in lib/github-client.js. "Jetzt abrufen" runs a
// connection through the common route /api/byl/connections/{id}/run (channels.pb.js). Before the
// migration 1790203200 no connection of the kind exists: the cron does nothing, the routes answer
// 404.

// Every minute; each connection runs once its interval (5 to 60 minutes, default 15) has passed and
// no rate limit of GitHub holds. Instances of the tests (mark of tests/fixtures/pb_hooks) skip it:
// they run the same function through a route of their own at a time they choose.
cronAdd('byl-github', '* * * * *', function () {
  if ($app.store().get('byl-test-mode') === true) {
    return;
  }
  require(`${__hooks}/lib/github-service.js`).runDue($app, Date.now());
});

// The details of the repositories of a GitHub connection for its card, from what the last runs
// stored, without a request to GitHub. A connection the request may not see, or of another kind,
// answers 404.
routerAdd(
  'GET',
  '/api/byl/connections/{id}/github',
  function (e) {
    var record = require(`${__hooks}/lib/connection-service.js`).visibleConnection(e, e.request.pathValue('id'));
    if (!record || record.getString('type') !== 'github') {
      throw new NotFoundError();
    }
    return e.json(200, require(`${__hooks}/lib/github-service.js`).summary(record));
  },
  $apis.requireAuth('users')
);

// "Verbindung prüfen": the user of the token, the rate limit and per repository whether GitHub
// answers. Stores the result at the connection; never shows the token.
routerAdd(
  'POST',
  '/api/byl/connections/{id}/github/check',
  function (e) {
    var record = require(`${__hooks}/lib/connection-service.js`).visibleConnection(e, e.request.pathValue('id'));
    if (!record || record.getString('type') !== 'github') {
      throw new NotFoundError();
    }
    return e.json(200, require(`${__hooks}/lib/github-service.js`).check(e.app, record));
  },
  $apis.requireAuth('users')
);

// The repositories the token may read, for "Repository hinzufügen …" (ADR-0050, addendum of
// 2026-10-02): from the stored list (at most an hour old), else read again with ETag; refresh=1
// reads again at most once a minute. Without a token "no_token"; never shows the token.
routerAdd(
  'GET',
  '/api/byl/connections/{id}/github/repos',
  function (e) {
    var record = require(`${__hooks}/lib/connection-service.js`).visibleConnection(e, e.request.pathValue('id'));
    if (!record || record.getString('type') !== 'github') {
      throw new NotFoundError();
    }
    var refresh = String(e.request.url.query().get('refresh') || '') === '1';
    return e.json(200, require(`${__hooks}/lib/github-service.js`).repoList(e.app, record, { refresh: refresh }));
  },
  $apis.requireAuth('users')
);
