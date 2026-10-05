// Pure rules of the day plan (TP-1, ADR-0065): the kind of a ticket, the sources of suggestions with
// their modes, the suggestions of a day, what a check mark means, which days can be planned and the
// order of the entries. CommonJS module, ES5 only, no dependencies (Goja runtime and Vitest); the
// SPA mirrors it in web/src/lib/domain/day-plan.ts (tests/unit/web-day-plan.test.mjs keeps both equal).
//
// Calendar dates are `YYYY-MM-DD` strings of the Berlin day (ADR-0005); the caller passes "today" as
// lib/berlin-time.js computes it, the same function and zone as "Heute fällig" of the list.
'use strict';

var CALENDAR_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

// --- Kind of a ticket --------------------------------------------------------------------------

// "Aufgabe" (the default) or "Laufendes Vorhaben". The kind alone decides what a check mark in the
// plan means: a task is completed, an ongoing project is only checked for the day.
var KINDS = Object.freeze(['task', 'ongoing']);
var DEFAULT_KIND = 'task';

/** The kind of a stored value: 'ongoing' or else 'task' (empty before the migration). */
function kindOf(value) {
  return value === 'ongoing' ? 'ongoing' : DEFAULT_KIND;
}

// --- Sources and modes -------------------------------------------------------------------------

// The sources of suggestions in the order of the settings.
var SOURCES = Object.freeze(['ongoing', 'due_today', 'overdue', 'recurrence', 'leftover', 'in_progress']);
var MODES = Object.freeze(['off', 'suggest', 'auto']);
var DEFAULT_SOURCES = Object.freeze({
  ongoing: 'auto',
  due_today: 'suggest',
  overdue: 'suggest',
  recurrence: 'suggest',
  leftover: 'suggest',
  in_progress: 'suggest'
});
// Where an entry came from: by hand or from a source.
var ORIGINS = Object.freeze(['manual', 'due_today', 'overdue', 'recurrence', 'leftover', 'in_progress', 'ongoing']);
// The reason a suggestion names first when a ticket matches several sources: the most specific one.
var PRECEDENCE = Object.freeze(['ongoing', 'recurrence', 'leftover', 'overdue', 'due_today', 'in_progress']);

var MODE_RANK = { off: 0, suggest: 1, auto: 2 };
var PRIORITY_RANK = { urgent: 0, high: 1, medium: 2, low: 3 };

function has(object, key) {
  return object !== null && typeof object === 'object' && Object.prototype.hasOwnProperty.call(object, key);
}

/**
 * The modes of every source from a stored or sent value: a known mode per known source, the default
 * for everything missing or unknown. Never throws.
 */
function settingsOf(raw) {
  var result = {};
  for (var i = 0; i < SOURCES.length; i++) {
    var source = SOURCES[i];
    var value = has(raw, source) ? raw[source] : undefined;
    result[source] = MODES.indexOf(value) !== -1 ? value : DEFAULT_SOURCES[source];
  }
  return result;
}

/**
 * The sources of a request: an object with known sources only, each with a known mode (missing ones
 * keep their stored mode). Returns '' or the code of the problem.
 */
function sourcesViolation(input) {
  if (input === null || typeof input !== 'object' || Object.prototype.toString.call(input) === '[object Array]') {
    return 'validation_dayplan_sources';
  }
  for (var key in input) {
    if (!has(input, key)) {
      continue;
    }
    if (SOURCES.indexOf(key) === -1 || MODES.indexOf(input[key]) === -1) {
      return 'validation_dayplan_sources';
    }
  }
  return '';
}

// --- Suggestions -------------------------------------------------------------------------------

/**
 * The series a ticket stands for alone (WH-1): its rule, unless it was made with "Verpasste Termine
 * nachholen" (`occurrence` set, every date its own ticket that counts on its own); '' without a rule.
 */
function seriesKeyOf(recurrence, occurrence) {
  return recurrence && !occurrence ? String(recurrence) : '';
}

function utcOf(date) {
  var match = CALENDAR_DATE.exec(String(date));
  return match ? Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) : NaN;
}

