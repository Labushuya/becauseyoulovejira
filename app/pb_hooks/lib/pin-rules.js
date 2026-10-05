// Pinned tickets (PIN-1, ADR-0064), the pure decisions. CommonJS module, ES5 only, no PocketBase
// globals, so the unit tests load it directly (tests/unit/pin-rules.test.mjs). The database part is
// lib/pin-service.js.
'use strict';

var DONE = 'done';

// Texts of the refusals; the SPA shows the message of the server as it is.
var MESSAGES = {
  validation_pin_done: 'Erledigte Tickets lassen sich nicht anheften.'
};

/**
 * Whether a change of the status releases every pin of the ticket, for every account: it becomes
 * done. Reopening pins nothing again.
 */
function releasesPins(statusBefore, statusAfter) {
  return statusBefore !== DONE && statusAfter === DONE;
}

/** Code of a refused new pin, '' when the ticket may be pinned: a done ticket never is. */
function pinViolation(ticketStatus) {
  return ticketStatus === DONE ? 'validation_pin_done' : '';
}

/**
 * Whether an account sees a ticket (the rules of 1790203900, without the trash): the owner of a
 * private ticket, a member of the household of a household ticket. `memberIds` are the accounts of
 * that household; an owner who left it no longer sees its tickets (ADR-0058 §5).
 */
function seesTicket(userId, owner, household, memberIds) {
  if (household === '') {
    return userId !== '' && userId === owner;
  }
  return memberIds.indexOf(userId) !== -1;
}

module.exports = {
  MESSAGES: MESSAGES,
  releasesPins: releasesPins,
  pinViolation: pinViolation,
  seesTicket: seesTicket
};
