/// <reference path="../pb_data/types.d.ts" />
// Tag hooks (CLAUDE.md section 5, E1 plan package 5, OF-8): scope from owner/household. The
// unique index tags(scope, name COLLATE NOCASE) rejects duplicates within a scope.

onRecordCreate(function (e) {
  var service = require(`${__hooks}/lib/catalog-service.js`);
  require(`${__hooks}/lib/transaction.js`).inTransaction(e, function (txApp) {
    service.prepareTag(txApp, e.record, true);
    e.next();
  });
}, 'tags');

onRecordUpdate(function (e) {
  var service = require(`${__hooks}/lib/catalog-service.js`);
  require(`${__hooks}/lib/transaction.js`).inTransaction(e, function (txApp) {
    service.prepareTag(txApp, e.record, false);
    e.next();
  });
}, 'tags');
