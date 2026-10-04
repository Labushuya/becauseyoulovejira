/// <reference path="../pb_data/types.d.ts" />
// Settings of a user (E4 plan, package 21): the keywords of the file imports in
// `import_keywords` (ADR-0020 section 3) are checked by lib/user-service.js, the target projects
// of the cards without a connection in `inbox_targets` (ADR-0049) by lib/target-project-service.js.
// Since E7-1 (ADR-0056, lib/account-service.js): the right "Verwalter der App" and the switch
// "deaktiviert" come only from an administrator, one active administrator always stays, the first
// account becomes administrator, and a disabled account does not sign in.

onRecordCreateRequest(function (e) {
  require(`${__hooks}/lib/user-service.js`).guardImportKeywords(e.record);
  require(`${__hooks}/lib/target-project-service.js`).guardUserTargets(e, true);
  e.next();
}, 'users');

onRecordUpdateRequest(function (e) {
  require(`${__hooks}/lib/account-service.js`).guardClientUpdate(e);
  require(`${__hooks}/lib/user-service.js`).guardImportKeywords(e.record);
  require(`${__hooks}/lib/target-project-service.js`).guardUserTargets(e, false);
  e.next();
}, 'users');

// Every way of saving (routes of the page "Konten", admin UI, Record API).
onRecordCreate(function (e) {
  require(`${__hooks}/lib/account-service.js`).bootstrapAdmin(e);
  e.next();
}, 'users');

onRecordUpdate(function (e) {
  require(`${__hooks}/lib/account-service.js`).keepAnAdmin(e);
  e.next();
}, 'users');

onRecordDelete(function (e) {
  require(`${__hooks}/lib/account-service.js`).keepAdminOnDelete(e);
  e.next();
}, 'users');

// After a successful sign-in of any kind (password, refresh): a disabled account gets 403.
onRecordAuthRequest(function (e) {
  require(`${__hooks}/lib/account-service.js`).guardSignIn(e);
  e.next();
}, 'users');
