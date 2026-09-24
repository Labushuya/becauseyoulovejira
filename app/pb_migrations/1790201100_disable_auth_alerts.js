/// <reference path="../pb_data/types.d.ts" />
// E1.1: no "new login" alert mails. PocketBase 0.40.4 enables authAlert for every auth collection
// (users and the superusers) by default; without a configured mailer each alert only ends as an
// error in the logs. Applies to all auth collections, so the superusers need no name here.
function setAuthAlert(app, enabled) {
  var collections = app.findAllCollections('auth');
  for (var i = 0; i < collections.length; i++) {
    collections[i].authAlert.enabled = enabled;
    app.save(collections[i]);
  }
}

migrate(
  function (app) {
    setAuthAlert(app, false);
  },
  function (app) {
    // PocketBase 0.40.4 default.
    setAuthAlert(app, true);
  }
);
