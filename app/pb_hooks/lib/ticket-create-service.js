// "Neues Ticket" with everything at once (NT-1, ADR-0069), the database part. CommonJS module, ES5
// only, Goja runtime only. The pure decisions are in lib/ticket-create-rules.js.
//
// POST /api/byl/tickets/create creates the ticket and every option that needs it in one transaction
// of the route (e.app.runInTransaction, like "Duplizieren"): its sub-tasks, the entries of the inbox
// and the tickets it stems from, the rule of a series with the ticket as its first instance, the pin of
// the acting account and the entry in the day plan of today. Every record is saved with txApp, so the
// hooks of tickets, inbox items, links, rules, pins and plan entries run inside it as for the ways the
// app had before (key, scope, checks, conversion, history with the acting account, realtime after the
// commit, the notice of an assignment by someone else). All checks run before the first write, with
// the same functions as those hooks; a failure of any write rolls back everything, so there is never a
// half ticket. GET of the same address names which options the server knows.
'use strict';

var rules = require(__hooks + '/lib/ticket-create-rules.js');
var errors = require(__hooks + '/lib/errors.js');
var ticketService = require(__hooks + '/lib/ticket-service.js');
var ticketRules = require(__hooks + '/lib/ticket-rules.js');
var trashRules = require(__hooks + '/lib/trash-rules.js');
var inbox = require(__hooks + '/lib/inbox-service.js');
var recurrenceService = require(__hooks + '/lib/recurrence-service.js');
var recurrenceRules = require(__hooks + '/lib/recurrence-rules.js');
var pins = require(__hooks + '/lib/pin-service.js');
var pinRules = require(__hooks + '/lib/pin-rules.js');
var dayPlans = require(__hooks + '/lib/day-plan-service.js');
var dayPlanRules = require(__hooks + '/lib/day-plan-rules.js');
var ticketSources = require(__hooks + '/lib/ticket-source-service.js');
var ticketSourceRules = require(__hooks + '/lib/ticket-source-rules.js');
var berlinTime = require(__hooks + '/lib/berlin-time.js');

var TICKETS = 'tickets';
var INBOX = 'inbox_items';
var RULES = 'recurrence_rules';
var MEMBERS = 'household_members';

var AREA_FORBIDDEN = 'In diesem Bereich darfst du keine Tickets anlegen.';

// Stands for the ticket that does not exist yet when the entries of the inbox are checked: linking
// needs some ticket, which one is checked by the hook of the entries in the transaction.
var PENDING_TICKET = 'pending';

function fail(field, code, message, index) {
  return errors.fieldFailure(field, code, message, typeof index === 'number' ? { index: index } : undefined);
}

function own(field, code, index) {
  return fail(field, code, rules.MESSAGES[code], index);
}

// The signed-in app user of the request (the route requires one).
function actorOf(e) {
  return e.auth && e.auth.collection().name === 'users' ? e.auth.id : '';
}

// Returns the record or null; real database errors still throw.
function findById(app, collection, id) {
  if (typeof id !== 'string' || id === '') {
    return null;
  }
  var found = app.findRecordsByFilter(collection, 'id = {:id}', '', 1, 0, { id: id });
  return found.length > 0 ? found[0] : null;
}

function isTrashed(record) {
  return trashRules.isTrashed(record.getString('deleted_at'));
}

function stringList(values) {
  var list = [];
  for (var i = 0; i < values.length; i++) {
    list.push(String(values[i]));
  }
  return list;
}

// The create rule of tickets: a ticket of a household only for a member of it.
function assertMayCreate(app, userId, household) {
  if (household === '') {
    return;
  }
  var found = app.findRecordsByFilter(MEMBERS, 'household = {:household} && user = {:user}', '', 1, 0, {
    household: household,
    user: userId
  });
  if (found.length === 0) {
    throw new ForbiddenError(AREA_FORBIDDEN);
  }
}

function hasField(collection, name) {
  return !!collection.fields.getByName(name);
}

