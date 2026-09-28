/// <reference path="../pb_data/types.d.ts" />
// Project hooks (CLAUDE.md section 5, E1 plan package 5, OF-6, OF-14; sub projects ADR-0034).
// The checks read tickets and projects, so they run in the same transaction as the write
// (lib/transaction.js). Archiving a project archives its sub projects in that transaction.

onRecordCreate(function (e) {
  var service = require(`${__hooks}/lib/catalog-service.js`);
  require(`${__hooks}/lib/transaction.js`).inTransaction(e, function (txApp) {
    service.prepareProject(txApp, e.record, true);
    e.next();
  });
}, 'projects');

onRecordUpdate(function (e) {
  var service = require(`${__hooks}/lib/catalog-service.js`);
  require(`${__hooks}/lib/transaction.js`).inTransaction(e, function (txApp) {
    service.prepareProject(txApp, e.record, false);
    e.next();
    service.archiveSubProjects(txApp, e.record);
  });
}, 'projects');

onRecordDelete(function (e) {
  var service = require(`${__hooks}/lib/catalog-service.js`);
  require(`${__hooks}/lib/transaction.js`).inTransaction(e, function (txApp) {
    service.assertProjectDeletable(txApp, e.record);
    e.next();
  });
}, 'projects');
