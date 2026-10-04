/// <reference path="../pb_data/types.d.ts" />
// Page "Einstellungen → Konten" (ADR-0056, E7-1): accounts of the app for its administrator. Every
// route checks like the page "Speicher" (signed in, this machine, the address of the app, an
// administrator, rate limit per account) and logs actions and refusals without e-mail addresses and
// passwords. The logic lives in lib/account-service.js; handlers run in isolated scopes, so the
// module is required inside them.

// Every account with name, e-mail, right, switch and creation, plus the minimum of a password.
routerAdd(
  'GET',
  '/api/byl/accounts',
  function (e) {
    require(`${__hooks}/lib/account-service.js`).list(e);
  },
  $apis.requireAuth('users')
);

// A new account { email, name } with a start password the answer shows once.
routerAdd(
  'POST',
  '/api/byl/accounts',
  function (e) {
    require(`${__hooks}/lib/account-service.js`).create(e);
  },
  $apis.requireAuth('users')
);

// A new password for another account, shown once; its sessions end.
routerAdd(
  'POST',
  '/api/byl/accounts/{id}/password',
  function (e) {
    require(`${__hooks}/lib/account-service.js`).resetPassword(e);
  },
  $apis.requireAuth('users')
);

// { disabled }: disable another account (its sessions end) or enable it again.
routerAdd(
  'POST',
  '/api/byl/accounts/{id}/disabled',
  function (e) {
    require(`${__hooks}/lib/account-service.js`).setDisabled(e);
  },
  $apis.requireAuth('users')
);

// { member }: a new owner for a household whose owner is disabled or gone (E7-4, ADR-0061 §6).
routerAdd(
  'POST',
  '/api/byl/accounts/households/{id}/owner',
  function (e) {
    require(`${__hooks}/lib/account-service.js`).setHouseholdOwner(e);
  },
  $apis.requireAuth('users')
);

// { preview?, name? }: delete an orphaned household for good, no membership of it belongs to an
// existing account (E7-4c, ADR-0061 addendum E7-4c).
routerAdd(
  'POST',
  '/api/byl/accounts/households/{id}/delete',
  function (e) {
    require(`${__hooks}/lib/account-service.js`).deleteOrphanedHousehold(e);
  },
  $apis.requireAuth('users')
);

// { admin }: give or take the right "Verwalter der App"; one active administrator stays.
routerAdd(
  'POST',
  '/api/byl/accounts/{id}/admin',
  function (e) {
    require(`${__hooks}/lib/account-service.js`).setAdmin(e);
  },
  $apis.requireAuth('users')
);
