/// <reference path="../pb_data/types.d.ts" />
// Inbox hooks (ADR-0014, E4 plan package 1). The logic lives in lib/inbox-service.js; handlers
// run in isolated scopes, so modules are required inside them. The duplicate check and the
// insert run in one transaction (lib/transaction.js). Until the migration 1790201200 has run,
// the collection does not exist and none of these handlers fires.

onRecordCreate(function (e) {
  var service = require(`${__hooks}/lib/inbox-service.js`);
  require(`${__hooks}/lib/transaction.js`).inTransaction(e, function (txApp) {
    service.prepareCreate(txApp, e.record);
    e.next();
  });
}, 'inbox_items');

// Only client updates: immutable fields and allowed changes of state and ticket.
onRecordUpdateRequest(function (e) {
  require(`${__hooks}/lib/inbox-service.js`).guardClientUpdate(e.record);
  e.next();
}, 'inbox_items');

onRecordUpdate(function (e) {
  var service = require(`${__hooks}/lib/inbox-service.js`);
  require(`${__hooks}/lib/transaction.js`).inTransaction(e, function (txApp) {
    service.prepareUpdate(txApp, e.record);
    e.next();
  });
}, 'inbox_items');
