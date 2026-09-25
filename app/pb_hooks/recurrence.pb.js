/// <reference path="../pb_data/types.d.ts" />
// Recurrence rule hooks (CLAUDE.md section 6, ADR-0021 and ADR-0023; E5 plan package 2). The
// logic lives in lib/recurrence-service.js and lib/recurrence-rules.js; handlers run in isolated
// scopes, so modules are required inside them. Create and update run in their own transaction
// (lib/transaction.js): a rule created with `ticket` and the link of that ticket are written
// together or not at all. Before the E5 migrations (no `freq` yet) every handler only calls
// e.next(), so rules behave as in E4.

onRecordCreateRequest(function (e) {
  var service = require(`${__hooks}/lib/recurrence-service.js`);
  if (service.schemaReady(e.app)) {
    service.prepareCreateRequest(e);
  }
  e.next();
}, 'recurrence_rules');

onRecordUpdateRequest(function (e) {
  var service = require(`${__hooks}/lib/recurrence-service.js`);
  if (service.schemaReady(e.app)) {
    service.prepareUpdateRequest(e);
  }
  e.next();
}, 'recurrence_rules');

onRecordCreate(function (e) {
  var service = require(`${__hooks}/lib/recurrence-service.js`);
  if (!service.schemaReady(e.app)) {
    e.next();
    return;
  }
  require(`${__hooks}/lib/transaction.js`).inTransaction(e, function (txApp) {
    var prepared = service.prepareCreate(txApp, e.record, Date.now());
    e.next();
    service.completeCreate(txApp, e.record, prepared);
  });
}, 'recurrence_rules');

onRecordUpdate(function (e) {
  var service = require(`${__hooks}/lib/recurrence-service.js`);
  if (!service.schemaReady(e.app)) {
    e.next();
    return;
  }
  require(`${__hooks}/lib/transaction.js`).inTransaction(e, function (txApp) {
    service.prepareUpdate(txApp, e.record, Date.now());
    e.next();
  });
}, 'recurrence_rules');
