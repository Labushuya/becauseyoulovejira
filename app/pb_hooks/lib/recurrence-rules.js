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
// about a paused or incomplete rule stale.
function clearsHint(before, after) {
  return (!before.active && after.active) || rhythmChanged(before, after);
}

module.exports = {
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
