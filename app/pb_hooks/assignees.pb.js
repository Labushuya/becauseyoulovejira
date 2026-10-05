/// <reference path="../pb_data/types.d.ts" />
// "Zuständig" in the household (E7-5, ADR-0068). Checking the assignee of a ticket and of a rule, the
// read row and the notice of an assignment by someone else and the person of every new occurrence run
// in the hooks of tickets and rules (tickets.pb.js, recurrence.pb.js); the logic lives in
// lib/assignee-service.js, the pure rules in lib/assignee-rules.js.

// Model hook: a membership that ends (leaving, being removed, dissolving or deleting the household)
// takes its person out of every ticket and rule of that household, in the same transaction, with
// "Zuständigkeit entfernt" in the history of each ticket.
onRecordDelete(function (e) {
  var service = require(`${__hooks}/lib/assignee-service.js`);
  require(`${__hooks}/lib/transaction.js`).inTransaction(e, function (txApp) {
    e.next();
    service.releaseMembership(txApp, e.record);
  });
}, 'household_members');
