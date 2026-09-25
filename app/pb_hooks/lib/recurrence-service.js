// Recurring tasks, the database part (ADR-0021 to ADR-0023; E5 plan package 2: saving rules).
// CommonJS module, ES5 only, Goja runtime only. Every function takes the app of the running
// transaction (`txApp`) and never uses `$app`. The pure decisions are in lib/recurrence-rules.js
// and lib/recurrence.js.
//
// The running instance loads new hooks at once but runs the E5 migrations only at its next
// start (E4 plan section 12). Until then `recurrence_rules` has no `freq`, and every function
// here leaves rules and tickets as they were in E4 (schemaReady).
'use strict';

var recurrence = require(__hooks + '/lib/recurrence.js');
var rules = require(__hooks + '/lib/recurrence-rules.js');
var berlinTime = require(__hooks + '/lib/berlin-time.js');
var ticketKey = require(__hooks + '/lib/ticket-key.js');
var ticketService = require(__hooks + '/lib/ticket-service.js');
var errors = require(__hooks + '/lib/errors.js');

var RULES = 'recurrence_rules';
var TICKETS = 'tickets';

// Transient record keys (like ticket-service ACTOR_KEY: names with "@" are neither stored nor
// loaded from a request body). TICKET_KEY carries the body field `ticket` of a create request to
// the model hook; SYSTEM_KEY marks writes of the server itself (generation, completion), whose
// values of next_due, last_generated_at, last_hint and active the model hook keeps.
var TICKET_KEY = '@recurrence_ticket';
var SYSTEM_KEY = '@recurrence_system';

// Whether the E5 migrations ran (the rule parameters exist).
function schemaReady(app) {
  try {
    var collection = app.findCachedCollectionByNameOrId(RULES);
    return !!collection.fields.getByName('freq');
  } catch (err) {
    return false;
  }
}

function findById(txApp, collection, id) {
  var found = txApp.findRecordsByFilter(collection, 'id = {:id}', '', 1, 0, { id: id });
  return found.length > 0 ? found[0] : null;
}

// The open instance of a rule (status other than done), or null.
function openInstance(txApp, ruleId) {
  var found = txApp.findRecordsByFilter(
    TICKETS,
    "recurrence = {:rule} && status != 'done'",
    '-created',
    1,
    0,
    { rule: ruleId }
  );
  return found.length > 0 ? found[0] : null;
}

function listOf(slice) {
  var list = [];
  for (var i = 0; i < slice.length; i++) {
    list.push(String(slice[i]));
  }
  return list;
}

// Plain parameters of a rule record, dates as calendar dates.
function paramsOf(record) {
  return {
    mode: record.getString('mode'),
    freq: record.getString('freq'),
    interval: record.get('interval'),
    weekdays: listOf(record.getStringSlice('weekdays')),
    month_day: record.get('month_day'),
    anchor: rules.calendarDateOf(record.getString('anchor')),
    lead_days: record.get('lead_days'),
    active: record.getBool('active'),
    next_due: rules.calendarDateOf(record.getString('next_due'))
  };
}

function writeParams(record, values) {
  record.set('interval', values.interval);
  record.set('weekdays', values.weekdays);
  record.set('month_day', values.month_day === null ? 0 : values.month_day);
  record.set('anchor', rules.storedDateOf(values.anchor));
  record.set('lead_days', values.lead_days);
}

function checkedParams(raw) {
  var checked = rules.checkParams(raw, recurrence);
  if (checked.errors) {
    var fields = Object.keys(checked.errors);
    throw errors.validationFailure(checked.errors[fields[0]].message, checked.errors);
  }
  return checked.values;
}

function fail(field, code) {
  return errors.fieldFailure(field, code, rules.MESSAGES[code]);
}

// --- Request hooks ---------------------------------------------------------------------------

// onRecordCreateRequest: `active` defaults to true and `lead_days` to DEFAULT_LEAD_DAYS unless the
// client sends them (bool and number fields have no schema default, and the model hook cannot
// tell 0 or false from "not sent"). The body field `ticket` (no schema field) goes to the model
// hook. An anchor the date field could not read counts as an error, not as "empty".
function prepareCreateRequest(e) {
  var body = e.requestInfo().body;
  if (body['active'] === undefined) {
    e.record.set('active', true);
  }
  if (body['lead_days'] === undefined || body['lead_days'] === null || body['lead_days'] === '') {
    e.record.set('lead_days', recurrence.DEFAULT_LEAD_DAYS);
  }
  var ticket = body['ticket'];
  if (ticket !== undefined && ticket !== null && ticket !== '') {
    if (typeof ticket !== 'string') {
      throw fail('ticket', 'validation_recurrence_ticket_missing');
    }
    e.record.set(TICKET_KEY, ticket);
  }
  checkAnchorBody(e);
  ticketService.rememberActor(e);
}

// onRecordUpdateRequest; a superuser may set every field, like at connections (repairs in the
// admin UI, tests with a past next_due): the model hook then keeps the values as sent.
function prepareUpdateRequest(e) {
  if (e.hasSuperuserAuth()) {
    e.record.set(SYSTEM_KEY, true);
    return;
  }
  checkAnchorBody(e);
  ticketService.rememberActor(e);
}

function checkAnchorBody(e) {
  var anchor = e.requestInfo().body['anchor'];
  if (anchor !== undefined && anchor !== null && anchor !== '' && e.record.getString('anchor') === '') {
    throw fail('anchor', 'validation_recurrence_anchor');
  }
}

