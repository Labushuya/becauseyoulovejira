/// <reference path="../pb_data/types.d.ts" />
// Settings of a user (E4 plan, package 21): the keywords of the file imports in
// `import_keywords` (ADR-0020 section 3) are checked by lib/user-service.js, the target projects
// of the cards without a connection in `inbox_targets` (ADR-0049) by lib/target-project-service.js.

onRecordCreateRequest(function (e) {
  require(`${__hooks}/lib/user-service.js`).guardImportKeywords(e.record);
  require(`${__hooks}/lib/target-project-service.js`).guardUserTargets(e, true);
  e.next();
}, 'users');

onRecordUpdateRequest(function (e) {
  require(`${__hooks}/lib/user-service.js`).guardImportKeywords(e.record);
  require(`${__hooks}/lib/target-project-service.js`).guardUserTargets(e, false);
  e.next();
}, 'users');
