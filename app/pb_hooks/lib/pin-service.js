// Pinned tickets (PIN-1, ADR-0064), the database part. CommonJS module, ES5 only, Goja runtime
// only. The pure decisions are in lib/pin-rules.js.
//
// A pin (collection ticket_pins: user, ticket, created) is personal; the API rules let an account
// read, create and delete only its own pins, and only on tickets it sees. The hooks release pins:
// every pin of a ticket when it is completed (tickets.pb.js, in the transaction of the update)
// or moved to the trash (lib/trash-service.js), the pins of an account on the tickets of a household
// it leaves or is removed from (pins.pb.js), and after a move between the areas the pins of
// accounts that no longer see the ticket (lib/area-move-service.js). Every pin goes through
// txApp.delete, so the tabs of its account get the "delete" by realtime after the commit. Before
// the migration 1790204500 the collection is missing and nothing happens.
'use strict';

var rules = require(__hooks + '/lib/pin-rules.js');
var errors = require(__hooks + '/lib/errors.js');

var PINS = 'ticket_pins';
var TICKETS = 'tickets';

/** True once the migration of the pins ran (the running instance may still miss it). */
function pinsReady(app) {
  try {
    app.findCollectionByNameOrId(PINS);
    return true;
  } catch (err) {
    return false;
  }
}

function findById(app, collection, id) {
  if (!id) {
    return null;
  }
  try {
    return app.findRecordById(collection, id);
  } catch (err) {
    return null;
  }
}

function listOf(found) {
  var list = [];
  for (var i = 0; i < found.length; i++) {
    list.push(found[i]);
  }
  return list;
}

function pinsOf(app, filter, params) {
  return listOf(app.findRecordsByFilter(PINS, filter, 'created,id', 0, 0, params));
}

function deleteAll(app, pins) {
  for (var i = 0; i < pins.length; i++) {
    app.delete(pins[i]);
  }
  return pins.length;
}

/**
 * onRecordCreate of ticket_pins, for every writer: a done ticket is never pinned
 * (validation_pin_done at the field `ticket`). A missing ticket is the error of the relation.
 */
function checkCreate(app, record) {
  var ticket = findById(app, TICKETS, record.getString('ticket'));
  if (!ticket) {
    return;
  }
  var code = rules.pinViolation(ticket.getString('status'));
  if (code !== '') {
    throw errors.fieldFailure('ticket', code, rules.MESSAGES[code]);
  }
}

/** Every pin of a ticket, of every account. Returns how many went. */
function releaseTicket(txApp, ticketId) {
  if (!pinsReady(txApp)) {
    return 0;
  }
  return deleteAll(txApp, pinsOf(txApp, 'ticket = {:ticket}', { ticket: ticketId }));
}

/**
 * onRecordUpdate of tickets before e.next(): whether the update completes the ticket, so that
 * releaseTicket runs after the save in the same transaction (every pin of every account goes).
 * Reopening pins nothing again.
 */
function completes(record) {
  return rules.releasesPins(record.original().getString('status'), record.getString('status'));
}

/**
 * onRecordDelete of household_members (leaving, being removed, dissolving, deleting a household):
 * the pins of that account on the tickets of that household. The API rules hide them anyway; this
 * keeps nothing behind that would show again after joining once more.
 */
function releaseMembership(txApp, membership) {
  if (!pinsReady(txApp)) {
    return 0;
  }
  var household = membership.getString('household');
  if (household === '') {
    return 0;
  }
  return deleteAll(
    txApp,
    pinsOf(txApp, 'user = {:user} && ticket.household = {:household}', {
      user: membership.getString('user'),
      household: household
    })
  );
}

function memberIdsOf(txApp, household, cache) {
  if (!Object.prototype.hasOwnProperty.call(cache, household)) {
    var members = txApp.findRecordsByFilter('household_members', 'household = {:h}', '', 0, 0, { h: household });
    var ids = [];
    for (var i = 0; i < members.length; i++) {
      ids.push(members[i].getString('user'));
    }
    cache[household] = ids;
  }
  return cache[household];
}

/**
 * After a move between the areas (ADR-0061), in its transaction: a pin stays as long as its account
 * still sees the ticket (pin-rules.seesTicket); the pins of everyone else on the moved tickets go.
 */
function releaseUnseen(txApp, ticketIds) {
  if (ticketIds.length === 0 || !pinsReady(txApp)) {
    return 0;
  }
  var count = 0;
  var cache = {};
  for (var i = 0; i < ticketIds.length; i++) {
    var pins = pinsOf(txApp, 'ticket = {:ticket}', { ticket: ticketIds[i] });
    if (pins.length === 0) {
      continue;
    }
    var ticket = findById(txApp, TICKETS, ticketIds[i]);
    if (!ticket) {
      continue;
    }
    var household = ticket.getString('household');
    var members = household === '' ? [] : memberIdsOf(txApp, household, cache);
    for (var p = 0; p < pins.length; p++) {
      if (!rules.seesTicket(pins[p].getString('user'), ticket.getString('owner'), household, members)) {
        txApp.delete(pins[p]);
        count++;
      }
    }
  }
  return count;
}

module.exports = {
  pinsReady: pinsReady,
  checkCreate: checkCreate,
  releaseTicket: releaseTicket,
  completes: completes,
  releaseMembership: releaseMembership,
  releaseUnseen: releaseUnseen
};