// Ticket request hooks: `tickets.recurrence` is never set by a client, only cleared (ADR-0023
// section 1). Before the E5 migrations it stays free as in E4.
function guardTicketCreate(e) {
  var value = e.requestInfo().body['recurrence'];
  if (value !== undefined && value !== null && value !== '' && schemaReady(e.app)) {
    throw fail('recurrence', 'validation_recurrence_managed');
  }
}

function guardTicketUpdate(e) {
  var next = e.record.getString('recurrence');
  if (next !== '' && next !== e.record.original().getString('recurrence') && schemaReady(e.app)) {
    throw fail('recurrence', 'validation_recurrence_managed');
  }
}

// --- Model hooks -----------------------------------------------------------------------------

/**
 * onRecordCreate before e.next(): scope, server fields, parameters with their defaults, template
 * relations, the ticket to link and next_due (ADR-0023 section 1). Returns what completeCreate
 * needs after the insert.
 */
function prepareCreate(txApp, record, nowMs) {
  var scope = ticketKey.scopeOf(record.getString('owner'), record.getString('household'));
  record.set('scope', scope);
  record.set('last_generated_at', '');
  record.set('last_hint', '');
  var today = berlinTime.berlinToday(nowMs);

  var ticketId = record.get(TICKET_KEY) ? String(record.get(TICKET_KEY)) : '';
  var ticket = null;
  if (ticketId !== '') {
    ticket = findById(txApp, TICKETS, ticketId);
    var code = rules.ticketViolation(
      ticket === null
        ? null
        : {
            scope: ticket.getString('scope'),
            status: ticket.getString('status'),
            recurrence: ticket.getString('recurrence')
          },
      scope
    );
    if (code !== '') {
      throw fail('ticket', code);
    }
  }
  var ticketDue = ticket ? rules.calendarDateOf(ticket.getString('due')) : '';

  var raw = paramsOf(record);
  if (raw.anchor === '') {
    raw.anchor = rules.defaultAnchor(ticketDue, today);
  }
  var values = checkedParams(raw);
  writeParams(record, values);
  ticketService.checkRelations(txApp, record, scope, '');

  var dates = rules.createDates(
    { rule: values, withTicket: ticket !== null, ticketDue: ticketDue, today: today },
    recurrence
  );
  record.set('next_due', rules.storedDateOf(dates.nextDue));
  return { ticket: ticket, ticketDue: dates.ticketDue };
}

// onRecordCreate after e.next(): the ticket becomes the current instance in the same
// transaction; a calendar rule gives a ticket without due date its first occurrence.
function completeCreate(txApp, record, prepared) {
  if (!prepared || prepared.ticket === null) {
    return;
  }
  var ticket = prepared.ticket;
  ticket.set('recurrence', record.id);
  if (prepared.ticketDue !== null) {
    ticket.set('due', rules.storedDateOf(prepared.ticketDue));
  }
  var actor = record.get(ticketService.ACTOR_KEY);
  if (actor) {
    ticket.set(ticketService.ACTOR_KEY, String(actor));
  }
  txApp.save(ticket);
}

/**
 * onRecordUpdate before e.next(). Writes of the server (SYSTEM_KEY) keep their values; a client
 * edit gets the stored server fields back, checked parameters and a recomputed next_due
 * (ADR-0023 sections 4 and 5). Resuming with an archived project is rejected (section 8).
 */
function prepareUpdate(txApp, record, nowMs) {
  var original = record.original();
  var scope = ticketKey.scopeOf(record.getString('owner'), record.getString('household'));
  record.set('scope', scope);
  if (record.get(SYSTEM_KEY)) {
    return;
  }
  record.set('next_due', original.getString('next_due'));
  record.set('last_generated_at', original.getString('last_generated_at'));
  record.set('last_hint', original.getString('last_hint'));
  var today = berlinTime.berlinToday(nowMs);

  var raw = paramsOf(record);
  if (raw.anchor === '') {
    raw.anchor = rules.calendarDateOf(original.getString('anchor')) || today;
  }
  var values = checkedParams(raw);
  writeParams(record, values);
  var project = ticketService.checkRelations(txApp, record, scope, original.getString('project'));

  var beforeRaw = paramsOf(original);
  var before = recurrence.normalize(beforeRaw);
  before.active = beforeRaw.active;
  before.next_due = beforeRaw.next_due;
  var after = values;
  after.active = record.getBool('active');

  if (!before.active && after.active && project && project.getBool('archived')) {
    throw fail('project', 'validation_project_archived');
  }
  var instance = openInstance(txApp, record.id);
  var next = rules.nextDueAfterEdit(
    {
      before: before,
      after: after,
      openDue: instance ? rules.calendarDateOf(instance.getString('due')) : null,
      today: today
    },
    recurrence
  );
  record.set('next_due', rules.storedDateOf(next));
  if (rules.clearsHint(before, after)) {
    record.set('last_hint', '');
  }
}

module.exports = {
  TICKET_KEY: TICKET_KEY,
  SYSTEM_KEY: SYSTEM_KEY,
  schemaReady: schemaReady,
  openInstance: openInstance,
  paramsOf: paramsOf,
  prepareCreateRequest: prepareCreateRequest,
  prepareUpdateRequest: prepareUpdateRequest,
  guardTicketCreate: guardTicketCreate,
  guardTicketUpdate: guardTicketUpdate,
  prepareCreate: prepareCreate,
  completeCreate: completeCreate,
  prepareUpdate: prepareUpdate
};
