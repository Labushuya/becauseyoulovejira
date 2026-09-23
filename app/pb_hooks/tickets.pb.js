/// <reference path="../pb_data/types.d.ts" />
// Ticket hooks (CLAUDE.md sections 3 and 5, E1 plan packages 5 and 6). The logic lives in
// lib/ticket-service.js; handlers run in isolated scopes, so modules are required inside them.
// Create and update through the Record API are not transactional in PocketBase 0.40.4, hence
// each model hook runs in its own transaction (lib/transaction.js, OF-1).

// blocks_parent defaults to true unless the client sends the field (OF-11); bool fields have no
// schema default and the model hook cannot tell "false" from "not sent".
onRecordCreateRequest(function (e) {
  if (e.requestInfo().body['blocks_parent'] === undefined) {
    e.record.set('blocks_parent', true);
  }
  e.next();
}, 'tickets');

onRecordCreate(function (e) {
  var service = require(`${__hooks}/lib/ticket-service.js`);
  require(`${__hooks}/lib/transaction.js`).inTransaction(e, function (txApp) {
    service.prepareCreate(txApp, e.record);
    e.next();
  });
}, 'tickets');

onRecordUpdate(function (e) {
  var service = require(`${__hooks}/lib/ticket-service.js`);
  require(`${__hooks}/lib/transaction.js`).inTransaction(e, function (txApp) {
    service.prepareUpdate(txApp, e.record);
    e.next();
  });
}, 'tickets');