// A field of a later migration (color, charm, kind, assignee) takes a value only once the server knows
// it, and a select field only one of its values (the schema is the list, as for the Record API).
function checkFields(collection, values) {
  for (var i = 0; i < rules.LATER_FIELDS.length; i++) {
    var later = rules.LATER_FIELDS[i];
    if (values[later] !== '' && !hasField(collection, later)) {
      throw own(later, 'validation_create_unavailable');
    }
  }
  for (var j = 0; j < rules.SELECT_FIELDS.length; j++) {
    var name = rules.SELECT_FIELDS[j];
    var value = values[name];
    var field = collection.fields.getByName(name);
    if (value === '' || !field) {
      continue;
    }
    var allowed = stringList(field.values);
    if (allowed.indexOf(value) === -1) {
      throw own(name, 'validation_create_format');
    }
  }
}

// The new ticket as the Record API would get it, owned by the acting account (not yet saved).
function ticketRecord(app, values, actor) {
  var collection = app.findCollectionByNameOrId(TICKETS);
  checkFields(collection, values);
  var record = new Record(collection);
  record.set('owner', actor);
  record.set('household', values.household);
  record.set('title', values.title);
  record.set('description', values.description);
  record.set('status', values.status);
  record.set('priority', values.priority);
  record.set('due', values.due);
  record.set('project', values.project);
  record.set('tags', values.tags);
  record.set('parent', values.parent);
  record.set('blocks_parent', values.blocks_parent);
  var later = rules.LATER_FIELDS;
  for (var i = 0; i < later.length; i++) {
    if (values[later[i]] !== '') {
      record.set(later[i], values[later[i]]);
    }
  }
  if (values.source_item !== '') {
    record.set('source_item', values.source_item);
  } else {
    record.set('source', values.source === '' ? 'manual' : values.source);
  }
  record.set(ticketService.ACTOR_KEY, actor);
  return record;
}

// --- Checks before the first write ---------------------------------------------------------------

// The entries of the inbox that become sources: visible and changeable for the request, in the area of
// the ticket and still new without a ticket (the change "Mit Ticket verknüpfen …" allows).
function checkSources(e, ids, scope) {
  var collection = e.app.findCollectionByNameOrId(INBOX);
  var info = e.requestInfo();
  for (var i = 0; i < ids.length; i++) {
    var item = findById(e.app, INBOX, ids[i]);
    if (!item || !e.app.canAccessRecord(item, info, collection.updateRule)) {
      throw own('sources', 'validation_create_source_missing', i);
    }
    if (item.getString('scope') !== scope) {
      throw fail('sources', 'validation_scope_mismatch', inbox.MESSAGES.validation_scope_mismatch, i);
    }
    var code = inbox.linkViolation(item, PENDING_TICKET);
    if (code !== '') {
      throw fail('sources', code, inbox.MESSAGES[code], i);
    }
  }
}

// The tickets the new one stems from (ADR-0067): visible, alive and in its area. A new ticket has no
// follow-ups, so no link of the request closes a circle; the model hook checks it anyway.
function checkTicketSources(e, ids, scope) {
  if (ids.length === 0) {
    return;
  }
  if (!ticketSources.ready(e.app)) {
    throw own('ticket_sources', 'validation_create_unavailable');
  }
  var collection = e.app.findCollectionByNameOrId(TICKETS);
  var info = e.requestInfo();
  for (var i = 0; i < ids.length; i++) {
    var source = findById(e.app, TICKETS, ids[i]);
    if (!source || isTrashed(source) || !e.app.canAccessRecord(source, info, collection.viewRule)) {
      var missing = 'validation_ticket_source_missing';
      throw fail('ticket_sources', missing, ticketSourceRules.MESSAGES[missing], i);
    }
    if (source.getString('scope') !== scope) {
      throw fail('ticket_sources', 'validation_scope_mismatch', ticketRules.scopeMessage('source'), i);
    }
  }
}

