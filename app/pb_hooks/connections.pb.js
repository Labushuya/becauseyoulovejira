/// <reference path="../pb_data/types.d.ts" />
// Connections of the channels (ADR-0016 section 2, ADR-0018; E4 plan package 10). The logic lives
// in lib/connection-service.js; handlers run in isolated scopes, so modules are required inside
// them. Until the migration 1790201400 has run, the collection does not exist and the record
// hooks do not fire; the route answers 503.

onRecordCreateRequest(function (e) {
  require(`${__hooks}/lib/connection-service.js`).guardCreate(e);
  e.next();
}, 'connections');

onRecordUpdateRequest(function (e) {
  require(`${__hooks}/lib/connection-service.js`).guardUpdate(e);
  e.next();
}, 'connections');

onRecordCreate(function (e) {
  require(`${__hooks}/lib/connection-service.js`).prepareSave(e.record, true);
  e.next();
}, 'connections');

onRecordUpdate(function (e) {
  require(`${__hooks}/lib/connection-service.js`).prepareSave(e.record, false);
  e.next();
}, 'connections');

// Whether the variables of a connection are set, as yes or no only (ADR-0018 section 4). A
// connection the request may not see answers 404 like a missing one.
routerAdd(
  'GET',
  '/api/byl/connections/{id}/secret-status',
  function (e) {
    var service = require(`${__hooks}/lib/connection-service.js`);
    var record = service.visibleConnection(e, e.request.pathValue('id'));
    if (!record) {
      throw new NotFoundError();
    }
    return e.json(200, service.secretStatus(record));
  },
  $apis.requireAuth('users')
);
