/// <reference path="../pb_data/types.d.ts" />
// Folder channel (ADR-0051, plan beobachtete-quellen, package 3): folders on this machine watched
// read only; their files come in as references with a status, never as copies. The logic lives in
// lib/folder-service.js (runs, cron, details, files of before, the file route), the rules in
// lib/folder-rules.js and the hashing in lib/folder-hash.js. "Jetzt prüfen" runs a connection
// through the common route /api/byl/connections/{id}/run (channels.pb.js). Before the migration
// 1790203300 no connection of the kind exists: the cron does nothing, the routes answer 404.

// Every minute; each connection runs once its interval (1 to 60 minutes, default 5) has passed.
// Instances of the tests (mark of tests/fixtures/pb_hooks) skip it: they run the same function
// through a route of their own at a time they choose.
cronAdd('byl-folders', '* * * * *', function () {
  if ($app.store().get('byl-test-mode') === true) {
    return;
  }
  require(`${__hooks}/lib/folder-service.js`).runDue($app, Date.now());
});

// The details of the folders of a connection for its card, from what the last runs stored, without
// reading a folder. A connection the request may not see, or of another kind, answers 404.
routerAdd(
  'GET',
  '/api/byl/connections/{id}/folders',
  function (e) {
    var record = require(`${__hooks}/lib/connection-service.js`).visibleConnection(e, e.request.pathValue('id'));
    if (!record || record.getString('type') !== 'folder') {
      throw new NotFoundError();
    }
    return e.json(200, require(`${__hooks}/lib/folder-service.js`).summary(record));
  },
  $apis.requireAuth('users')
);

// "Vorhandene Dateien übernehmen", step 1: the files of one folder from its stored state (path,
// name, size, time, state of an entry), without reading a file. ?folder=<ID of the folder in the
// details>, never its path (PocketBase logs the address of a request).
routerAdd(
  'GET',
  '/api/byl/connections/{id}/folders/existing',
  function (e) {
    var record = require(`${__hooks}/lib/connection-service.js`).visibleConnection(e, e.request.pathValue('id'));
    if (!record || record.getString('type') !== 'folder') {
      throw new NotFoundError();
    }
    var list = require(`${__hooks}/lib/folder-service.js`).existing(e.app, record, String(e.request.url.query().get('folder') || ''));
    if (list === null) {
      throw new NotFoundError('Diesen Ordner gibt es in der Verbindung nicht.');
    }
    return e.json(200, list);
  },
  $apis.requireAuth('users')
);

// "Vorhandene Dateien übernehmen", step 2: entries for the chosen files ({ folder, paths }, at most
// 50 per request), each a reference with its metadata like a new file.
routerAdd(
  'POST',
  '/api/byl/connections/{id}/folders/adopt',
  function (e) {
    var record = require(`${__hooks}/lib/connection-service.js`).visibleConnection(e, e.request.pathValue('id'));
    if (!record || record.getString('type') !== 'folder') {
      throw new NotFoundError();
    }
    var body = e.requestInfo().body || {};
    var result = require(`${__hooks}/lib/folder-service.js`).adopt(e.app, record, String(body.folder || ''), body.paths);
    if (result.status === 'unknown') {
      throw new NotFoundError('Diesen Ordner gibt es in der Verbindung nicht.');
    }
    if (result.status === 'invalid') {
      throw new BadRequestError('Bitte 1 bis 50 Dateien des Ordners wählen.');
    }
    return e.json(200, result);
  },
  $apis.requireAuth('users'),
  $apis.bodyLimit(256 * 1024)
);

// "Ansehen", step 1: whether the file of an entry can be shown, with the address of step 2 (a file
// token of PocketBase in it). Only for the administrator of the app (ADR-0056), from this machine, from the app
// itself (ADR-0043 §4); nothing is read from the file.
routerAdd(
  'GET',
  '/api/byl/folders/items/{id}',
  function (e) {
    return require(`${__hooks}/lib/folder-service.js`).itemInfo(e, e.request.pathValue('id'));
  },
  $apis.requireAuth('users')
);

// "Ansehen", step 2: the current file of an entry, read only, opened by the browser as a link (the
// file token stands for the session). Same checks as step 1, then the path again on the disk.
routerAdd('GET', '/api/byl/folders/items/{id}/file', function (e) {
  return require(`${__hooks}/lib/folder-service.js`).serveFile(e, e.request.pathValue('id'));
});