// The rule of a series with the ticket as its first instance, built like "Wiederholen…" builds it: the
// template is the ticket, the rhythm and the rest come from the request, and the request hook of the
// rules reads its body (applyCreateBody). `ticketId` '' builds it for the checks only.
function ruleRecord(app, ticket, rule, actor, ticketId) {
  var collection = app.findCollectionByNameOrId(RULES);
  var record = new Record(collection);
  record.set('owner', actor);
  record.set('household', ticket.getString('household'));
  record.set('title', ticket.getString('title'));
  record.set('description', ticket.getString('description'));
  record.set('project', ticket.getString('project'));
  record.set('tags', stringList(ticket.getStringSlice('tags')));
  record.set('priority', ticket.getString('priority'));
  // The color and the charm of the ticket (ADR-0052, ADR-0062); none means none.
  var color = ticket.getString('color');
  if (color !== '' && hasField(collection, 'color')) {
    record.set('color', color);
  }
  var charm = ticket.getString('charm');
  if (charm !== '' && hasField(collection, 'charm')) {
    record.set('charm', charm);
  }
  for (var name in rule.fields) {
    if (Object.prototype.hasOwnProperty.call(rule.fields, name)) {
      record.set(name, rule.fields[name]);
    }
  }
  var body = {};
  for (var key in rule.body) {
    if (Object.prototype.hasOwnProperty.call(rule.body, key)) {
      body[key] = rule.body[key];
    }
  }
  if (ticketId !== '') {
    body.ticket = ticketId;
  }
  recurrenceService.applyCreateBody(app, record, body, false);
  record.set(ticketService.ACTOR_KEY, actor);
  return record;
}

// The checks of the rule: the parameters, "Folgetickets starten mit", the sub-tasks of the template, the
// charm, the assignment and the template relations, by the model hook itself on a record that is never
// saved; that a done ticket begins no series comes first (lib/recurrence-rules.js ticketViolation).
function checkRule(app, ticket, rule, actor) {
  if (rule === null) {
    return;
  }
  if (!recurrenceService.schemaReady(app)) {
    throw own('recurrence', 'validation_create_unavailable');
  }
  var code = recurrenceRules.ticketViolation(
    { scope: ticket.getString('scope'), status: ticket.getString('status'), recurrence: '' },
    ticket.getString('scope')
  );
  if (code !== '') {
    throw fail('recurrence', code, recurrenceRules.MESSAGES[code]);
  }
  recurrenceService.prepareCreate(app, ruleRecord(app, ticket, rule, actor, ''), Date.now());
}

// "Anheften" (ADR-0064) and "Zum Tagesplan" (ADR-0065): never for a done ticket, and only once the
// server knows them.
function checkPinAndPlan(app, options, status) {
  if (options.pin) {
    if (!pins.pinsReady(app)) {
      throw own('pin', 'validation_create_unavailable');
    }
    if (pinRules.pinViolation(status) !== '') {
      throw fail('pin', 'validation_pin_done', pinRules.MESSAGES.validation_pin_done);
    }
  }
  if (options.dayPlan) {
    if (!dayPlans.ready(app)) {
      throw own('day_plan', 'validation_create_unavailable');
    }
    if (status === 'done') {
      var done = 'validation_dayplan_ticket_done';
      throw fail('day_plan', done, dayPlanRules.MESSAGES[done]);
    }
  }
}

// --- Writes in the transaction -----------------------------------------------------------------

// New open sub-tasks in the order of the request: the project and the tags of the ticket, like
// "Unteraufgabe hinzufügen" (ADR-0033 §4), each a millisecond later than the one before, so the
// section "Unteraufgaben" keeps the order (like the sub-tasks of a template, ADR-0022 addendum 10).
function saveSubtasks(txApp, ticket, subtasks, actor) {
  var created = [];
  var nowMs = Date.now();
  for (var i = 0; i < subtasks.length; i++) {
    var child = new Record(txApp.findCollectionByNameOrId(TICKETS));
    var stamp = berlinTime.toPocketBaseDate(nowMs + i + 1);
    child.setRaw('created', stamp);
    child.setRaw('updated', stamp);
    child.set('owner', actor);
    child.set('household', ticket.getString('household'));
    child.set('title', subtasks[i].title);
    child.set('description', '');
    child.set('status', 'open');
    child.set('priority', subtasks[i].priority);
    child.set('due', '');
    child.set('project', ticket.getString('project'));
    child.set('tags', stringList(ticket.getStringSlice('tags')));
    child.set('parent', ticket.id);
    child.set('blocks_parent', true);
    child.set('source', 'manual');
    child.set(ticketService.ACTOR_KEY, actor);
    txApp.save(child);
    created.push({ id: child.id, key: child.getString('key') });
  }
  return created;
}

