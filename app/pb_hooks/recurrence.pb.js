/// <reference path="../pb_data/types.d.ts" />
// Recurrence rule hooks (CLAUDE.md section 6, ADR-0021 to ADR-0023; E5 plan packages 2 and 3). The
// logic lives in lib/recurrence-service.js and lib/recurrence-rules.js; handlers run in isolated
// scopes, so modules are required inside them. Create and update run in their own transaction
// (lib/transaction.js): a rule created with `ticket` and the link of that ticket are written
// together or not at all. Before the E5 migrations (no `freq` yet) every handler only calls
// e.next(), so rules behave as in E4.

onRecordCreateRequest(function (e) {
  var service = require(`${__hooks}/lib/recurrence-service.js`);
  if (service.schemaReady(e.app)) {
    service.prepareCreateRequest(e);
  }
  e.next();
}, 'recurrence_rules');

onRecordUpdateRequest(function (e) {
  var service = require(`${__hooks}/lib/recurrence-service.js`);
  if (service.schemaReady(e.app)) {
    service.prepareUpdateRequest(e);
  }
  e.next();
}, 'recurrence_rules');

onRecordCreate(function (e) {
  var service = require(`${__hooks}/lib/recurrence-service.js`);
  if (!service.schemaReady(e.app)) {
    e.next();
    return;
  }
  require(`${__hooks}/lib/transaction.js`).inTransaction(e, function (txApp) {
    var prepared = service.prepareCreate(txApp, e.record, Date.now());
    e.next();
    service.completeCreate(txApp, e.record, prepared);
  });
}, 'recurrence_rules');

onRecordUpdate(function (e) {
  var service = require(`${__hooks}/lib/recurrence-service.js`);
  if (!service.schemaReady(e.app)) {
    e.next();
    return;
  }
  require(`${__hooks}/lib/transaction.js`).inTransaction(e, function (txApp) {
    service.prepareUpdate(txApp, e.record, Date.now());
    e.next();
  });
}, 'recurrence_rules');

// E5 plan, package 3 (ADR-0022): a new, resumed or changed rule whose ticket is due already gets
// it right after the commit; materialize never throws and does nothing before the migrations.
onRecordAfterCreateSuccess(function (e) {
  e.next();
  require(`${__hooks}/lib/recurrence-service.js`).afterRuleSaved(e.app, e.record, Date.now());
}, 'recurrence_rules');

onRecordAfterUpdateSuccess(function (e) {
  e.next();
  require(`${__hooks}/lib/recurrence-service.js`).afterRuleSaved(e.app, e.record, Date.now());
}, 'recurrence_rules');

// Hourly in UTC at minute 7: a Berlin day starts at 22:00 or 23:00 UTC depending on summer time
// (ADR-0005 section 5), so a ticket with lead time 0 appears at most about an hour after Berlin
// midnight. runDue never throws; the guard only keeps a broken module from ending the job.
cronAdd('byl-recurrence', '7 * * * *', function () {
  try {
    require(`${__hooks}/lib/recurrence-service.js`).runDue($app, Date.now());
  } catch (err) {
    $app.logger().error('Wiederholungen: Cron-Lauf gescheitert', 'error', String(err));
  }
});

// Catch-up at the start (ADR-0022 section 4, T-10): after e.next() of onBootstrap, only for
// `serve`. The JSVM of PocketBase 0.40.4 has no onServe, and `pocketbase serve` runs pending app
// migrations only after onBootstrap (E5 plan, section 7): at the first start after an update with
// new migrations the schema is not there yet, runDue does nothing, and the cron job catches up
// within the hour. Due tickets, then the cleanup of discarded inbox items. Nothing here may throw,
// or the server would not start.
onBootstrap(function (e) {
  e.next();
  try {
    if ($os.args.indexOf('serve') !== -1) {
      require(`${__hooks}/lib/recurrence-service.js`).runStartup(e.app, Date.now());
    }
  } catch (err) {
    e.app.logger().error('Nachholen beim Start gescheitert', 'error', String(err));
  }
});
