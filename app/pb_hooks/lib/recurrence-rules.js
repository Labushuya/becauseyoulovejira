// Pure decisions of the recurrence rule hooks (ADR-0021 section 1, ADR-0023 sections 1, 4 and 5;
// E5 plan package 2): checking the parameters, the ticket a rule is created with, and next_due
// on create, edit, pause and resume. CommonJS module, ES5 only, without require: the date
// functions of lib/recurrence.js come in as the parameter `recurrence` (Goja and Vitest load this
// module the same way). The database part is lib/recurrence-service.js.
'use strict';

// Parameters of a rule (ADR-0021 section 1); a change of one of them recomputes next_due.
var RHYTHM_FIELDS = ['mode', 'freq', 'interval', 'weekdays', 'month_day', 'anchor'];

// Written by the server only (ADR-0021 section 1); client values are overwritten.
var SERVER_FIELDS = ['next_due', 'last_generated_at', 'scope', 'last_hint'];

// Hint for rules from before E5 without a rhythm (migration 1790201600); German UI text.
var INCOMPLETE_HINT = 'Regel unvollständig – bitte Rhythmus wählen.';

var MESSAGES = {
  validation_recurrence_mode: 'Bitte „Fester Rhythmus“ oder „Nach Erledigung“ wählen.',
  validation_recurrence_freq: 'Bitte einen Rhythmus wählen.',
  validation_recurrence_interval: 'Das Intervall muss eine ganze Zahl von 1 bis 365 sein.',
  validation_recurrence_weekdays: 'Bitte mindestens einen Wochentag wählen.',
  validation_recurrence_weekdays_mode: 'Wochentage gibt es nur bei einem festen wöchentlichen Rhythmus.',
  validation_recurrence_month_day: 'Der Tag im Monat muss zwischen 1 und 31 liegen oder „Letzter Tag“ sein.',
  validation_recurrence_month_day_mode: 'Einen Tag im Monat gibt es nur bei einem festen monatlichen Rhythmus.',
  validation_recurrence_anchor: 'Bitte ein gültiges Datum für „Beginnt am“ wählen.',
  validation_recurrence_lead_days: 'Der Vorlauf muss zwischen 0 und 30 Tagen liegen.',
  validation_recurrence_ticket_missing: 'Das Ticket wurde nicht gefunden oder liegt in einem anderen Bereich.',
  validation_recurrence_ticket_done: 'Ein erledigtes Ticket kann keine Serie beginnen.',
  validation_recurrence_ticket_linked: 'Das Ticket gehört schon zu einer Serie.',
  validation_recurrence_managed: 'Eine Wiederholung entsteht über „Wiederholen…“ am Ticket.',
  validation_recurrence_open_instance:
    'Von dieser Serie ist schon ein anderes Ticket offen. Erledige es zuerst oder löse ein Ticket aus der Serie.',
  validation_recurrence_each_mode: '„Jeden Termin einzeln anlegen“ gibt es nur bei einem festen Rhythmus.',
  validation_project_archived: 'Das Projekt ist archiviert. Wähle ein anderes oder kein Projekt, um die Regel fortzusetzen.'
};

var STORED_CALENDAR_DATE = /^(\d{4}-\d{2}-\d{2}) 00:00:00\.000Z$/;

function isEmpty(value) {
  return value === undefined || value === null || value === '';
}

// Calendar date `YYYY-MM-DD` of a stored date value; '' stays ''. A value with a time of day is
// returned unchanged, so the date check rejects it (dates of rules are pure calendar dates).
function calendarDateOf(value) {
  var text = isEmpty(value) ? '' : String(value);
  var match = STORED_CALENDAR_DATE.exec(text);
  return match ? match[1] : text;
}

// Stored form of a calendar date ('' stays '').
function storedDateOf(date) {
  return isEmpty(date) ? '' : date + ' 00:00:00.000Z';
}

function sameList(a, b) {
  var left = a || [];
  var right = b || [];
  if (left.length !== right.length) {
    return false;
  }
  for (var i = 0; i < left.length; i++) {
    if (left[i] !== right[i]) {
      return false;
    }
  }
  return true;
}

// Whether the rhythm differs between two normalized rules.
function rhythmChanged(before, after) {
  for (var i = 0; i < RHYTHM_FIELDS.length; i++) {
    var field = RHYTHM_FIELDS[i];
    if (field === 'weekdays') {
      if (!sameList(before.weekdays, after.weekdays)) {
        return true;
      }
    } else if ((before[field] === null ? '' : before[field]) !== (after[field] === null ? '' : after[field])) {
      return true;
    }
  }
  return false;
}

