// Recurring tasks, the database part (ADR-0021 to ADR-0023; E5 plan package 2: saving rules,
// package 3: generation, completion, reopening, release, cron and start). CommonJS module, ES5
// only, Goja runtime only. Functions inside a hook take the app of the running transaction
// (`txApp`); materialize, runDue and runStartup open their own transactions on the app they get
// and never throw. The pure decisions are in lib/recurrence-rules.js and lib/recurrence.js.
//
// The running instance loads new hooks at once but runs the E5 migrations only at its next
// start (E4 plan section 12). Until then `recurrence_rules` has no `freq`, and every function
// here leaves rules and tickets as they were in E4 (schemaReady). The same holds for "Jeden
// Termin einzeln anlegen" (plan OR-5): before its migration (eachReady) every rule keeps one open
// instance; and for "Status beim Anlegen" (plan WV): before its migration (initialStatusReady)
// every new ticket starts "open".
'use strict';

var recurrence = require(__hooks + '/lib/recurrence.js');
var rules = require(__hooks + '/lib/recurrence-rules.js');
var berlinTime = require(__hooks + '/lib/berlin-time.js');
var ticketKey = require(__hooks + '/lib/ticket-key.js');
var ticketService = require(__hooks + '/lib/ticket-service.js');
var errors = require(__hooks + '/lib/errors.js');
var trashRules = require(__hooks + '/lib/trash-rules.js');

var RULES = 'recurrence_rules';
var TICKETS = 'tickets';

// Transient record keys (like ticket-service ACTOR_KEY: names with "@" are neither stored nor
// loaded from a request body). TICKET_KEY carries the body field `ticket` of a create request to
// the model hook; SYSTEM_KEY marks writes of the server itself (generation, completion), whose
// values of next_due, last_generated_at, last_hint and active the model hook keeps.
var TICKET_KEY = '@recurrence_ticket';
var SYSTEM_KEY = '@recurrence_system';
// BACKLOG_KEY carries the body field `backlog` ('all' | 'today', no schema field): the choice of
// the user about a backlog of "Jeden Termin einzeln anlegen" (ADR-0022 addendum 5).
var BACKLOG_KEY = '@recurrence_backlog';
// On tickets: COMPLETED_KEY carries the rule of an instance that was just completed to the
// after-success hook; DETACH_KEY marks a client request that clears `recurrence`; UNDO_KEY marks
// the untouched follow-up that reopening an instance removes (no release logic for it).
var COMPLETED_KEY = '@recurrence_completed';
var DETACH_KEY = '@recurrence_detach';
var UNDO_KEY = '@recurrence_undo';

// Whether the E5 migrations ran (the rule parameters exist).
function schemaReady(app) {
  try {
    var collection = app.findCachedCollectionByNameOrId(RULES);
    return !!collection.fields.getByName('freq');
  } catch (err) {
    return false;
  }
}

// Whether the migration of "Jeden Termin einzeln anlegen" ran (plan OR-5): rules.each_occurrence
// and tickets.occurrence exist. Before it, every rule keeps one open instance as in E5.
function eachReady(app) {
  try {
    return (
      !!app.findCachedCollectionByNameOrId(RULES).fields.getByName('each_occurrence') &&
      !!app.findCachedCollectionByNameOrId(TICKETS).fields.getByName('occurrence')
    );
  } catch (err) {
    return false;
  }
}

// Whether the migration of "Status beim Anlegen" ran (plan WV, ADR-0022 addendum 8). Before it
// every new ticket of a rule starts "open" as in E5: getString gives '' without the field.
function initialStatusReady(app) {
  try {
    return !!app.findCachedCollectionByNameOrId(RULES).fields.getByName('initial_status');
  } catch (err) {
    return false;
  }
}

// A rule with "Jeden Termin einzeln anlegen": only a fixed rhythm (after completion there is only
// one next date). getBool gives false without the field, i.e. before the migration.
function eachOf(record) {
  return record.getBool('each_occurrence') && record.getString('mode') === 'calendar';
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
  checkBacklogBody(e);
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
  checkBacklogBody(e);
  ticketService.rememberActor(e);
}

