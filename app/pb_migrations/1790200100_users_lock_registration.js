/// <reference path="../pb_data/types.d.ts" />
// E1 plan, package 3, step 1 (ADR-0002, OF-2): no self-registration, no account deletion via
// the API, password login only. list/view/update stay restricted to the own record.
migrate(
  function (app) {
    var users = app.findCollectionByNameOrId('users');
    users.listRule = 'id = @request.auth.id';
    users.viewRule = 'id = @request.auth.id';
    users.createRule = null;
    users.updateRule = 'id = @request.auth.id';
    users.deleteRule = null;
    users.passwordAuth.enabled = true;
    users.oauth2.enabled = false;
    users.otp.enabled = false;
    app.save(users);
  },
  function (app) {
    // PocketBase 0.40.4 defaults of the users collection.
    var users = app.findCollectionByNameOrId('users');
    users.createRule = '';
    users.deleteRule = 'id = @request.auth.id';
    app.save(users);
  }
);