// Field errors as { field: { code, message } } for lib/errors.js.
function fieldErrors(codes) {
  var fields = {};
  for (var field in codes) {
    if (Object.prototype.hasOwnProperty.call(codes, field)) {
      fields[field] = { code: codes[field], message: MESSAGES[codes[field]] || codes[field] };
    }
  }
  return fields;
}

function hasKeys(object) {
  for (var key in object) {
    if (Object.prototype.hasOwnProperty.call(object, key)) {
      return true;
    }
  }
  return false;
}

// Normalizes and checks the parameters: { values, errors } with the normalized rule and the field
// errors (null when valid).
function checkParams(raw, recurrence) {
  var values = recurrence.normalize(raw);
  var codes = recurrence.validate(values);
  return { values: values, errors: hasKeys(codes) ? fieldErrors(codes) : null };
}

// "Beginnt am" when the client leaves it empty: the due date of the ticket the rule starts with,
// otherwise today (ADR-0023 section 1).
function defaultAnchor(ticketDue, today) {
  return isEmpty(ticketDue) ? today : ticketDue;
}

// Checks the ticket a rule is created with (ADR-0023 section 1). `ticket` is null when it was
// not found, otherwise { scope, status, recurrence }. Returns an error code or ''.
function ticketViolation(ticket, scope) {
  if (ticket === null || ticket.scope !== scope) {
    return 'validation_recurrence_ticket_missing';
  }
  if (ticket.status === 'done') {
    return 'validation_recurrence_ticket_done';
  }
  if (!isEmpty(ticket.recurrence)) {
    return 'validation_recurrence_ticket_linked';
  }
  return '';
}

/**
 * Dates on create (ADR-0023 section 1). `input`:
 *   rule       normalized, valid rule
 *   withTicket whether the rule starts with an existing ticket
 *   ticketDue  calendar date of that ticket ('' without)
 *   today      Berlin date
 * Returns { nextDue, ticketDue }: next_due of the rule ('' for none) and the due date the ticket
 * gets (null: unchanged). A calendar rule gives a ticket without due date its first occurrence;
 * the dialog names it before, so nothing is set without the user knowing.
 */
function createDates(input, recurrence) {
  var rule = input.rule;
  if (rule.mode === 'after_completion') {
    if (input.withTicket) {
      return { nextDue: '', ticketDue: null };
    }
    return { nextDue: rule.anchor > input.today ? rule.anchor : input.today, ticketDue: null };
  }
  if (!input.withTicket) {
    return { nextDue: recurrence.onOrAfter(rule, input.today), ticketDue: null };
  }
  if (!isEmpty(input.ticketDue)) {
    return { nextDue: recurrence.after(rule, input.ticketDue), ticketDue: null };
  }
  var first = recurrence.onOrAfter(rule, rule.anchor);
  return { nextDue: recurrence.after(rule, first), ticketDue: first };
}

/**
 * next_due after a client edit (ADR-0023 sections 4 and 5). `input`:
 *   before, after   normalized rules with `active` and (before) the stored `next_due`
 *   openDue         calendar date of the open instance, '' if it has none, null without one
 *   today           Berlin date
 * A changed rhythm recomputes the date; resuming never catches up the pause. Pausing and edits
 * of the template or the lead time keep the stored date.
 */
function nextDueAfterEdit(input, recurrence) {
  var before = input.before;
  var after = input.after;
  var today = input.today;
  var next = isEmpty(before.next_due) ? '' : before.next_due;
  var hasInstance = input.openDue !== null && input.openDue !== undefined;

  if (rhythmChanged(before, after)) {
    if (after.mode === 'calendar') {
      // today - 1: createOn only subtracts days from a date.
      var yesterday = recurrence.createOn(today, 1);
      var from = hasInstance && !isEmpty(input.openDue) && input.openDue > yesterday ? input.openDue : yesterday;
      next = hasInstance ? recurrence.after(after, from) : recurrence.onOrAfter(after, today);
    } else {
      next = hasInstance ? '' : after.anchor > today ? after.anchor : today;
    }
  }

  if (!before.active && after.active) {
    if (after.mode === 'calendar') {
      var upcoming = recurrence.onOrAfter(after, today);
      next = isEmpty(next) || next < upcoming ? upcoming : next;
    } else if (!isEmpty(next) && next < today) {
      next = today;
    }
  }
  return next;
}