// The body field `backlog` (ADR-0022 addendum 5): 'all' or 'today', anything else is refused; an
// empty value means no choice.
function checkBacklogBody(e) {
  var choice = e.requestInfo().body['backlog'];
  if (choice === undefined || choice === null || choice === '') {
    return;
  }
  if (rules.BACKLOG_CHOICES.indexOf(choice) === -1) {
    throw fail('backlog', 'validation_recurrence_backlog');
  }
  e.record.set(BACKLOG_KEY, choice);
}

// Applies the choice about a backlog to a rule with "Jeden Termin einzeln anlegen" (ADR-0022
// addendum 5) before it is saved; without the switch, or without a choice, nothing changes.
function applyBacklogChoice(record, values, nextDue, today) {
  var choice = record.get(BACKLOG_KEY);
  if (!choice || !eachOf(record) || values.mode !== 'calendar') {
    return;
  }
  var rule = recurrence.normalize(values);
  rule.next_due = nextDue;
  var decided = rules.backlogDecision({ rule: rule, choice: String(choice), today: today }, recurrence);
  record.set('next_due', rules.storedDateOf(decided.nextDue));
  record.set('last_hint', decided.hint);
}

function checkAnchorBody(e) {
  var anchor = e.requestInfo().body['anchor'];
  if (anchor !== undefined && anchor !== null && anchor !== '' && e.record.getString('anchor') === '') {
    throw fail('anchor', 'validation_recurrence_anchor');
  }
}

// Ticket request hooks: `tickets.recurrence` is never set by a client, only cleared (ADR-0023
// section 1). Before the E5 migrations it stays free as in E4. `tickets.occurrence` (plan OR-5)
// belongs to the generation alone: a client value is dropped silently, like a server field.
function guardTicketCreate(e) {
  var value = e.requestInfo().body['recurrence'];
  if (value !== undefined && value !== null && value !== '' && schemaReady(e.app)) {
    throw fail('recurrence', 'validation_recurrence_managed');
  }
  if (eachReady(e.app)) {
    e.record.set('occurrence', '');
  }
}

// A client that clears `recurrence` releases the ticket from its series ("Aus der Serie lösen");
// the model hook then treats an open instance like a deleted one (ADR-0023 section 6). The date of
// the series goes with it.
function guardTicketUpdate(e) {
  var original = e.record.original();
  var each = eachReady(e.app);
  if (each) {
    e.record.set('occurrence', original.getString('occurrence'));
  }
  var next = e.record.getString('recurrence');
  if (next === original.getString('recurrence') || !schemaReady(e.app)) {
    return;
  }
  if (next !== '') {
    throw fail('recurrence', 'validation_recurrence_managed');
  }
  if (each) {
    e.record.set('occurrence', '');
  }
  e.record.set(DETACH_KEY, true);
}

// Date a new rhythm counts from (ADR-0023 section 5): the due date of the open instance, and with
// "Jeden Termin einzeln anlegen" the latest date of the series among the open tickets, so a due
// date moved by hand cannot bring back a date that has its ticket already.
function openDateOf(txApp, ruleId, instance, each) {
  var due = rules.calendarDateOf(instance.getString('due'));
  if (!each || !eachReady(txApp)) {
    return due;
  }
  var latest = txApp.findRecordsByFilter(
    TICKETS,
    "recurrence = {:rule} && status != 'done' && occurrence != ''",
    '-occurrence',
    1,
    0,
    { rule: ruleId }
  );
  var occurrence = latest.length > 0 ? rules.calendarDateOf(latest[0].getString('occurrence')) : '';
  return occurrence > due ? occurrence : due;
}

// "Jeden Termin einzeln anlegen" needs a fixed rhythm (plan OR-5).
function checkEach(record, values) {
  var code = rules.eachViolation(values.mode, record.getBool('each_occurrence'));
  if (code !== '') {
    throw fail('each_occurrence', code);
  }
}

