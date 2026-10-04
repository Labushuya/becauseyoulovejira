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

// Line breaks as LF, then cut to BODY_MAX_LENGTH. A browser (and Node) sends the fields of a form
// upload with CRLF (multipart/form-data, HTML standard), so an entry with an original file got its
// text with CRLF, the same entry through JSON with LF; a ticket made from it mixed both and lost
// one character of its limit per line (plan robuste-skripte RS-3).
function normalizeBody(value) {
  return truncate(text(value).replace(/\r\n?/g, '\n'), BODY_MAX_LENGTH);
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
 * - converted -> converted with another, non-empty ticket (moving to another ticket, "Anderem
 *   Ticket zuordnen …"; the main source and the scope of the ticket are checked by the service);
 * - otherwise converted stays as it is: no empty ticket, no discarding.
 */
function transitionViolation(before, after) {
  var from = text(before.state);
  var to = text(after.state);
  var ticketChanged = text(before.ticket) !== text(after.ticket);
  if (from === 'converted') {
    if (to === 'new' && text(after.ticket) === '') {
      return '';
    }
    if (to === 'converted' && ticketChanged && text(after.ticket) !== '') {
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
 * What a saved change of state and ticket means for the sources of a ticket (ADR-0031 section 2).
 * before/after: { state, ticket }. Returns
 * - 'link': new -> converted, or a converted item whose ticket was deleted gets a ticket again;
 * - 'release': converted -> new;
 * - 'move': a converted item changes from one ticket to another;
 * - '' for anything else.
 */
function linkChange(before, after) {
  var from = text(before.state);
  var to = text(after.state);
  if (from === 'new' && to === 'converted') {
    return 'link';
  }
  if (from === 'converted' && to === 'new') {
    return 'release';
  }
  if (from === 'converted' && to === 'converted' && text(after.ticket) !== text(before.ticket)) {
    if (text(after.ticket) === '') {
      return '';
    }
    return text(before.ticket) === '' ? 'link' : 'move';
  }
  return '';
}

/**
 * Value of the history entry "source_link" (ADR-0031 section 2): the item as JSON with id,
 * channel and title, so the history stays readable after the item is released. A move names the
 * other ticket (`moved_to` in the old ticket, `moved_from` in the new one) with ID and key at the
 * time of the move.
 */
function sourceLinkValue(item, move) {
  var value = { item: text(item.id), channel: text(item.channel), title: text(item.title) };
  if (move && (move.direction === 'to' || move.direction === 'from')) {
    value[move.direction === 'to' ? 'moved_to' : 'moved_from'] = {
      ticket: text(move.ticket),
      key: text(move.key)
    };
  }
  return JSON.stringify(value);
}

/**
 * What happens to the sources of a deleted ticket (ADR-0031, addendum B): 'inbox' (back to the
 * new ones, the default of every way to delete) or 'discard' (tombstone). Never deleted with it.
 */
var SOURCE_HANDLINGS = ['inbox', 'discard'];
var DEFAULT_SOURCE_HANDLING = 'inbox';

function isSourceHandling(value) {
  return SOURCE_HANDLINGS.indexOf(value) !== -1;
}

// Key of source_meta that tells an item its ticket was deleted: { key, at }.
var TICKET_DELETED = 'ticket_deleted';

/**
 * source_meta of an item whose ticket was deleted: a copy of `meta` with ticket_deleted = { key,
 * at } (key of the ticket, time in PocketBase format). Other keys stay. Since the trash
 * (ADR-0037) `ticketId` adds `ticket`, the ID of the ticket in the trash, so the SPA can point
 * there and a restore finds the item again.
 */
function deletedTicketMeta(meta, key, at, ticketId) {
  var copy = {};
  var source = meta && typeof meta === 'object' ? meta : {};
  for (var name in source) {
    if (Object.prototype.hasOwnProperty.call(source, name)) {
      copy[name] = source[name];
    }
  }
  copy[TICKET_DELETED] = { key: text(key), at: text(at) };
  if (text(ticketId) !== '') {
    copy[TICKET_DELETED].ticket = text(ticketId);
  }
  return copy;
}

/** A copy of `meta` without the note of a deleted ticket, or null if it has none. */
function withoutDeletedTicket(meta) {
  if (!meta || typeof meta !== 'object' || !Object.prototype.hasOwnProperty.call(meta, TICKET_DELETED)) {
    return null;
  }
  var copy = {};
  for (var name in meta) {
    if (name !== TICKET_DELETED && Object.prototype.hasOwnProperty.call(meta, name)) {
      copy[name] = meta[name];
    }
  }
  return copy;
}

// State of a duplicate whose entry moved out of the area (E7-4b, ADR-0061 addendum E7-4b): the area
// still knows its fingerprint (inbox_moved_fingerprints), but no entry of it is there any more.
var MOVED_STATE = 'moved';

// Message of a duplicate (ADR-0014 section 3): "schon im Eingang", "schon verworfen",
// "schon Ticket HAUS-12", and for an entry moved into another area "In einen anderen Bereich
// verschoben.".
function duplicateMessage(state, ticketKey) {
  if (state === MOVED_STATE) {
    return 'In einen anderen Bereich verschoben.';
  }
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
  SOURCE_HANDLINGS: SOURCE_HANDLINGS,
  DEFAULT_SOURCE_HANDLING: DEFAULT_SOURCE_HANDLING,
  isSourceHandling: isSourceHandling,
  TICKET_DELETED: TICKET_DELETED,
  deletedTicketMeta: deletedTicketMeta,
  withoutDeletedTicket: withoutDeletedTicket,
  MOVED_STATE: MOVED_STATE,
  duplicateMessage: duplicateMessage
};