// Whether a client edit clears last_hint: resuming, or choosing a (new) rhythm, makes the hint
// about a paused or incomplete rule stale; so does switching "Jeden Termin einzeln anlegen", whose
// hint about the limit of a run would no longer hold.
function clearsHint(before, after) {
  return (!before.active && after.active) || rhythmChanged(before, after) || !before.each !== !after.each;
}

// "Jeden Termin einzeln anlegen" only with a fixed rhythm: after completion the next date waits for
// the completion, so there is never more than one (plan OR-5). Returns an error code or ''.
function eachViolation(mode, each) {
  return each && mode !== 'calendar' ? 'validation_recurrence_each_mode' : '';
}

// --- Generation (ADR-0022, ADR-0023 sections 3 and 6; E5 plan package 3) --------------------

/**
 * Whether a rule creates its next ticket now (ADR-0022 section 2). `input`:
 *   rule             normalized rule with `active` and `next_due`
 *   hasOpenInstance  whether a ticket of the rule is not done
 *   today            Berlin date
 * Returns null (nothing to do) or { due, nextDue }: the due date of the new ticket (the latest
 * missed occurrence of a calendar rule, never a stack) and the next_due after it ('' for after
 * completion, which waits for the completion).
 */
function generation(input, recurrence) {
  var rule = input.rule;
  if (!rule.active || isEmpty(rule.next_due) || input.hasOpenInstance || !recurrence.isValid(rule)) {
    return null;
  }
  if (input.today < recurrence.createOn(rule.next_due, rule.lead_days)) {
    return null;
  }
  if (rule.mode === 'calendar') {
    var due = recurrence.catchUp(rule, rule.next_due, input.today);
    return { due: due, nextDue: recurrence.after(rule, due) };
  }
  return { due: rule.next_due, nextDue: '' };
}

// At most so many tickets per rule and run in "Jeden Termin einzeln anlegen" (plan OR-5): after a
// long gap the dates come in batches (the next run is at most an hour away), not all at once.
var EACH_MAX_PER_RUN = 20;
var EACH_LIMIT_HINT =
  'Viele Termine auf einmal: ' +
  EACH_MAX_PER_RUN +
  ' Tickets angelegt, die übrigen folgen beim nächsten Lauf (stündlich).';

/**
 * The tickets of a rule with "Jeden Termin einzeln anlegen" (plan OR-5, ADR-0022 addendum 2).
 * `input`:
 *   rule   normalized calendar rule with `active` and `next_due`
 *   today  Berlin date
 *   limit  at most so many tickets (default EACH_MAX_PER_RUN)
 * Open instances do not matter. Returns null (nothing to do) or { dues, nextDue, limited }: one due
 * date per date whose lead time is reached, oldest first and never a date twice (next_due moves
 * past them), next_due after the last one, and whether more are waiting for the next run. The
 * loop runs over dates of the series, at most `limit` times, never over days.
 */
function generationEach(input, recurrence) {
  var rule = input.rule;
  if (!rule.active || isEmpty(rule.next_due) || rule.mode !== 'calendar' || !recurrence.isValid(rule)) {
    return null;
  }
  var limit = input.limit > 0 ? input.limit : EACH_MAX_PER_RUN;
  var due = rule.next_due;
  var dues = [];
  while (dues.length < limit && recurrence.createOn(due, rule.lead_days) <= input.today) {
    dues.push(due);
    due = recurrence.after(rule, due);
  }
  if (dues.length === 0) {
    return null;
  }
  return { dues: dues, nextDue: due, limited: recurrence.createOn(due, rule.lead_days) <= input.today };
}

/**
 * The open instances that stand against reopening one (ADR-0023 section 3, addendum OR-5).
 * `others` are the other open instances of the rule, newest first, each with its `occurrence`
 * ('' unless made by "Jeden Termin einzeln anlegen"). With one open instance per rule every other
 * open instance counts; with each date its own ticket only one of the same date, which is what
 * the unique index says (normally none).
 */
function reopenConflicts(others, reopenedOccurrence, each) {
  if (!each) {
    return others;
  }
  var same = [];
  for (var i = 0; i < others.length; i++) {
    if (others[i].occurrence === reopenedOccurrence) {
      same.push(others[i]);
    }
  }
  return same;
}

// next_due when an instance is completed (ADR-0022 section 4): the completion date plus the
// interval for after-completion rules; calendar rules keep theirs (null: unchanged).
function nextDueOnCompletion(rule, completedDate, recurrence) {
  return rule.mode === 'after_completion' ? recurrence.afterCompletion(rule, completedDate) : null;
}