// The entries of the inbox, read again in the transaction: one handled meanwhile ends everything.
function linkSources(txApp, ticket, ids, actor) {
  for (var i = 0; i < ids.length; i++) {
    var item = findById(txApp, INBOX, ids[i]);
    if (!item) {
      throw own('sources', 'validation_create_source_missing', i);
    }
    var code = inbox.linkToTicket(txApp, item, ticket, actor);
    if (code !== '') {
      throw fail('sources', code, inbox.MESSAGES[code], i);
    }
  }
  return ids.length;
}

// The tickets it stems from, read again in the transaction (one in the trash meanwhile ends it).
function linkTicketSources(txApp, ticket, ids, actor) {
  for (var i = 0; i < ids.length; i++) {
    var source = findById(txApp, TICKETS, ids[i]);
    if (!source || isTrashed(source)) {
      var missing = 'validation_ticket_source_missing';
      throw fail('ticket_sources', missing, ticketSourceRules.MESSAGES[missing], i);
    }
    ticketSources.link(txApp, ticket, source, actor);
  }
  return ids.length;
}

// The ticket goes into the plan of today of its own area, by hand, at the end.
function planToday(txApp, ticket, actor) {
  var days = dayPlans.daysOf(txApp);
  var area = dayPlans.areaOf(txApp, actor, ticket.getString('scope'));
  dayPlans.addToPlan(txApp, area, days.today, ticket, actor);
}

/**
 * GET /api/byl/tickets/create: which options the server knows (the migrations that ran), so the form
 * offers only those. Before this package the route is missing (404) and the form creates as before.
 */
function support(e) {
  var tickets = e.app.findCollectionByNameOrId(TICKETS);
  return {
    recurrence: recurrenceService.schemaReady(e.app),
    pin: pins.pinsReady(e.app),
    day_plan: dayPlans.ready(e.app),
    ticket_sources: ticketSources.ready(e.app),
    kind: hasField(tickets, 'kind'),
    color: hasField(tickets, 'color'),
    charm: hasField(tickets, 'charm'),
    assignee: hasField(tickets, 'assignee')
  };
}

/**
 * POST /api/byl/tickets/create: the body as described in lib/ticket-create-rules.js parseRequest.
 * Only an app account, only in its private area or its household (else 403). Answers { id, key,
 * scope, subtasks: [{ id, key }], sources, ticket_sources, rule, pinned, day_plan } with the number of
 * linked sources and the ID of the rule ('' without one).
 */
function create(e) {
  var parsed = rules.parseRequest(e.requestInfo().body);
  if (!parsed.options) {
    throw own(parsed.field, parsed.code, parsed.index);
  }
  var options = parsed.options;
  var actor = actorOf(e);
  assertMayCreate(e.app, actor, options.ticket.household);

  var ticket = ticketRecord(e.app, options.ticket, actor);
  var checked = ticketService.checkCreate(e.app, ticket);
  if (rules.nestedSubtasks(ticket.getString('parent'), options.subtasks)) {
    throw own('subtasks', 'validation_create_subtasks_nested');
  }
  checkSources(e, options.sources, checked.scope);
  checkTicketSources(e, options.ticketSources, checked.scope);
  checkRule(e.app, ticket, options.rule, actor);
  checkPinAndPlan(e.app, options, ticket.getString('status'));

  var result = null;
  e.app.runInTransaction(function (txApp) {
    txApp.save(ticket);
    var subtasks = saveSubtasks(txApp, ticket, options.subtasks, actor);
    var sources = linkSources(txApp, ticket, options.sources, actor);
    var linked = linkTicketSources(txApp, ticket, options.ticketSources, actor);
    var rule = null;
    if (options.rule !== null) {
      rule = ruleRecord(txApp, ticket, options.rule, actor, ticket.id);
      txApp.save(rule);
    }
    if (options.pin) {
      pins.pinTicket(txApp, actor, ticket.id);
    }
    if (options.dayPlan) {
      planToday(txApp, ticket, actor);
    }
    result = {
      id: ticket.id,
      key: ticket.getString('key'),
      scope: ticket.getString('scope'),
      subtasks: subtasks,
      sources: sources,
      ticket_sources: linked,
      rule: rule === null ? '' : rule.id,
      pinned: options.pin,
      day_plan: options.dayPlan
    };
  });
  return result;
}

module.exports = {
  create: create,
  support: support
};
