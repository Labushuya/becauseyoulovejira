// Pure rules of the outbox of the SPA (OF-1, ADR-0074): the identifier of an action, the time of the
// device, the expected values of a conditional change and the catalog of the codes. Pure CommonJS
// module, ES5 only, without require (Goja runtime and Vitest load it the same way); the database part
// is lib/client-ops.js.
//
// - `op_id` names one action of one account. The server notes it in client_ops in the transaction of
//   the change, so the same action sent twice changes nothing the second time.
// - `client_at` is the time of the device when the action was taken. It is kept only between 48 hours
//   before and 5 minutes after the time of the server; otherwise it is dropped and the action still
//   counts as offline. `offline: true` marks an action from the outbox without a time ("Trotzdem
//   übertragen" after 48 hours).
// - `expected` names, per changed field, the value the action was based on. A conflict is a field whose
//   stored value is neither the expected nor the desired one; other fields never conflict.
'use strict';

// The six actions of the first stage (ADR-0074 §2); also the values of client_ops.kind.
var KINDS = Object.freeze(['ticket.create', 'ticket.update', 'comment.create', 'inbox.create', 'dayplan.check', 'dayplan.uncheck']);

// Version of what GET /api/byl/tickets/create names as `offline_ops`.
var VERSION = 1;

// 16 to 64 characters, letters, digits, "_" and "-": the SPA draws 20 characters a-z0-9.
var OP_PATTERN = /^[A-Za-z0-9_-]{16,64}$/;

// The time of the device: at most 5 minutes after the server (clock skew of a phone with network time
// is seconds; 5 minutes allow a clock set by hand without taking a time from the future) and at most
// 48 hours before it (the SPA transfers on its own only within 48 hours, ADR-0074 §4).
var DEVICE_FUTURE_MS = 5 * 60 * 1000;
var DEVICE_PAST_MS = 48 * 60 * 60 * 1000;
var DEVICE_TEXT_MAX = 40;
var DEVICE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?(Z|[+-]\d{2}:\d{2})$/;

// client_ops keeps an action 30 days (the SPA deletes its own after 7, so the server is never shorter).
var RETENTION_DAYS = 30;
var DAY_MS = 24 * 60 * 60 * 1000;

// At most this many fields in `expected`, and this long a text value (the description has 100 000).
var EXPECTED_FIELDS_MAX = 30;
var EXPECTED_TEXT_MAX = 100000;

// Transient keys of a record (never stored, the Record API loads no key with "@" from a body).
var KEYS = Object.freeze({
  op: '@client_op',
  user: '@client_op_user',
  replay: '@client_op_replay',
  offline: '@offline',
  deviceAt: '@device_at',
  expected: '@expected'
});

// The catalog of the codes (ADR-0074 §6); field of the answer in brackets.
var MESSAGES = Object.freeze({
  // [op_id] wrong form of the identifier
  validation_op_invalid: 'Die Kennung der Aktion ist ungültig.',
  // [op_id] the account used the identifier for another action
  validation_op_reused: 'Diese Kennung gehört schon zu einer anderen Aktion.',
  // [op_id] the action arrived before, but its record cannot be shown any more
  validation_op_applied: 'Diese Aktion wurde schon übertragen.',
  // [expected] no object, an unknown field or a value of the wrong kind
  validation_expected_invalid: 'Die erwarteten Werte sind ungültig.',
  // [the field] the value changed meanwhile (tickets, also through the day plan)
  validation_ticket_conflict: 'Das Feld wurde inzwischen geändert.',
  // [checked] the check mark of the day plan changed meanwhile
  validation_dayplan_conflict: 'Der Haken wurde inzwischen geändert.'
});

var CONFLICT_MESSAGE = 'Das Ticket wurde inzwischen geändert.';

// Words per field of a conflict; every other field takes the text of the catalog.
var CONFLICT_TEXTS = Object.freeze({
  status: 'Der Status wurde inzwischen geändert.',
  due: 'Die Fälligkeit wurde inzwischen geändert.',
  priority: 'Die Priorität wurde inzwischen geändert.',
  assignee: 'Die Zuständigkeit wurde inzwischen geändert.',
  title: 'Der Titel wurde inzwischen geändert.',
  description: 'Die Beschreibung wurde inzwischen geändert.',
  checked: MESSAGES.validation_dayplan_conflict
});

function isMissing(value) {
  return value === undefined || value === null || value === '';
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && Object.prototype.toString.call(value) === '[object Object]';
}

/**
 * The identifier of an action from the body field `op_id`: { op: '' } without one, { op } for a valid
 * one, { op: '', code: 'validation_op_invalid' } for anything else.
 */
function opOf(raw) {
  if (isMissing(raw)) {
    return { op: '', code: '' };
  }
  if (typeof raw !== 'string' || !OP_PATTERN.test(raw)) {
    return { op: '', code: 'validation_op_invalid' };
  }
  return { op: raw, code: '' };
}

function isKind(kind) {
  return KINDS.indexOf(kind) !== -1;
}

function daysInMonth(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Milliseconds of an ISO time with "Z" or an offset (space or "T"), or NaN for anything else. */
function parseTime(raw) {
  if (typeof raw !== 'string' || raw.length > DEVICE_TEXT_MAX) {
    return NaN;
  }
  var match = DEVICE_PATTERN.exec(raw);
  if (!match) {
    return NaN;
  }
  var year = Number(match[1]);
  var month = Number(match[2]);
  var day = Number(match[3]);
  var hour = Number(match[4]);
  var minute = Number(match[5]);
  var second = match[6] === undefined ? 0 : Number(match[6]);
  var millis = match[7] === undefined ? 0 : Number((match[7] + '00').slice(0, 3));
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month) || hour > 23 || minute > 59 || second > 59) {
    return NaN;
  }
  var offset = 0;
  if (match[8] !== 'Z') {
    var sign = match[8].charAt(0) === '-' ? -1 : 1;
    var offsetHours = Number(match[8].slice(1, 3));
    var offsetMinutes = Number(match[8].slice(4, 6));
    if (offsetHours > 14 || offsetMinutes > 59) {
      return NaN;
    }
    offset = sign * (offsetHours * 60 + offsetMinutes) * 60 * 1000;
  }
  return Date.UTC(year, month - 1, day, hour, minute, second, millis) - offset;
}

