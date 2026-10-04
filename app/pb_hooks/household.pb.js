/// <reference path="../pb_data/types.d.ts" />
// Page "Einstellungen → Haushalt" (ADR-0058, E7-2): found a household, invitation codes, join with a
// code, rights of the members, hand the household on, remove a member, leave. For every app account
// on every device (nothing here acts on the machine of the app); every route checks the membership
// and the rights itself and changes in one transaction. Joining is limited by the rate limiter
// (lib/security-rules.js JOIN_RULE). The logic lives in lib/household-service.js; handlers run in
// isolated scopes, so the module is required inside them.

// The household of the account with its members and, with the right "invite", its codes.
routerAdd(
  'GET',
  '/api/byl/household',
  function (e) {
    return require(`${__hooks}/lib/household-service.js`).view(e);
  },
  $apis.requireAuth('users')
);

// { name }: founds a household; the account becomes its owner.
routerAdd(
  'POST',
  '/api/byl/household',
  function (e) {
    return require(`${__hooks}/lib/household-service.js`).create(e);
  },
  $apis.requireAuth('users')
);

// { name }: renames the household (right "rename").
routerAdd(
  'POST',
  '/api/byl/household/rename',
  function (e) {
    return require(`${__hooks}/lib/household-service.js`).rename(e);
  },
  $apis.requireAuth('users')
);

// A new invitation code (right "invite"), shown once in the answer.
routerAdd(
  'POST',
  '/api/byl/household/invites',
  function (e) {
    return require(`${__hooks}/lib/household-service.js`).createInvite(e);
  },
  $apis.requireAuth('users')
);

// Revokes an open code (right "invite").
routerAdd(
  'POST',
  '/api/byl/household/invites/{id}/revoke',
  function (e) {
    return require(`${__hooks}/lib/household-service.js`).revokeInvite(e);
  },
  $apis.requireAuth('users')
);

// { code }: joins the household of an open code.
routerAdd(
  'POST',
  '/api/byl/household/join',
  function (e) {
    return require(`${__hooks}/lib/household-service.js`).join(e);
  },
  $apis.requireAuth('users')
);

// { rights }: the rights of a member (right "delegate", only own rights).
routerAdd(
  'POST',
  '/api/byl/household/members/{id}/rights',
  function (e) {
    return require(`${__hooks}/lib/household-service.js`).setRights(e);
  },
  $apis.requireAuth('users')
);

// Removes a member (right "remove"), never the owner.
routerAdd(
  'POST',
  '/api/byl/household/members/{id}/remove',
  function (e) {
    return require(`${__hooks}/lib/household-service.js`).removeMember(e);
  },
  $apis.requireAuth('users')
);

// Hands the household to another member (only the owner).
routerAdd(
  'POST',
  '/api/byl/household/members/{id}/transfer',
  function (e) {
    return require(`${__hooks}/lib/household-service.js`).transfer(e);
  },
  $apis.requireAuth('users')
);

// Leaves the household (every member but the owner).
routerAdd(
  'POST',
  '/api/byl/household/leave',
  function (e) {
    return require(`${__hooks}/lib/household-service.js`).leave(e);
  },
  $apis.requireAuth('users')
);

// { mode: adopt | delete, preview?, name? }: dissolves the household (E7-4, ADR-0061 §5; only the
// owner): everything into his private area, or deleted for good after typing its name.
routerAdd(
  'POST',
  '/api/byl/household/dissolve',
  function (e) {
    return require(`${__hooks}/lib/area-move-service.js`).dissolve(e);
  },
  $apis.requireAuth('users')
);

// { retention }: the retention of the trash of the household (E7-3; owner or right "purge").
routerAdd(
  'POST',
  '/api/byl/household/retention',
  function (e) {
    return require(`${__hooks}/lib/household-service.js`).setRetention(e);
  },
  $apis.requireAuth('users')
);
