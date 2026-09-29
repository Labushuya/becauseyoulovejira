/// <reference path="../pb_data/types.d.ts" />
// Test-only route for the clean environment of child processes (tests/support/clean-env.mjs). The
// harness copies this file next to app/pb_hooks in every integration test instance, and
// control-script.test.mjs into its disposable copies of the app folder; it is never part of the
// portable app folder. Superusers only.

// Which of the given variable names (?names=BYL_A,BYL_B) are set in the environment of this
// server. Answers names only, never a value.
routerAdd(
  'GET',
  '/api/byl-test/environment',
  function (e) {
    var names = String(e.request.url.query().get('names') || '').split(',');
    var set = [];
    for (var i = 0; i < names.length; i++) {
      var name = names[i].replace(/^\s+|\s+$/g, '');
      if (name !== '' && $os.getenv(name) !== '') {
        set.push(name);
      }
    }
    return e.json(200, { set: set });
  },
  $apis.requireSuperuserAuth()
);