// "Status beim Anlegen" (ADR-0022 addendum 8): every status but done, refused with the German text
// before the select field answers; an empty value is stored as "open", the default. Nothing before
// the migration (the field does not exist, and a sent value is dropped by PocketBase).
function checkInitialStatus(txApp, record) {
  if (!initialStatusReady(txApp)) {
    return;
  }
  var value = record.getString('initial_status');
  var code = rules.initialStatusViolation(value);
  if (code !== '') {
    throw fail('initial_status', code);
  }
  if (value === '') {
    record.set('initial_status', rules.DEFAULT_INITIAL_STATUS);
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
    // A ticket in the trash reads like a missing one (ADR-0037 §3).
    if (ticket && trashRules.isTrashed(ticket.getString('deleted_at'))) {
      ticket = null;
    }
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
  checkEach(record, values);
  checkInitialStatus(txApp, record);
  ticketService.checkRelations(txApp, record, scope, '');

  var dates = rules.createDates(
    { rule: values, withTicket: ticket !== null, ticketDue: ticketDue, today: today },
    recurrence
  );
  record.set('next_due', rules.storedDateOf(dates.nextDue));
  applyBacklogChoice(record, values, dates.nextDue, today);
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
  checkEach(record, values);
  checkInitialStatus(txApp, record);
  var project = ticketService.checkRelations(txApp, record, scope, original.getString('project'));

  var beforeRaw = paramsOf(original);
  var before = recurrence.normalize(beforeRaw);
  before.active = beforeRaw.active;
  before.next_due = beforeRaw.next_due;
  before.each = eachOf(original);
  var after = values;
  after.active = record.getBool('active');
  after.each = eachOf(record);

  if (!before.active && after.active && project && project.getBool('archived')) {
    throw fail('project', 'validation_project_archived');
  }
  var instance = openInstance(txApp, record.id);
  var next = rules.nextDueAfterEdit(
    {
      before: before,
      after: after,
      openDue: instance ? openDateOf(txApp, record.id, instance, after.each) : null,
      today: today
    },
    recurrence
  );
  record.set('next_due', rules.storedDateOf(next));
  if (rules.clearsHint(before, after)) {
    record.set('last_hint', '');
  }
  applyBacklogChoice(record, values, next, today);
}

// --- Generation (ADR-0022; E5 plan package 3) -------------------------------------------------

// Normalized rule with the state the generation needs; `each` for "Jeden Termin einzeln anlegen".
function ruleState(rule) {
  var raw = paramsOf(rule);
  var state = recurrence.normalize(raw);
  state.active = raw.active;
  state.next_due = raw.next_due;
  state.each = eachOf(rule);
  return state;
}

// Whether an open ticket of the rule was made for this date already (plan OR-5).
function hasOpenOccurrence(txApp, ruleId, due) {
  return (
    txApp.findRecordsByFilter(
      TICKETS,
      "recurrence = {:rule} && status != 'done' && occurrence = {:due}",
      '',
      1,
      0,
      { rule: ruleId, due: rules.storedDateOf(due) }
    ).length > 0
  );
}

function saveSystem(txApp, rule) {
  rule.set(SYSTEM_KEY, true);
  txApp.save(rule);
}

function setNextDue(txApp, rule, nextDue) {
  if (nextDue === null) {
    return;
  }
  rule.set('next_due', rules.storedDateOf(nextDue));
  saveSystem(txApp, rule);
}

function errorText(err) {
  return err && err.message ? err.message : String(err);
}

// The new ticket of a rule: template, its "Status beim Anlegen" (open when empty, i.e. before the
// migration 1790202500 or for rules from before it; ADR-0022 addendum 8), the due date, the rule
// and the owner. Every such status is "not done", so the ticket is an open instance. Key,
// scope, history ("created" without a user) and the "new" mark come from the ticket hooks, which
// run inside the same transaction (the nested inTransaction reuses it).
// created and updated get one timestamp: PocketBase reads the clock once per autodate field, so
// the two can differ by a millisecond, and isUntouched() takes `updated = created` as "never
// edited" when an instance is reopened (ADR-0023 section 3). record.set() ignores autodate
// fields; a value from setRaw() is kept, because it differs from the empty original. The value is
// the stored form, like last_generated_at, with the real clock (a run may pass another nowMs).
// With `occurrence` (plan OR-5) the ticket carries its date of the series for the unique index.
function newInstance(txApp, rule, due, occurrence) {
  var ticket = new Record(txApp.findCollectionByNameOrId(TICKETS));
  var now = berlinTime.toPocketBaseDate(Date.now());
  ticket.setRaw('created', now);
  ticket.setRaw('updated', now);
  ticket.set('title', rule.getString('title'));
  ticket.set('description', rule.getString('description'));
  ticket.set('project', rule.getString('project'));
  ticket.set('tags', listOf(rule.getStringSlice('tags')));
  ticket.set('priority', rule.getString('priority') || 'medium');
  ticket.set('status', rules.initialStatusOf(rule.getString('initial_status')));
  ticket.set('due', rules.storedDateOf(due));
  ticket.set('blocks_parent', true);
  ticket.set('recurrence', rule.id);
  if (occurrence) {
    ticket.set('occurrence', rules.storedDateOf(due));
  }
  ticket.set('owner', rule.getString('owner'));
  ticket.set('household', rule.getString('household'));
  txApp.save(ticket);
  return ticket;
}

// Missed dates of a fixed rhythm made into one ticket (ADR-0022 section 3, addendum 4): the new
// ticket gets a neutral history entry naming how many dates it stands for and which, in the
// transaction of its creation, without a user (like its "created" entry). Nothing without a gap.
function noteSkipped(txApp, rule, state, due, ticketId) {
  var skipped = rules.skippedDates(state, state.next_due, due, recurrence);
  if (skipped === null) {
    return;
  }
  var ticket = findById(txApp, TICKETS, ticketId);
  ticketService.saveHistoryEntry(txApp, ticket, {
    field: rules.SKIPPED_FIELD,
    old_value: rule.id,
    new_value: JSON.stringify(skipped)
  });
}

// Writes the hint of a failed generation in an own transaction; the rule stays active and the
// next run tries again (ADR-0022 section 2).
function recordFailure(app, ruleId, err) {
  app.logger().warn('Wiederholung: Ticket nicht erzeugt', 'rule', ruleId, 'error', errorText(err));
  try {
    app.runInTransaction(function (txApp) {
      var rule = findById(txApp, RULES, ruleId);
      if (rule) {
        rule.set('last_hint', rules.failureHint(errorText(err)));
        saveSystem(txApp, rule);
      }
    });
  } catch (hintErr) {
    app.logger().warn('Wiederholung: Hinweis nicht gespeichert', 'rule', ruleId, 'error', errorText(hintErr));
  }
}

/**
 * Creates the next ticket of one rule if it is due, in one transaction (ADR-0022 section 2):
 * nothing for an inactive rule, without next_due, with an open instance or before the lead time.
 * With "Jeden Termin einzeln anlegen" (plan OR-5) it creates one ticket per date whose lead time
 * is reached instead, open instances or not, at most EACH_MAX_PER_RUN per run with a neutral hint
 * when more are waiting; with more than that many dates before today it makes nothing and waits
 * for the choice of the user (ADR-0022 addendum 5, status 'waiting'). An archived project pauses
 * the rule with a neutral hint. Never throws: another error becomes a hint at the rule and a log
 * line. Returns { status: 'created' | 'paused' | 'waiting' | 'skipped' | 'failed' | 'unavailable',
 * ticket, count }: the first new ticket and how many.
 */
function materialize(app, ruleId, nowMs) {
  var result = { status: 'skipped', ticket: '', count: 0 };
  if (!schemaReady(app)) {
    result.status = 'unavailable';
    return result;
  }
  var today = berlinTime.berlinToday(nowMs);
  try {
    app.runInTransaction(function (txApp) {
      var rule = findById(txApp, RULES, ruleId);
      if (rule === null) {
        return;
      }
      var state = ruleState(rule);
      var each = state.each && eachReady(txApp);
      var plan = each
        ? rules.generationEach({ rule: state, today: today, hint: rule.getString('last_hint') }, recurrence)
        : rules.generation(
            { rule: state, hasOpenInstance: openInstance(txApp, rule.id) !== null, today: today },
            recurrence
          );
      if (plan === null) {
        return;
      }
      // A large backlog waits for the choice of the user (ADR-0022 addendum 5); nothing is made.
      if (plan.ask) {
        if (rule.getString('last_hint') !== rules.CATCH_UP_ASK_HINT) {
          rule.set('last_hint', rules.CATCH_UP_ASK_HINT);
          saveSystem(txApp, rule);
        }
        result.status = 'waiting';
        return;
      }
      var projectId = rule.getString('project');
      var project = projectId === '' ? null : findById(txApp, 'projects', projectId);
      if (project && project.getBool('archived')) {
        rule.set('active', false);
        rule.set('last_hint', rules.ARCHIVED_HINT);
        saveSystem(txApp, rule);
        result.status = 'paused';
        return;
      }
      var dues = each ? plan.dues : [plan.due];
      var created = [];
      for (var i = 0; i < dues.length; i++) {
        // A date that has its open ticket already is not made twice (the index would refuse it).
        if (!each || !hasOpenOccurrence(txApp, rule.id, dues[i])) {
          created.push(newInstance(txApp, rule, dues[i], each).id);
        }
      }
      if (!each && created.length > 0) {
        noteSkipped(txApp, rule, state, plan.due, created[0]);
      }
      rule.set('next_due', rules.storedDateOf(plan.nextDue));
      rule.set('last_generated_at', berlinTime.toPocketBaseDate(nowMs));
      rule.set('last_hint', each ? plan.hint : '');
      saveSystem(txApp, rule);
      result.status = created.length > 0 ? 'created' : 'skipped';
      result.ticket = created.length > 0 ? created[0] : '';
      result.count = created.length;
    });
  } catch (err) {
    if (rules.isOpenInstanceConflict(errorText(err))) {
      return { status: 'skipped', ticket: '', count: 0 };
    }
    recordFailure(app, ruleId, err);
    return { status: 'failed', ticket: '', count: 0 };
  }
  return result;
}

/**
 * All rules that may be due (ADR-0022 section 2): active, with next_due up to today plus the
 * largest lead time; each one alone through materialize, so one failing rule stops no other.
 * Returns the counts { checked, created, paused, failed, unavailable, tickets }: `created` counts
 * the rules that created, `tickets` the new tickets (several per rule with "Jeden Termin einzeln").
 */
function runDue(app, nowMs) {
  var counts = { checked: 0, created: 0, paused: 0, failed: 0, waiting: 0, unavailable: false, tickets: 0 };
  if (!schemaReady(app)) {
    counts.unavailable = true;
    return counts;
  }
  var limit = berlinTime.addDays(berlinTime.berlinToday(nowMs), recurrence.LEAD_DAYS_MAX);
  var due = app.findRecordsByFilter(
    RULES,
    "active = true && next_due != '' && next_due <= {:limit}",
    'next_due,id',
    0,
    0,
    { limit: rules.storedDateOf(limit) }
  );
  for (var i = 0; i < due.length; i++) {
    counts.checked += 1;
    var run = materialize(app, due[i].id, nowMs);
    if (run.status === 'created' || run.status === 'paused' || run.status === 'failed' || run.status === 'waiting') {
      counts[run.status] += 1;
    }
    counts.tickets += run.count;
  }
  if (counts.created > 0 || counts.paused > 0 || counts.failed > 0) {
    app
      .logger()
      .info(
        'Wiederholungen erzeugt',
        'created',
        counts.created,
        'tickets',
        counts.tickets,
        'paused',
        counts.paused,
        'failed',
        counts.failed
      );
  }
  return counts;
}

// Catch-up at the start (ADR-0022 section 4): the due tickets, then the cleanup of discarded
// inbox items, which would otherwise wait for 11:30 UTC. Each part on its own, never throwing:
// a failure must not keep the server from starting.
function runStartup(app, nowMs) {
  try {
    runDue(app, nowMs);
  } catch (err) {
    app.logger().error('Wiederholungen: Nachholen beim Start gescheitert', 'error', errorText(err));
  }
  try {
    require(__hooks + '/lib/inbox-cleanup-service.js').run(app, nowMs);
  } catch (err) {
    app.logger().error('Eingang: Bereinigung beim Start gescheitert', 'error', errorText(err));
  }
  // The trash as well (ADR-0037 §8): tickets whose retention ran out while the app was off.
  try {
    require(__hooks + '/lib/trash-service.js').purgeDue(app, nowMs);
  } catch (err) {
    app.logger().error('Papierkorb: Aufräumen beim Start gescheitert', 'error', errorText(err));
  }
}

// --- Ticket hooks (ADR-0022 section 4, ADR-0023 sections 2, 3 and 6) -------------------------

/**
 * onRecordUpdate of tickets, inside its transaction and before e.next() (completed_at is set):
 * - completing an instance fixes next_due of an after-completion rule and marks the ticket for
 *   the generation after the commit;
 * - reopening an instance removes an untouched follow-up or refuses when it was edited;
 * - releasing an open instance ("Aus der Serie lösen") works like deleting it.
 */
function prepareTicketUpdate(txApp, record, nowMs) {
  if (!schemaReady(txApp)) {
    return;
  }
  var original = record.original();
  var ruleId = record.getString('recurrence');
  var previousRule = original.getString('recurrence');
  var wasDone = original.getString('status') === 'done';
  var isDone = record.getString('status') === 'done';
  var today = berlinTime.berlinToday(nowMs);

  if (previousRule !== '' && ruleId === '' && record.get(DETACH_KEY) && !wasDone) {
    release(txApp, previousRule, today);
    return;
  }
  if (ruleId === '') {
    return;
  }
  var rule = findById(txApp, RULES, ruleId);
  if (rule === null) {
    return;
  }
  if (!wasDone && isDone) {
    // The completion is now; its Berlin date is today (ADR-0022 section 6).
    setNextDue(txApp, rule, rules.nextDueOnCompletion(ruleState(rule), today, recurrence));
    record.set(COMPLETED_KEY, ruleId);
  } else if (wasDone && !isDone) {
    reopen(txApp, record, rule);
  }
}

// Reopening an instance (ADR-0023 section 3, addendum OR-5). The open instances that stand
// against it follow the unique index: with one open instance per rule every other one, with
// "Jeden Termin einzeln anlegen" only one of the same date (normally none, so reopening just
// works and next_due stays). A single conflicting follow-up is removed only if it is untouched
// and the reopened ticket is its direct predecessor, the instance completed last (addendum 4:
// reopening an older one never removes the current follow-up silently). Otherwise, and with
// several, the reopening is refused with the newest key; the client may then reopen the ticket
// as a normal one by clearing `recurrence` in the same request (DETACH_KEY, no conflict then).
// The untouched follow-up is removed for good, not moved to the trash: it was made by the server
// moments ago, has no content of the user, and restoring it would only conflict (ADR-0023
// addendum 3).
function reopen(txApp, record, rule) {
  var others = txApp.findRecordsByFilter(
    TICKETS,
    "recurrence = {:rule} && status != 'done' && id != {:id}",
    '-created',
    0,
    0,
    { rule: rule.id, id: record.id }
  );
  var state = ruleState(rule);
  var each = state.each && eachReady(txApp);
  var open = [];
  for (var i = 0; i < others.length; i++) {
    open.push({ ticket: others[i], occurrence: each ? others[i].getString('occurrence') : '' });
  }
  var conflicts = rules.reopenConflicts(open, each ? record.getString('occurrence') : '', each);
  if (conflicts.length === 0) {
    if (!each) {
      setNextDue(txApp, rule, rules.nextDueOnReopen(state, false, ''));
    }
    return;
  }
  var followUp = conflicts[0].ticket;
  var completedAt = record.original().getString('completed_at');
  var comments = txApp.findRecordsByFilter('comments', 'ticket = {:id}', '', 1, 0, { id: followUp.id });
  var untouched = rules.isUntouched(
    {
      created: followUp.getString('created'),
      updated: followUp.getString('updated'),
      comments: comments.length
    },
    completedAt
  );
  var outcome = rules.reopenOutcome({
    conflicts: conflicts.length,
    untouched: untouched,
    direct: each || rules.isDirectPredecessor(completedAt, latestOtherCompletion(txApp, rule.id, record.id))
  });
  if (outcome !== 'remove') {
    var key = followUp.getString('key');
    var older = outcome === 'refuse_older';
    throw errors.fieldFailure(
      'status',
      older ? 'validation_recurrence_reopen_older' : 'validation_recurrence_open_instance',
      older ? rules.reopenOlderMessage(key) : rules.openInstanceMessage(key),
      { key: key, ticket: followUp.id }
    );
  }
  var removedDue = rules.calendarDateOf(followUp.getString('due'));
  followUp.set(UNDO_KEY, true);
  txApp.delete(followUp);
  // With each date its own ticket, next_due stays: moving it back could make dates of the series
  // again that have their (done) tickets already.
  if (!each) {
    setNextDue(txApp, rule, rules.nextDueOnReopen(state, true, removedDue));
  }
}

// completed_at of the newest other done instance of a rule ('' without one). Instances in the
// trash or released from the series have no rule any more and do not count.
function latestOtherCompletion(txApp, ruleId, ticketId) {
  var found = txApp.findRecordsByFilter(
    TICKETS,
    "recurrence = {:rule} && status = 'done' && id != {:id}",
    '-completed_at',
    1,
    0,
    { rule: ruleId, id: ticketId }
  );
  return found.length > 0 ? found[0].getString('completed_at') : '';
}

function release(txApp, ruleId, today) {
  var rule = findById(txApp, RULES, ruleId);
  if (rule !== null) {
    setNextDue(txApp, rule, rules.nextDueOnRelease(ruleState(rule), today, recurrence));
  }
}

// onRecordDelete of tickets, inside its transaction: deleting the open instance (ADR-0023
// section 6). The follow-up removed by reopening is left alone (UNDO_KEY).
function prepareTicketDelete(txApp, record, nowMs) {
  var ruleId = record.getString('recurrence');
  if (ruleId === '' || record.get(UNDO_KEY) || record.getString('status') === 'done' || !schemaReady(txApp)) {
    return;
  }
  release(txApp, ruleId, berlinTime.berlinToday(nowMs));
}

// onRecordAfterUpdateSuccess of tickets: after the commit of a completion, the next ticket if its
// lead time is reached. A failure never undoes the completion; the cron job catches up.
function afterTicketUpdate(app, record, nowMs) {
  var ruleId = record.get(COMPLETED_KEY);
  if (ruleId) {
    materialize(app, String(ruleId), nowMs);
  }
}

// onRecordAfterCreateSuccess/onRecordAfterUpdateSuccess of rules: a new, resumed or changed rule
// creates its ticket at once when it is due already (ADR-0023 sections 1 and 4). Writes of the
// server itself do not start another run.
function afterRuleSaved(app, record, nowMs) {
  if (!record.get(SYSTEM_KEY)) {
    materialize(app, record.id, nowMs);
  }
}

module.exports = {
  TICKET_KEY: TICKET_KEY,
  SYSTEM_KEY: SYSTEM_KEY,
  schemaReady: schemaReady,
  eachReady: eachReady,
  initialStatusReady: initialStatusReady,
  materialize: materialize,
  runDue: runDue,
  runStartup: runStartup,
  prepareTicketUpdate: prepareTicketUpdate,
  prepareTicketDelete: prepareTicketDelete,
  afterTicketUpdate: afterTicketUpdate,
  afterRuleSaved: afterRuleSaved,
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
