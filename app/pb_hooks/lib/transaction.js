// Runs a model hook inside its own transaction (CLAUDE.md section 3, E1 plan OF-1).
// CommonJS module, ES5 only, Goja runtime only.
//
// `fn(txApp)` must call e.next(); the save then uses the transaction because e.app is swapped for
// txApp. Afterwards e.app is restored: PocketBase runs the after-success hooks (realtime
// broadcast among them) with the app of the event once the handler returns, and a finished
// transaction app would make them fail silently (found in package 5, docs/plan/e1.md section 6).
'use strict';

function inTransaction(e, fn) {
  var app = e.app;
  try {
    app.runInTransaction(function (txApp) {
      e.app = txApp;
      fn(txApp);
    });
  } finally {
    e.app = app;
  }
}

module.exports = {
  inTransaction: inTransaction
};