function isCalendarDate(value) {
  var ms = utcOf(value);
  if (!isFinite(ms)) {
    return false;
  }
  var date = new Date(ms);
  var month = date.getUTCMonth() + 1;
  var day = date.getUTCDate();
  var text = date.getUTCFullYear() + '-' + (month < 10 ? '0' : '') + month + '-' + (day < 10 ? '0' : '') + day;
  return text === value;
}

function contains(list, value) {
  return list !== null && list !== undefined && list.indexOf(value) !== -1;
}

/**
 * The sources a ticket matches on `today`, in the order of PRECEDENCE, whatever their modes. Only an
 * open ticket matches. `ticket`: { id, status, due ('' or a calendar date), kind, recurring, series
 * (see seriesKeyOf; suggestionsOf reads it) }.
 * `leftover`: IDs of the entries of yesterday that were neither done nor checked for the day.
 * - ongoing: the kind is "Laufendes Vorhaben".
 * - recurrence: a ticket of a series that is due today.
 * - leftover: left over from the plan of yesterday.
 * - overdue: due before today.
 * - due_today: due today, the same as "Heute fällig" of the list (domain/filter.ts dueBucket).
 * - in_progress: the status "In Arbeit".
 */
function matchingSources(ticket, today, leftover) {
  if (!ticket || ticket.status === 'done') {
    return [];
  }
  var due = ticket.due || '';
  var matches = {
    ongoing: kindOf(ticket.kind) === 'ongoing',
    recurrence: !!ticket.recurring && due === today,
    leftover: contains(leftover, ticket.id),
    overdue: due !== '' && due < today,
    due_today: due === today,
    in_progress: ticket.status === 'in_progress'
  };
  var result = [];
  for (var i = 0; i < PRECEDENCE.length; i++) {
    if (matches[PRECEDENCE[i]]) {
      result.push(PRECEDENCE[i]);
    }
  }
  return result;
}

/**
 * "05.10." in the year of `today`, else "05.10.2025": the short date of the SPA (shortDate in
 * domain/recurrence-text.ts).
 */
function shortDate(date, today) {
  var parts = String(date).split('-');
  var year = String(today).split('-')[0];
  return parts[2] + '.' + parts[1] + '.' + (parts[0] === year ? '' : parts[0]);
}

/**
 * "überfällig seit 05.10.": an overdue ticket names the day it is overdue since, its due date, the
 * same text as the list and the detail (WH-1; domain/due-label.ts overdueSinceText). A carried
 * occurrence of a series keeps the date of its oldest missed date as its due date.
 */
function overdueSinceText(due, today) {
  return 'überfällig seit ' + shortDate(due, today);
}

/** Text of a reason, e.g. "überfällig seit 05.10.". */
function reasonText(source, ticket, today) {
  switch (source) {
    case 'ongoing':
      return 'laufendes Vorhaben';
    case 'recurrence':
      return 'Wiederholung';
    case 'leftover':
      return 'übrig von gestern';
    case 'overdue':
      return overdueSinceText(ticket.due, today);
    case 'due_today':
      return 'heute fällig';
    case 'in_progress':
      return 'in Arbeit';
    default:
      return '';
  }
}

function compareSuggestions(a, b) {
  var origin = PRECEDENCE.indexOf(a.origin) - PRECEDENCE.indexOf(b.origin);
  if (origin !== 0) {
    return origin;
  }
  var dueA = a.ticket.due || '';
  var dueB = b.ticket.due || '';
  if (dueA !== dueB) {
    if (dueA === '') {
      return 1;
    }
    if (dueB === '') {
      return -1;
    }
    return dueA < dueB ? -1 : 1;
  }
  var priority = (has(PRIORITY_RANK, a.ticket.priority) ? PRIORITY_RANK[a.ticket.priority] : 2) -
    (has(PRIORITY_RANK, b.ticket.priority) ? PRIORITY_RANK[b.ticket.priority] : 2);
  if (priority !== 0) {
    return priority;
  }
  var createdA = a.ticket.created || '';
  var createdB = b.ticket.created || '';
  if (createdA !== createdB) {
    return createdA < createdB ? -1 : 1;
  }
  return a.ticket.id < b.ticket.id ? -1 : a.ticket.id > b.ticket.id ? 1 : 0;
}

