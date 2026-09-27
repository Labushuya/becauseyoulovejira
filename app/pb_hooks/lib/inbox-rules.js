// Pure rules of the inbox hook (ADR-0014 sections 1 and 3). CommonJS module, ES5 only, no
// dependencies (Goja runtime and Vitest), like ticket-rules.js.
'use strict';

var TITLE_MAX_LENGTH = 200;
var BODY_MAX_LENGTH = 100000;
var ELLIPSIS = '…';

var TRANSITION = 'validation_inbox_transition';
var HANDLED = 'validation_inbox_item_handled';
var TICKET_REQUIRED = 'validation_inbox_ticket_required';

function text(value) {
  return value === undefined || value === null ? '' : String(value);
}

function isHighSurrogate(code) {
  return code >= 0xd800 && code <= 0xdbff;
}

// Cuts `value` to at most `max` characters, the last one being "…". Never splits a surrogate
// pair, so the result has at most `max` characters in UTF-16 and in code points (PocketBase
// counts code points).
function truncate(value, max) {
  var input = text(value);
  if (input.length <= max) {
    return input;
  }
  var end = max - 1;
  if (end > 0 && isHighSurrogate(input.charCodeAt(end - 1))) {
    end -= 1;
  }
  return input.slice(0, end) + ELLIPSIS;
}

// Titles come from subjects, file names and chat lines: whitespace runs (line breaks included)
// become one space, then the title is cut to TITLE_MAX_LENGTH.
function normalizeTitle(value) {
  return truncate(text(value).replace(/\s+/g, ' ').replace(/^ | $/g, ''), TITLE_MAX_LENGTH);
}

function normalizeBody(value) {
  return truncate(value, BODY_MAX_LENGTH);
}

// Only http(s) links are stored (E4 plan, section 3); an empty value is allowed.
function isAllowedSourceUrl(value) {
  var url = text(value);
  return url === '' || /^https?:\/\/[^\s]+$/i.test(url);
}

/**
 * Checks a change of state and ticket by a client (ADR-0014 section 1, ADR-0031 section 2).
 * before/after: { state, ticket }. Returns '' or { field, code }:
 * - new <-> discarded, the ticket stays empty;
 * - new -> converted only together with a ticket (linking, also "Dem Ticket zuordnen");
 * - converted -> new only with an empty ticket (releasing; that the item is not the main source
 *   of its ticket checks the service in the transaction);
 * - otherwise converted stays as it is: no other ticket, no discarding.
 */
function transitionViolation(before, after) {
  var from = text(before.state);
  var to = text(after.state);
  var ticketChanged = text(before.ticket) !== text(after.ticket);
  if (from === 'converted') {
    if (to === 'new' && text(after.ticket) === '') {
      return '';
    }
    return to !== from || ticketChanged ? { field: 'state', code: HANDLED } : '';
  }
  if (to === 'converted') {
    if (from !== 'new') {
      return { field: 'state', code: TRANSITION };
    }
    return text(after.ticket) === '' ? { field: 'ticket', code: TICKET_REQUIRED } : '';
  }
  if (ticketChanged) {
    return { field: 'ticket', code: TRANSITION };
  }
  return '';
}

// handled_at follows the state: set when an item is converted or discarded, cleared when it
// comes back to new, kept otherwise.
function handledAtAction(beforeState, afterState) {
  if (text(beforeState) === text(afterState)) {
    return 'keep';
  }
  return afterState === 'new' ? 'clear' : 'set';
}

/**
 * What a saved change of state means for the sources of a ticket (ADR-0031 section 2):
 * 'link' (new -> converted), 'release' (converted -> new) or '' for anything else.
 */
function linkChange(beforeState, afterState) {
  var from = text(beforeState);
  var to = text(afterState);
  if (from === 'new' && to === 'converted') {
    return 'link';
  }
  if (from === 'converted' && to === 'new') {
    return 'release';
  }
  return '';
}

/**
 * Value of the history entry "source_link" (ADR-0031 section 2): the item as JSON with id,
 * channel and title, so the history stays readable after the item is released.
 */
function sourceLinkValue(item) {
  return JSON.stringify({ item: text(item.id), channel: text(item.channel), title: text(item.title) });
}

// Message of a duplicate (ADR-0014 section 3): "schon im Eingang", "schon verworfen",
// "schon Ticket HAUS-12".
function duplicateMessage(state, ticketKey) {
  if (state === 'discarded') {
    return 'Schon verworfen.';
  }
  if (state === 'converted') {
    return ticketKey ? 'Schon Ticket ' + ticketKey + '.' : 'Schon umgewandelt.';
  }
  return 'Schon im Eingang.';
}

module.exports = {
  TITLE_MAX_LENGTH: TITLE_MAX_LENGTH,
  BODY_MAX_LENGTH: BODY_MAX_LENGTH,
  truncate: truncate,
  normalizeTitle: normalizeTitle,
  normalizeBody: normalizeBody,
  isAllowedSourceUrl: isAllowedSourceUrl,
  transitionViolation: transitionViolation,
  handledAtAction: handledAtAction,
  linkChange: linkChange,
  sourceLinkValue: sourceLinkValue,
  duplicateMessage: duplicateMessage
};
