/// <reference path="../pb_data/types.d.ts" />
// Settings of a user (E4 plan, package 21): the keywords of the file imports in
// `import_keywords` (ADR-0020 section 3) are checked by lib/user-service.js.

onRecordCreateRequest(function (e) {
  require(`${__hooks}/lib/user-service.js`).guardImportKeywords(e.record);
  e.next();
}, 'users');

onRecordUpdateRequest(function (e) {
  require(`${__hooks}/lib/user-service.js`).guardImportKeywords(e.record);
  e.next();
}, 'users');