// Whether `a` is a later occurrence of its series than `b`: the later due date (one without a due
// date counts as the earliest), then the later creation, then the greater ID.
function isLater(a, b) {
  var dueA = a.due || '';
  var dueB = b.due || '';
  if (dueA !== dueB) {
    return dueA > dueB;
  }
  var createdA = a.created || '';
  var createdB = b.created || '';
  if (createdA !== createdB) {
    return createdA > createdB;
  }
  return a.id > b.id;
}

/**
 * Only the current occurrence of a series counts (WH-1, ADR-0065 addendum WH-1): for every series
 * (`series` of the facts, the rule of a ticket that stands for its series alone, '' otherwise) the
 * ID of its latest open ticket, and whether one of its tickets is in the plan already. Tickets of
 * "Verpasste Termine nachholen" have no series here: each date counts on its own.
 */
function seriesOf(tickets, planned) {
  var current = {};
  var inPlan = {};
  for (var i = 0; i < tickets.length; i++) {
    var ticket = tickets[i];
    var series = ticket.series || '';
    if (series === '' || ticket.status === 'done') {
      continue;
    }
    if (!has(current, series) || isLater(ticket, current[series])) {
      current[series] = ticket;
    }
    if (contains(planned, ticket.id)) {
      inPlan[series] = true;
    }
  }
  return { current: current, inPlan: inPlan };
}

/**
 * The suggestions of the plan of `today`: every open ticket of the area that is neither in the plan
 * nor removed from it today and matches a source that is not off; of a series only its current
 * occurrence, and nothing while one of its tickets is in the plan (WH-1). `context`: { today,
 * settings (as settingsOf gives them), planned (ticket IDs in the plan), dismissed (ticket IDs
 * removed from it), leftover (see matchingSources) }. Each suggestion: { id, mode ('suggest' or
 * 'auto', the strongest of its sources), origin (the first source of that mode by PRECEDENCE),
 * reasons (the texts of every source that is not off, in that order) }. Sorted by origin, due date
 * (none last), priority, creation and ID.
 */
function suggestionsOf(tickets, context) {
  var settings = settingsOf(context.settings);
  var series = seriesOf(tickets, context.planned);
  var found = [];
  for (var i = 0; i < tickets.length; i++) {
    var ticket = tickets[i];
    if (contains(context.planned, ticket.id) || contains(context.dismissed, ticket.id)) {
      continue;
    }
    var key = ticket.series || '';
    if (key !== '' && (series.inPlan[key] || !has(series.current, key) || series.current[key].id !== ticket.id)) {
      continue;
    }
    var sources = matchingSources(ticket, context.today, context.leftover);
    var best = 'off';
    var origin = '';
    var reasons = [];
    for (var j = 0; j < sources.length; j++) {
      var mode = settings[sources[j]];
      if (mode === 'off') {
        continue;
      }
      reasons.push(reasonText(sources[j], ticket, context.today));
      if (MODE_RANK[mode] > MODE_RANK[best]) {
        best = mode;
        origin = sources[j];
      }
    }
    if (best === 'off') {
      continue;
    }
    found.push({ id: ticket.id, mode: best, origin: origin, reasons: reasons, ticket: ticket });
  }
  found.sort(compareSuggestions);
  var result = [];
  for (var k = 0; k < found.length; k++) {
    result.push({ id: found[k].id, mode: found[k].mode, origin: found[k].origin, reasons: found[k].reasons });
  }
  return result;
}

// --- Check marks ---------------------------------------------------------------------------------

// Modes of a check request: 'check' is the check mark itself, which the kind of the ticket decides;
// 'today' is "Nur für heute abhaken", 'complete' is "Vorhaben abschließen …".
var CHECK_MODES = Object.freeze(['check', 'today', 'complete']);

/**
 * What a check request does: 'complete' (the ticket is completed through the way of the list) or
 * 'today' (only the entry of this day is checked, the ticket stays as it is); null for an unknown
 * mode. The check mark completes a task and checks an ongoing project for the day.
 */
function checkAction(kind, mode) {
  if (mode === 'today' || mode === 'complete') {
    return mode;
  }
  if (mode === 'check') {
    return kindOf(kind) === 'ongoing' ? 'today' : 'complete';
  }
  return null;
}

