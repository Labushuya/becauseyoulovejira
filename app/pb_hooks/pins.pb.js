/// <reference path="../pb_data/types.d.ts" />
// Pinned tickets (PIN-1, ADR-0064). Reading, creating and deleting the own pins are API rules
// (migration 1790204500); these hooks keep them right. The logic lives in lib/pin-service.js.
// Completing a ticket and moving it to the trash release its pins in tickets.pb.js and
// lib/trash-service.js, a move between the areas in lib/area-move-service.js.

// Model hook: every writer, the superuser included; a done ticket is never pinned.
onRecordCreate(function (e) {
  require(`${__hooks}/lib/pin-service.js`).checkCreate(e.app, e.record);
  e.next();
}, 'ticket_pins');

// Model hook: a membership that ends (leaving, being removed, dissolving or deleting the household)
// takes the pins of its account on the tickets of that household along, in the same transaction.
onRecordDelete(function (e) {
  var service = require(`${__hooks}/lib/pin-service.js`);
  require(`${__hooks}/lib/transaction.js`).inTransaction(e, function (txApp) {
    service.releaseMembership(txApp, e.record);
    e.next();
  });
}, 'household_members');
