/// <reference path="../pb_data/types.d.ts" />
// Accounts and the administrator of the app (ADR-0056, E7-1; plan docs/plan/e7-haushalt.md).
//
// - users.instance_admin: the explicit right "Verwalter der App". It replaces the rule "the account
//   created first owns the instance" (ADR-0043 §3): the pages System, Sicherung, Speicher,
//   Sicherheit and Konten, "Ansehen" of folder files and channels with access data. The migration
//   gives it to the account that owned the instance so far (created first, smallest ID on a tie, the
//   rule of ownerId in lib/system-service.js); with no account yet the first one created later gets
//   it from the hook (lib/account-service.js). Only administrators and the superuser change it, and
//   one active administrator always stays (hooks).
// - users.disabled: a disabled account cannot sign in (onRecordAuthRequest); disabling it renews its
//   token key, so its sessions end at once.
// - users list/view: the own record, every record for an administrator, and the accounts that share
//   a household. The e-mail stays hidden from everybody but the account itself (emailVisibility,
//   which no client may change).
// - household_members list/view: the members of the own households see each other. Writing stays
//   null (E7-2).
//
// The flag is set by SQL, so no hook runs and `updated` stays. Down: the fields go, the rules of
// 1790200100 and 1790200900 come back.
migrate(
  function (app) {
    var users = app.findCollectionByNameOrId('users');
    users.fields.add(new BoolField({ name: 'instance_admin' }));
    users.fields.add(new BoolField({ name: 'disabled' }));
    var readable =
      '@request.auth.id != "" && (id = @request.auth.id || @request.auth.instance_admin = true || ' +
      'household_members_via_user.household.household_members_via_household.user ?= @request.auth.id)';
    users.listRule = readable;
    users.viewRule = readable;
    app.save(users);

    var members = app.findCollectionByNameOrId('household_members');
    var together = '@request.auth.id != "" && household.household_members_via_household.user ?= @request.auth.id';
    members.listRule = together;
    members.viewRule = together;
    app.save(members);

    var first = app.findRecordsByFilter('users', 'id != ""', 'created,id', 1, 0);
    if (first.length > 0) {
      app.db().newQuery('UPDATE users SET instance_admin = 1 WHERE id = {:id}').bind({ id: first[0].id }).execute();
    }
  },
  function (app) {
    var members = app.findCollectionByNameOrId('household_members');
    members.listRule = 'user = @request.auth.id';
    members.viewRule = 'user = @request.auth.id';
    app.save(members);

    var users = app.findCollectionByNameOrId('users');
    users.listRule = 'id = @request.auth.id';
    users.viewRule = 'id = @request.auth.id';
    users.fields.removeByName('instance_admin');
    users.fields.removeByName('disabled');
    app.save(users);
  }
);