// next_due when the open instance is deleted or leaves the series (ADR-0023 section 6): a calendar
// date counts as skipped (unchanged, null); after completion it is as if the instance was done
// today, so no replacement appears at once.
function nextDueOnRelease(rule, today, recurrence) {
  return rule.mode === 'after_completion' ? recurrence.afterCompletion(rule, today) : null;
}

/**
 * Whether the follow-up ticket of a reopened instance is untouched (ADR-0023 section 3): created
 * after the completion of the reopened one (the same millisecond counts as after: the follow-up
 * is written after the commit of the completion), never updated since and without comments.
 * Timestamps in the stored form `YYYY-MM-DD HH:MM:SS.sssZ`, which sorts like the time. The
 * generation writes one timestamp into created and updated (recurrence-service newInstance).
 */
function isUntouched(followUp, completedAt) {
  return (
    !isEmpty(completedAt) &&
    followUp.created >= completedAt &&
    followUp.updated === followUp.created &&
    followUp.comments === 0
  );
}

// next_due after reopening an instance (ADR-0023 section 3). `removedDue` is the due date of the
// untouched follow-up that was removed ('' if there was none). Returns the new value or null.
function nextDueOnReopen(rule, hadFollowUp, removedDue) {
  if (rule.mode === 'after_completion') {
    return '';
  }
  return hadFollowUp ? removedDue : null;
}

var OPEN_INSTANCE_MESSAGE =
  'Von dieser Serie ist schon {key} offen. Erledige es zuerst oder löse ein Ticket aus der Serie.';

function openInstanceMessage(key) {
  return OPEN_INSTANCE_MESSAGE.replace('{key}', key);
}

var ARCHIVED_HINT = 'Projekt archiviert – Regel pausiert.';
var FAILED_HINT = 'Ticket nicht erzeugt: ';
var HINT_MAX_LENGTH = 500;

// Neutral hint at a rule whose ticket could not be created; Go prefixes are removed and the text
// is cut to the field length.
function failureHint(message) {
  var text = String(message === undefined || message === null ? '' : message)
    .replace(/^(GoError|Error):\s*/, '')
    .replace(/\s+/g, ' ')
    .trim();
  var hint = FAILED_HINT + (text === '' ? 'unbekannter Fehler.' : text);
  return hint.length > HINT_MAX_LENGTH ? hint.slice(0, HINT_MAX_LENGTH - 1) + '…' : hint;
}

// A violation of the partial index means another run created the instance in the meantime; it
// counts as "already there", not as an error (ADR-0022 section 5). Since OR-5 the index covers
// (recurrence, occurrence), so PocketBase may name either field.
function isOpenInstanceConflict(message) {
  var text = String(message);
  return (
    /(recurrence|occurrence): Value must be unique/.test(text) ||
    /UNIQUE constraint failed: tickets\.recurrence/.test(text)
  );
}

module.exports = {
  ARCHIVED_HINT: ARCHIVED_HINT,
  HINT_MAX_LENGTH: HINT_MAX_LENGTH,
  EACH_MAX_PER_RUN: EACH_MAX_PER_RUN,
  EACH_LIMIT_HINT: EACH_LIMIT_HINT,
  generation: generation,
  generationEach: generationEach,
  reopenConflicts: reopenConflicts,
  eachViolation: eachViolation,
  nextDueOnCompletion: nextDueOnCompletion,
  nextDueOnRelease: nextDueOnRelease,
  isUntouched: isUntouched,
  nextDueOnReopen: nextDueOnReopen,
  openInstanceMessage: openInstanceMessage,
  failureHint: failureHint,
  isOpenInstanceConflict: isOpenInstanceConflict,
  RHYTHM_FIELDS: RHYTHM_FIELDS,
  SERVER_FIELDS: SERVER_FIELDS,
  INCOMPLETE_HINT: INCOMPLETE_HINT,
  MESSAGES: MESSAGES,
  calendarDateOf: calendarDateOf,
  storedDateOf: storedDateOf,
  rhythmChanged: rhythmChanged,
  fieldErrors: fieldErrors,
  checkParams: checkParams,
  defaultAnchor: defaultAnchor,
  ticketViolation: ticketViolation,
  createDates: createDates,
  nextDueAfterEdit: nextDueAfterEdit,
  clearsHint: clearsHint
};
