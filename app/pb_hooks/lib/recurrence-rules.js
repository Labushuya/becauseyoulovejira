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
  validation_recurrence_backlog: 'Bitte „Alle nachholen“ oder „Nur ab heute“ wählen.',
  validation_recurrence_reopen_older:
    'Von dieser Serie ist schon ein anderes Ticket offen, und dieses Ticket ist nicht das zuletzt erledigte. Du kannst es als normales Ticket wieder öffnen (aus der Serie lösen).',
  validation_recurrence_initial_status: 'Als „Status beim Anlegen“ geht jeder Status außer „Erledigt“.',
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

// "Status beim Anlegen" of the template (ADR-0022 addendum 8): every status but done, "open" as
// before when it is empty (rules from before the migration 1790202500).
var INITIAL_STATUSES = ['backlog', 'open', 'in_progress', 'waiting'];
var DEFAULT_INITIAL_STATUS = 'open';

// The status a new ticket of the rule starts with.
function initialStatusOf(value) {
  return INITIAL_STATUSES.indexOf(value) === -1 ? DEFAULT_INITIAL_STATUS : value;
}

// Code of a status the template may not have ('' when it may, an empty value included).
function initialStatusViolation(value) {
  return isEmpty(value) || INITIAL_STATUSES.indexOf(value) !== -1 ? '' : 'validation_recurrence_initial_status';
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

// A large backlog with "Jeden Termin einzeln anlegen" (plan "Wiederholungen verständlich machen",
// recommendation 5; ADR-0022 addendum 5): more than EACH_MAX_PER_RUN dates before today without a
// ticket are not made on their own. The rule waits with CATCH_UP_ASK_HINT until the user chooses
// "Alle nachholen" (CATCH_UP_ALL_HINT, then batches as before) or "Nur ab heute" (next_due to the
// first date from today on). The state is the hint of the last run: no own field, no migration.
var CATCH_UP_ASK_HINT =
  'Viele verpasste Termine: Die Regel wartet auf deine Entscheidung, ob sie alle nachholt oder erst ab heute weitermacht.';
var CATCH_UP_ALL_HINT =
  'Die verpassten Termine werden nachgeholt, höchstens ' + EACH_MAX_PER_RUN + ' je Lauf (stündlich).';
var BACKLOG_CHOICES = ['all', 'today'];

/**
 * Dates of a calendar rule from its next_due on that lie before `today` and have no ticket yet,
 * counted up to `cap` (the loop runs over dates of the series, never further). 0 without next_due.
 */
function backlogCount(rule, today, cap, recurrence) {
  if (rule.mode !== 'calendar' || isEmpty(rule.next_due) || !recurrence.isValid(rule)) {
    return 0;
  }
  var count = 0;
  var date = rule.next_due;
  while (date < today && count < cap) {
    count += 1;
    date = recurrence.after(rule, date);
  }
  return count;
}

// Whether the user chose "Alle nachholen" and the batches still go on (then nothing asks again).
function isCatchingUp(hint) {
  return hint === CATCH_UP_ALL_HINT;
}

/**
 * The tickets of a rule with "Jeden Termin einzeln anlegen" (plan OR-5, ADR-0022 addendum 2).
 * `input`:
 *   rule   normalized calendar rule with `active` and `next_due`
 *   today  Berlin date
 *   limit  at most so many tickets (default EACH_MAX_PER_RUN)
 *   hint   last_hint of the rule: while it says the rule is catching up, a backlog goes on in
 *          batches; otherwise a backlog of more than `limit` dates before today makes the rule ask
 *          (addendum 5)
 * Open instances do not matter. Returns null (nothing to do), { ask: true } (wait for a decision)
 * or { dues, nextDue, limited, hint }: one due date per date whose lead time is reached, oldest
 * first and never a date twice (next_due moves past them), next_due after the last one, whether
 * more are waiting for the next run, and the hint the rule gets (while catching up after "Alle
 * nachholen" CATCH_UP_ALL_HINT, else EACH_LIMIT_HINT with more waiting, else ''). The loop runs
 * over dates of the series, at most `limit` times, never over days.
 */
function generationEach(input, recurrence) {
  var rule = input.rule;
  if (!rule.active || isEmpty(rule.next_due) || rule.mode !== 'calendar' || !recurrence.isValid(rule)) {
    return null;
  }
  var limit = input.limit > 0 ? input.limit : EACH_MAX_PER_RUN;
  var catchingUp = isCatchingUp(input.hint);
  if (!catchingUp && backlogCount(rule, input.today, limit + 1, recurrence) > limit) {
    return { ask: true };
  }
  var due = rule.next_due;
  var dues = [];
  while (dues.length < limit && recurrence.createOn(due, rule.lead_days) <= input.today) {
    dues.push(due);
    due = recurrence.after(rule, due);
  }
  if (dues.length === 0) {
    return null;
  }
  var limited = recurrence.createOn(due, rule.lead_days) <= input.today;
  return {
    dues: dues,
    nextDue: due,
    limited: limited,
    hint: !limited ? '' : catchingUp ? CATCH_UP_ALL_HINT : EACH_LIMIT_HINT
  };
}

/**
 * The choice of the user about a backlog (addendum 5), sent with a rule as the body field
 * `backlog`. `input`:
 *   rule    normalized calendar rule with "Jeden Termin einzeln anlegen" and its next_due
 *   choice  'all' or 'today'
 *   today   Berlin date
 * Returns { nextDue, hint }: 'today' moves next_due to the first date from today on (never back)
 * and clears the hint, the dates before are skipped; 'all' keeps next_due and marks the rule as
 * catching up, so the batches of EACH_MAX_PER_RUN start without asking (only with a backlog).
 */
function backlogDecision(input, recurrence) {
  var rule = input.rule;
  var next = isEmpty(rule.next_due) ? '' : rule.next_due;
  if (input.choice === 'today') {
    var upcoming = recurrence.onOrAfter(rule, input.today);
    return { nextDue: next === '' || next < upcoming ? upcoming : next, hint: '' };
  }
  return { nextDue: next, hint: backlogCount(rule, input.today, 1, recurrence) > 0 ? CATCH_UP_ALL_HINT : '' };
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

// Reopening a done instance that is not the one completed last (plan "Wiederholungen
// verständlich machen", recommendation 1): the open follow-up came from a later completion, so it
// is never removed silently; the ticket may come back as a normal ticket instead.
var REOPEN_OLDER_MESSAGE =
  'Von dieser Serie ist schon {key} offen, und dieses Ticket ist nicht das zuletzt erledigte. ' +
  'Du kannst es als normales Ticket wieder öffnen (aus der Serie lösen).';

function reopenOlderMessage(key) {
  return REOPEN_OLDER_MESSAGE.replace('{key}', key);
}

/**
 * What reopening a done instance does (ADR-0023 section 3 with addenda 2 and 4). `input`:
 *   conflicts  number of open instances that stand against it (reopenConflicts)
 *   untouched  whether the newest of them is untouched (isUntouched)
 *   direct     whether the reopened ticket is the instance completed last, i.e. the one whose
 *              completion made the open follow-up (always true with "Jeden Termin einzeln
 *              anlegen", which keeps its behaviour)
 * Returns 'free' (nothing stands against it), 'remove' (the untouched follow-up of the direct
 * predecessor goes), 'refuse_older' (an older instance: the follow-up stays, whatever its state)
 * or 'refuse_open' (the follow-up was edited, or several are open).
 */
function reopenOutcome(input) {
  if (input.conflicts === 0) {
    return 'free';
  }
  if (!input.direct) {
    return 'refuse_older';
  }
  return input.conflicts === 1 && input.untouched ? 'remove' : 'refuse_open';
}

// Whether the reopened instance is the one completed last (stored timestamps sort like the time):
// `latestOther` is completed_at of the newest other done instance of the rule ('' without one).
function isDirectPredecessor(completedAt, latestOther) {
  return isEmpty(latestOther) || latestOther <= completedAt;
}

// --- Missed dates made into one ticket (recommendation 3) -----------------------------------

// History field of the note on a ticket that stands for several missed dates; old value the rule,
// new value the JSON of skippedDates(). No schema field: ticket_history.field is free text.
var SKIPPED_FIELD = 'recurrence_skipped';
// Dates listed in the note at most; the count stays exact up to SKIPPED_COUNT_MAX.
var SKIPPED_DATES_MAX = 5;
var SKIPPED_COUNT_MAX = 1000;

/**
 * The dates of a calendar rule that one catch-up ticket stands for besides its own (ADR-0022
 * section 3): every occurrence from `pendingDue` (the stored next_due) up to, not including, `due`.
 * Returns null when nothing was skipped, else { count, dates, more }: at most SKIPPED_DATES_MAX
 * dates, oldest first, `more` when the count stopped at SKIPPED_COUNT_MAX. The loop runs over
 * dates of the series and is capped, never over days.
 */
function skippedDates(rule, pendingDue, due, recurrence) {
  if (rule.mode !== 'calendar' || isEmpty(pendingDue) || !(pendingDue < due)) {
    return null;
  }
  var dates = [];
  var count = 0;
  var date = pendingDue;
  while (date < due && count < SKIPPED_COUNT_MAX) {
    if (dates.length < SKIPPED_DATES_MAX) {
      dates.push(date);
    }
    count += 1;
    date = recurrence.after(rule, date);
  }
  return { count: count, dates: dates, more: date < due };
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
  CATCH_UP_ASK_HINT: CATCH_UP_ASK_HINT,
  CATCH_UP_ALL_HINT: CATCH_UP_ALL_HINT,
  BACKLOG_CHOICES: BACKLOG_CHOICES,
  backlogCount: backlogCount,
  backlogDecision: backlogDecision,
  generation: generation,
  generationEach: generationEach,
  reopenConflicts: reopenConflicts,
  eachViolation: eachViolation,
  nextDueOnCompletion: nextDueOnCompletion,
  nextDueOnRelease: nextDueOnRelease,
  isUntouched: isUntouched,
  nextDueOnReopen: nextDueOnReopen,
  openInstanceMessage: openInstanceMessage,
  reopenOlderMessage: reopenOlderMessage,
  reopenOutcome: reopenOutcome,
  isDirectPredecessor: isDirectPredecessor,
  SKIPPED_FIELD: SKIPPED_FIELD,
  SKIPPED_DATES_MAX: SKIPPED_DATES_MAX,
  SKIPPED_COUNT_MAX: SKIPPED_COUNT_MAX,
  skippedDates: skippedDates,
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
  INITIAL_STATUSES: INITIAL_STATUSES,
  DEFAULT_INITIAL_STATUS: DEFAULT_INITIAL_STATUS,
  initialStatusOf: initialStatusOf,
  initialStatusViolation: initialStatusViolation,
  ticketViolation: ticketViolation,
  createDates: createDates,
  nextDueAfterEdit: nextDueAfterEdit,
  clearsHint: clearsHint
};