/** Whether an entry counts as done in its plan: checked for the day or its ticket is done. */
function isDone(item, ticketStatus) {
  return !!item.done_today || ticketStatus === 'done';
}

// --- Days --------------------------------------------------------------------------------------

/**
 * Which days a request may name: '' for a calendar date until tomorrow, 'validation_dayplan_date'
 * for anything else, 'validation_dayplan_future' after tomorrow (planning ahead is for tomorrow).
 */
function dateViolation(date, tomorrow) {
  if (typeof date !== 'string' || !isCalendarDate(date)) {
    return 'validation_dayplan_date';
  }
  return date > tomorrow ? 'validation_dayplan_future' : '';
}

/** Whether the plan of `date` can change: today and tomorrow; days before are read-only. */
function isEditable(date, today, tomorrow) {
  return date >= today && date <= tomorrow;
}

// --- Order -------------------------------------------------------------------------------------

/**
 * The IDs of `ids` with `id` moved to `index` (clamped to the list), or null when `id` is not among
 * them. The plan stores the new order as positions 0, 1, 2, …
 */
function moved(ids, id, index) {
  var from = ids.indexOf(id);
  if (from === -1) {
    return null;
  }
  var rest = ids.slice(0, from).concat(ids.slice(from + 1));
  var target = typeof index === 'number' && isFinite(index) ? Math.floor(index) : rest.length;
  if (target < 0) {
    target = 0;
  }
  if (target > rest.length) {
    target = rest.length;
  }
  return rest.slice(0, target).concat([id], rest.slice(target));
}

// --- Texts ---------------------------------------------------------------------------------------

// Texts of the codes of the routes, the same in web/src/lib/domain/day-plan.ts.
var MESSAGES = Object.freeze({
  validation_dayplan_date: 'Kein gültiger Tag für den Tagesplan.',
  validation_dayplan_future: 'Planen geht für heute und morgen.',
  validation_dayplan_readonly: 'Vergangene Tage lassen sich nicht mehr ändern.',
  validation_dayplan_area: 'Diesen Bereich gibt es für dein Konto nicht.',
  validation_dayplan_ticket_missing: 'Das Ticket gibt es nicht mehr oder es ist nicht sichtbar.',
  validation_dayplan_ticket_done: 'Erledigte Tickets kommen nicht in den Tagesplan.',
  validation_dayplan_mode: 'Unbekannte Art des Abhakens.',
  validation_dayplan_status: 'Unbekannter Status zum Wiederöffnen.',
  validation_dayplan_index: 'Ungültige Stelle im Plan.',
  validation_dayplan_sources: 'Ungültige Einstellung der Vorschläge.',
  validation_dayplan_tomorrow: 'Auf morgen schieben geht nur im Plan von heute.',
  validation_dayplan_tickets: 'Bitte höchstens 200 Tickets auf einmal übernehmen.'
});

// Text of `validation_scope_mismatch` at the field `ticket` (ADR-0059 §4): a ticket goes only into
// the plan of its own area.
var SCOPE_TEXT = 'Das Ticket gehört zu einem anderen Bereich (Privat oder Haushalt) als dieser Tagesplan.';

// At most this many tickets in one request "Übernehmen".
var ADOPT_MAX = 200;

module.exports = {
  KINDS: KINDS,
  DEFAULT_KIND: DEFAULT_KIND,
  kindOf: kindOf,
  SOURCES: SOURCES,
  MODES: MODES,
  DEFAULT_SOURCES: DEFAULT_SOURCES,
  ORIGINS: ORIGINS,
  PRECEDENCE: PRECEDENCE,
  settingsOf: settingsOf,
  sourcesViolation: sourcesViolation,
  isCalendarDate: isCalendarDate,
  seriesKeyOf: seriesKeyOf,
  matchingSources: matchingSources,
  shortDate: shortDate,
  overdueSinceText: overdueSinceText,
  reasonText: reasonText,
  suggestionsOf: suggestionsOf,
  CHECK_MODES: CHECK_MODES,
  checkAction: checkAction,
  isDone: isDone,
  dateViolation: dateViolation,
  isEditable: isEditable,
  moved: moved,
  MESSAGES: MESSAGES,
  SCOPE_TEXT: SCOPE_TEXT,
  ADOPT_MAX: ADOPT_MAX
};
