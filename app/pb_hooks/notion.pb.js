/// <reference path="../pb_data/types.d.ts" />
// Notion: importing existing lists into the inbox, only reading, only copies, only on request
// (ADR-0041). No cron job, no webhook, nothing is written to Notion. The logic lives in
// lib/notion-service.js (client in lib/notion-client.js, pure rules in lib/notion-rules.js and
// lib/notion-markdown.js). Every route needs a signed-in user who may see the Notion connection
// (else 404); before the migration of the connections they answer 503. Missing access data and a
// paused connection answer 200 with their state, a failure of Notion 200 with status "error" and a
// German message without the token.

// "Verbindung prüfen": the bot user of the token and whether anything is shared.
routerAdd(
  'POST',
  '/api/byl/connections/{id}/notion/check',
  function (e) {
    var result = require(`${__hooks}/lib/notion-service.js`).check(e);
    return e.json(result.status, result.body);
  },
  $apis.requireAuth('users')
);

// Shared data sources and pages; ?q= narrows the search of Notion by title.
routerAdd(
  'GET',
  '/api/byl/connections/{id}/notion/sources',
  function (e) {
    var result = require(`${__hooks}/lib/notion-service.js`).sources(e);
    return e.json(result.status, result.body);
  },
  $apis.requireAuth('users')
);

// Sources imported so far, from the inbox (no request to Notion).
routerAdd(
  'GET',
  '/api/byl/connections/{id}/notion/imports',
  function (e) {
    var result = require(`${__hooks}/lib/notion-service.js`).imports(e);
    return e.json(result.status, result.body);
  },
  $apis.requireAuth('users')
);

// Preview of one source: { source: { type, id }, date_property? }. Saves nothing.
routerAdd(
  'POST',
  '/api/byl/connections/{id}/notion/preview',
  function (e) {
    var result = require(`${__hooks}/lib/notion-service.js`).preview(e);
    return e.json(result.status, result.body);
  },
  $apis.requireAuth('users')
);

// Import of chosen entries: { source, refs, skip_done, copy_content, date_property? }.
routerAdd(
  'POST',
  '/api/byl/connections/{id}/notion/import',
  function (e) {
    var result = require(`${__hooks}/lib/notion-service.js`).importEntries(e);
    return e.json(result.status, result.body);
  },
  $apis.requireAuth('users')
);