/** A time in the form PocketBase stores a date: "2026-10-20 14:03:00.000Z". */
function pocketBaseTime(ms) {
  return new Date(ms).toISOString().replace('T', ' ');
}

/**
 * The time of the device to keep: the stored form of `raw` when it lies between 48 hours before and
 * 5 minutes after `now` (both included), '' otherwise (also for no time or no valid one).
 */
function deviceTimeOf(raw, now) {
  var ms = parseTime(raw);
  if (!isFinite(ms) || ms > now + DEVICE_FUTURE_MS || ms < now - DEVICE_PAST_MS) {
    return '';
  }
  return pocketBaseTime(ms);
}

/**
 * Whether a body comes from the outbox and the time of the device to keep: `offline: true` or any
 * `client_at` marks it; `deviceAt` follows deviceTimeOf. { offline: false, deviceAt: '' } otherwise.
 */
function offlineOf(body, now) {
  var source = isPlainObject(body) ? body : {};
  var hasTime = !isMissing(source.client_at);
  if (source.offline !== true && !hasTime) {
    return { offline: false, deviceAt: '' };
  }
  return { offline: true, deviceAt: hasTime ? deviceTimeOf(source.client_at, now) : '' };
}

function isExpectedValue(value) {
  if (value === null || typeof value === 'boolean' || typeof value === 'number') {
    return value === null || typeof value === 'boolean' || isFinite(value);
  }
  if (typeof value === 'string') {
    return value.length <= EXPECTED_TEXT_MAX;
  }
  if (Object.prototype.toString.call(value) === '[object Array]') {
    for (var i = 0; i < value.length; i++) {
      if (typeof value[i] !== 'string') {
        return false;
      }
    }
    return true;
  }
  return false;
}

/**
 * '' for an `expected` the server can compare (absent, or an object with at least one of `fields` and
 * values the history knows: text, number, bool, null, list of texts), else 'validation_expected_invalid'.
 */
function expectedViolation(expected, fields) {
  if (expected === undefined || expected === null) {
    return '';
  }
  if (!isPlainObject(expected)) {
    return 'validation_expected_invalid';
  }
  var names = Object.keys(expected);
  if (names.length === 0 || names.length > EXPECTED_FIELDS_MAX) {
    return 'validation_expected_invalid';
  }
  for (var i = 0; i < names.length; i++) {
    if (fields.indexOf(names[i]) === -1 || !isExpectedValue(expected[names[i]])) {
      return 'validation_expected_invalid';
    }
  }
  return '';
}

/**
 * The conflicts of a conditional change: every field of `expected` whose stored value is neither the
 * expected nor the desired one, as [{ field, expected, actual }] in the order of `expected`. All three
 * maps hold the values in one comparable form (the history serializes them, lib/history.js). The same
 * wish arrived twice is no conflict, nor is a change of a field the action does not name.
 */
function conflictsOf(expected, stored, desired) {
  var conflicts = [];
  var names = Object.keys(expected || {});
  for (var i = 0; i < names.length; i++) {
    var field = names[i];
    var actual = stored[field];
    if (actual !== expected[field] && actual !== desired[field]) {
      conflicts.push({ field: field, expected: expected[field], actual: actual });
    }
  }
  return conflicts;
}

/** The message of a conflict at `field`. */
function conflictText(field) {
  return Object.prototype.hasOwnProperty.call(CONFLICT_TEXTS, field) ? CONFLICT_TEXTS[field] : MESSAGES.validation_ticket_conflict;
}

/**
 * What an identifier the account used before means for a new request: 'replay' when it names the same
 * action (same kind; the same record when the request names one), 'reused' otherwise.
 */
function replayOf(claim, kind, record) {
  if (!claim || claim.kind !== kind) {
    return 'reused';
  }
  if (record !== '' && record !== undefined && record !== null && claim.record !== record) {
    return 'reused';
  }
  return 'replay';
}

/** The oldest `created` that stays in client_ops at `now`: 30 days back, in the stored form. */
function retentionCutoff(now) {
  return pocketBaseTime(now - RETENTION_DAYS * DAY_MS);
}

/** What GET /api/byl/tickets/create names as `offline_ops`: the version and the actions, null before the migration. */
function capabilityOf(ready) {
  return ready ? { version: VERSION, kinds: KINDS.slice() } : null;
}

module.exports = {
  KINDS: KINDS,
  VERSION: VERSION,
  KEYS: KEYS,
  MESSAGES: MESSAGES,
  CONFLICT_MESSAGE: CONFLICT_MESSAGE,
  DEVICE_FUTURE_MS: DEVICE_FUTURE_MS,
  DEVICE_PAST_MS: DEVICE_PAST_MS,
  RETENTION_DAYS: RETENTION_DAYS,
  opOf: opOf,
  isKind: isKind,
  parseTime: parseTime,
  pocketBaseTime: pocketBaseTime,
  deviceTimeOf: deviceTimeOf,
  offlineOf: offlineOf,
  expectedViolation: expectedViolation,
  conflictsOf: conflictsOf,
  conflictText: conflictText,
  replayOf: replayOf,
  retentionCutoff: retentionCutoff,
  capabilityOf: capabilityOf
};
