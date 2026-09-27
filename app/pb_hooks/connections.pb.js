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

// Mailbox selection (ADR-0016 section 6; E4 plan package 23): the last mails of a mail connection
// and the import of chosen ones, passed on to the mail helper on 127.0.0.1. A connection the
// request may not see answers 404; a stopped helper 503 with a hint.
routerAdd(
  'GET',
  '/api/byl/connections/{id}/mailbox',
  function (e) {
    return require(`${__hooks}/lib/mailbox-service.js`).list(e);
  },
  $apis.requireAuth('users')
);

routerAdd(
  'POST',
  '/api/byl/connections/{id}/mailbox/import',
  function (e) {
    return require(`${__hooks}/lib/mailbox-service.js`).importMails(e);
  },
  $apis.requireAuth('users')
);

// Whether the mail helper runs, for the cards of mailboxes (testing feedback package A, item 4):
// { state: "running" | "stopped" | "refused", version, message }. Logs in to no mailbox.
routerAdd(
  'GET',
  '/api/byl/mail-helper',
  function (e) {
    return require(`${__hooks}/lib/mailbox-service.js`).helperStatus(e);
  },
  $apis.requireAuth('users')
);
