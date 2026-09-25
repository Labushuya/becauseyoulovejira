/// <reference path="../pb_data/types.d.ts" />
// Ingest interface of the mail helper byl-mail.exe (ADR-0016 section 5, ADR-0018 section 8; E4 plan
// package 22). Every route needs "Authorization: Bearer <BYL_INGEST_TOKEN>"; without the variable
// the routes answer 404, with a wrong token 401. The logic lives in lib/ingest-service.js; handlers
// run in isolated scopes, so modules are required inside them.

// The switched-on mail connections, without owner and without secrets (only variable names).
routerAdd('GET', '/api/byl/ingest/connections', function (e) {
  var service = require(`${__hooks}/lib/ingest-service.js`);
  service.authorize(e);
  return e.json(200, { items: service.listConnections(e.app) });
});

// One mail as inbox entry of the owner of its connection: JSON, or multipart with "draft" (JSON
// text) and the original mail as "original". origin "auto" needs a keyword of the connection.
routerAdd(
  'POST',
  '/api/byl/ingest/items',
  function (e) {
    var service = require(`${__hooks}/lib/ingest-service.js`);
    service.authorize(e);
    return service.ingestItem(e);
  },
  $apis.bodyLimit(12 * 1024 * 1024)
);

// Result of a run: time, cleaned error, hint and cursor of a mail connection.
routerAdd('POST', '/api/byl/ingest/connections/{id}/status', function (e) {
  var service = require(`${__hooks}/lib/ingest-service.js`);
  service.authorize(e);
  return service.reportStatus(e, e.request.pathValue('id'));
});
