// The day plan (TP-1, ADR-0065), the database part. CommonJS module, ES5 only, Goja runtime only; the
// pure decisions are in lib/day-plan-rules.js.
//
// - One plan per area and day (day_plans, unique per scope and date): private per account, shared per
//   household. The routes create it lazily on the first request of today or tomorrow, inside a
//   transaction: PocketBase runs every transaction on one connection, so two members who open the plan
//   at the same time wait for each other, and the unique indexes of plans and entries are the net.
// - Every request for today takes the tickets of the sources in the mode "automatisch übernehmen" into
//   the plan (idempotent); tickets removed from the plan that day (`dismissed`) stay out. Suggestions
//   are computed by the same rules in the SPA from its live tickets; the server computes them for the
//   automatic sources and for the origin of an adopted ticket.
// - A check mark completes a task through the save of the ticket (its hooks: completion, history with
//   the acting user, the series, the pins); an ongoing project is only checked for the day.
// - Writes go through these routes only (the API rules of the plans are read-only), each in one
//   transaction with every check before the first write; realtime reaches every tab that sees the plan.
// - A ticket that goes to the trash or into another area loses its entries in the same transaction
//   (ticketChanged); one deleted for good takes them along by the cascade of the relation.
'use strict';

var rules = require(__hooks + '/lib/day-plan-rules.js');
var berlin = require(__hooks + '/lib/berlin-time.js');
var errors = require(__hooks + '/lib/errors.js');
var ticketKey = require(__hooks + '/lib/ticket-key.js');

var PLANS = 'day_plans';
var ITEMS = 'day_plan_items';
var SETTINGS = 'day_plan_settings';
var TICKETS = 'tickets';
var MEMBERS = 'household_members';
var UNAVAILABLE = 'Der Tagesplan steht nach dem nächsten Neustart der App bereit.';
var NOT_FOUND = 'Eintrag nicht gefunden.';
var REOPEN_STATUSES = ['backlog', 'open', 'in_progress', 'waiting'];
var COMPLETIONS = ['force', 'complete_children'];

// Only in instances of the tests (the mark of tests/fixtures/pb_hooks/test-mode.pb.js) a fixed clock
// of tests/fixtures/pb_hooks/day-plan-clock.pb.js replaces the time of the machine.
var TEST_MODE_KEY = 'byl-test-mode';
var TEST_NOW_KEY = 'byl-test-dayplan-now';

/** True once the migration of the day plan ran (the running instance may still miss it). */
function ready(app) {
  try {
    app.findCollectionByNameOrId(ITEMS);
    return true;
  } catch (err) {
    return false;
  }
}

function nowOf(app) {
  var store = app.store();
  if (store.get(TEST_MODE_KEY) === true) {
    var fixed = store.get(TEST_NOW_KEY);
    if (typeof fixed === 'number' && isFinite(fixed)) {
      return fixed;
    }
  }
  return Date.now();
}

/** Today, tomorrow and yesterday in Berlin, the same function as "Heute fällig" (ADR-0005). */
function daysOf(app) {
  var today = berlin.berlinToday(nowOf(app));
  return { today: today, tomorrow: berlin.addDays(today, 1), yesterday: berlin.addDays(today, -1) };
}

function fail(field, code) {
  return errors.fieldFailure(field, code, rules.MESSAGES[code]);
}

function scopeFailure() {
  return errors.fieldFailure('ticket', 'validation_scope_mismatch', rules.SCOPE_TEXT);
}

function listOf(found) {
  var list = [];
  for (var i = 0; i < found.length; i++) {
    list.push(found[i]);
  }
  return list;
}

function findById(app, collection, id) {
  if (!id) {
    return null;
  }
  try {
    return app.findRecordById(collection, id);
  } catch (err) {
    return null;
  }
}

function actorOf(e) {
  return e.auth ? String(e.auth.id) : '';
}

function bodyOf(e) {
  var body = e.requestInfo().body;
  return body && typeof body === 'object' ? body : {};
}

function parsed(raw, fallback) {
  if (raw === '' || raw === null || raw === undefined) {
    return fallback;
  }
  try {
    var value = JSON.parse(String(raw));
    return value === null || value === undefined ? fallback : value;
  } catch (err) {
    return fallback;
  }
}

// --- Areas -------------------------------------------------------------------------------------

function householdOf(app, userId) {
  var found = app.findRecordsByFilter(MEMBERS, 'user = {:user}', 'created,id', 1, 0, { user: userId });
  return found.length > 0 ? found[0].getString('household') : '';
}

/**
 * The area of a request: `scope` names the private area of the account or its household (empty means
 * the private one); anything else is refused. `other` is the second area of the account, null without
 * a household.
 */
function areaOf(app, userId, scope) {
  var mine = ticketKey.scopeOf(userId, '');
  var household = householdOf(app, userId);
  var shared = household === '' ? '' : ticketKey.scopeOf('', household);
  var requested = typeof scope === 'string' && scope !== '' ? scope : mine;
  if (requested === mine) {
    return { scope: mine, household: '', other: shared === '' ? null : shared };
  }
  if (shared !== '' && requested === shared) {
    return { scope: shared, household: household, other: mine };
  }
  throw fail('scope', 'validation_dayplan_area');
}

/** Whether `scope` is one of the areas of the account: its private one or its household. */
function sees(app, userId, scope) {
  if (scope === ticketKey.scopeOf(userId, '')) {
    return true;
  }
  var household = householdOf(app, userId);
  return household !== '' && scope === ticketKey.scopeOf('', household);
}

// --- Plans and entries ---------------------------------------------------------------------------

function planOf(app, scope, date) {
  var found = app.findRecordsByFilter(PLANS, 'scope = {:scope} && date = {:date}', '', 1, 0, { scope: scope, date: date });
  return found.length > 0 ? found[0] : null;
}

/** The plan of the area and day, created when it is missing (the caller runs a transaction). */
function ensurePlan(txApp, area, date, actor) {
  var plan = planOf(txApp, area.scope, date);
  if (plan !== null) {
    return plan;
  }
  plan = new Record(txApp.findCollectionByNameOrId(PLANS));
  plan.set('owner', actor);
  plan.set('household', area.household);
  plan.set('scope', area.scope);
  plan.set('date', date);
  plan.set('dismissed', []);
  try {
    txApp.save(plan);
  } catch (err) {
    // The unique index (scope, date) as the net: another request created it meanwhile.
    var created = planOf(txApp, area.scope, date);
    if (created !== null) {
      return created;
    }
    throw err;
  }
  return plan;
}

function itemsOf(app, planId) {
  return listOf(app.findRecordsByFilter(ITEMS, 'plan = {:plan}', 'position,created,id', 0, 0, { plan: planId }));
}

function itemOf(app, planId, ticketId) {
  var found = app.findRecordsByFilter(ITEMS, 'plan = {:plan} && ticket = {:ticket}', '', 1, 0, {
    plan: planId,
    ticket: ticketId
  });
  return found.length > 0 ? found[0] : null;
}

function dismissedOf(plan) {
  var list = parsed(plan.getString('dismissed'), []);
  if (Object.prototype.toString.call(list) !== '[object Array]') {
    return [];
  }
  var result = [];
  for (var i = 0; i < list.length; i++) {
    if (typeof list[i] === 'string') {
      result.push(list[i]);
    }
  }
  return result;
}

/** Keeps a ticket out of the sources of the day: it was removed from the plan. */
function dismiss(txApp, plan, ticketId) {
  var list = dismissedOf(plan);
  if (list.indexOf(ticketId) !== -1) {
    return;
  }
  list.push(ticketId);
  plan.set('dismissed', list);
  txApp.save(plan);
}

/** A ticket taken into the plan by hand again may come from the sources again. */
function undismiss(txApp, plan, ticketId) {
  var list = dismissedOf(plan);
  var index = list.indexOf(ticketId);
  if (index === -1) {
    return;
  }
  list.splice(index, 1);
  plan.set('dismissed', list);
  txApp.save(plan);
}

function nextPosition(items) {
  var max = -1;
  for (var i = 0; i < items.length; i++) {
    max = Math.max(max, items[i].getInt('position'));
  }
  return max + 1;
}

function newItem(txApp, plan, ticketId, origin, position, actor) {
  var item = new Record(txApp.findCollectionByNameOrId(ITEMS));
  item.set('plan', plan.id);
  item.set('ticket', ticketId);
  item.set('position', position);
  item.set('origin', origin);
  item.set('done_today', false);
  item.set('added_by', actor || '');
  txApp.save(item);
  return item;
}

/** Saves the order of `ids` (entries of one plan) as positions 0, 1, 2, …; only changed ones. */
function savePositions(txApp, items, ids) {
  var byId = {};
  for (var i = 0; i < items.length; i++) {
    byId[items[i].id] = items[i];
  }
  for (var j = 0; j < ids.length; j++) {
    var item = byId[ids[j]];
    if (item && item.getInt('position') !== j) {
      item.set('position', j);
      txApp.save(item);
    }
  }
}

/** Puts a new entry at `index` of its plan (the end without one). */
function placeAt(txApp, plan, item, index) {
  if (typeof index !== 'number' || !isFinite(index)) {
    return;
  }
  var items = itemsOf(txApp, plan.id);
  var ids = [];
  for (var i = 0; i < items.length; i++) {
    ids.push(items[i].id);
  }
  savePositions(txApp, items, rules.moved(ids, item.id, index));
}

// --- Tickets and sources -----------------------------------------------------------------------

function dueOf(ticket) {
  var due = ticket.getString('due');
  return due === '' ? '' : due.substring(0, 10);
}

/** What the rules need of a ticket. */
function factsOf(ticket) {
  return {
    id: ticket.id,
    status: ticket.getString('status'),
    due: dueOf(ticket),
    kind: rules.kindOf(ticket.getString('kind')),
    recurring: ticket.getString('recurrence') !== '',
    priority: ticket.getString('priority'),
    created: ticket.getString('created')
  };
}

function openTicketsOf(app, scope) {
  return listOf(
    app.findRecordsByFilter(TICKETS, "scope = {:scope} && status != 'done' && deleted_at = ''", 'created,id', 0, 0, {
      scope: scope
    })
  );
}

function isOpen(ticket) {
  return ticket !== null && ticket.getString('status') !== 'done' && ticket.getString('deleted_at') === '';
}

/** "Übrig von gestern": entries of yesterday neither checked for the day nor done, ticket still open. */
function leftoverOf(app, scope, yesterday) {
  var plan = planOf(app, scope, yesterday);
  if (plan === null) {
    return [];
  }
  var items = itemsOf(app, plan.id);
  var result = [];
  for (var i = 0; i < items.length; i++) {
    if (items[i].getBool('done_today')) {
      continue;
    }
    var ticket = findById(app, TICKETS, items[i].getString('ticket'));
    if (isOpen(ticket)) {
      result.push(ticket.id);
    }
  }
  return result;
}

function settingsRecordOf(app, scope) {
  var found = app.findRecordsByFilter(SETTINGS, 'scope = {:scope}', '', 1, 0, { scope: scope });
  return found.length > 0 ? found[0] : null;
}

/** The modes of the sources of an area, the defaults for everything not stored. */
function settingsFor(app, scope) {
  var record = settingsRecordOf(app, scope);
  return rules.settingsOf(record === null ? null : parsed(record.getString('sources'), null));
}

/** The suggestions of the plan of today by the rules, with every mode that is not off. */
function suggestionsFor(app, plan, scope, days) {
  var items = itemsOf(app, plan.id);
  var planned = [];
  for (var i = 0; i < items.length; i++) {
    planned.push(items[i].getString('ticket'));
  }
  var open = openTicketsOf(app, scope);
  var tickets = [];
  for (var j = 0; j < open.length; j++) {
    tickets.push(factsOf(open[j]));
  }
  return rules.suggestionsOf(tickets, {
    today: days.today,
    settings: settingsFor(app, scope),
    planned: planned,
    dismissed: dismissedOf(plan),
    leftover: leftoverOf(app, scope, days.yesterday)
  });
}

/** Takes the tickets of the automatic sources into the plan of today; returns how many. */
function adoptAutomatic(txApp, plan, scope, days) {
  var suggestions = suggestionsFor(txApp, plan, scope, days);
  var position = nextPosition(itemsOf(txApp, plan.id));
  var count = 0;
  for (var i = 0; i < suggestions.length; i++) {
    if (suggestions[i].mode !== 'auto' || itemOf(txApp, plan.id, suggestions[i].id) !== null) {
      continue;
    }
    newItem(txApp, plan, suggestions[i].id, suggestions[i].origin, position, '');
    position += 1;
    count += 1;
  }
  return count;
}

// --- Answers -------------------------------------------------------------------------------------

function itemJson(item) {
  return {
    id: item.id,
    plan: item.getString('plan'),
    ticket: item.getString('ticket'),
    position: item.getInt('position'),
    origin: item.getString('origin'),
    done_today: item.getBool('done_today'),
    done_at: item.getString('done_at'),
    added_by: item.getString('added_by'),
    checked_by: item.getString('checked_by'),
    created: item.getString('created'),
    updated: item.getString('updated')
  };
}

function planJson(plan) {
  return {
    id: plan.id,
    date: plan.getString('date'),
    scope: plan.getString('scope'),
    dismissed: dismissedOf(plan)
  };
}

/** The plan of today of the other area of the account: how many entries and how many are done. */
function otherOf(app, area, today) {
  if (area.other === null) {
    return null;
  }
  var plan = planOf(app, area.other, today);
  var count = 0;
  var done = 0;
  if (plan !== null) {
    var items = itemsOf(app, plan.id);
    count = items.length;
    for (var i = 0; i < items.length; i++) {
      var ticket = findById(app, TICKETS, items[i].getString('ticket'));
      if (rules.isDone({ done_today: items[i].getBool('done_today') }, ticket ? ticket.getString('status') : '')) {
        done += 1;
      }
    }
  }
  return { scope: area.other, count: count, done: done };
}

function unavailable(e) {
  return e.json(503, { status: 503, message: UNAVAILABLE, reason: 'missing' });
}

function answer(e, body) {
  e.response.header().set('Cache-Control', 'no-store');
  return e.json(200, body);
}

/** The requested day, today without one; refused when it is no day until tomorrow. */
function dateOf(value, days) {
  var date = typeof value === 'string' && value !== '' ? value : days.today;
  var code = rules.dateViolation(date, days.tomorrow);
  if (code !== '') {
    throw fail('date', code);
  }
  return date;
}

function assertEditable(date, days) {
  if (!rules.isEditable(date, days.today, days.tomorrow)) {
    throw fail('date', 'validation_dayplan_readonly');
  }
}

/** An entry with its plan, when the account sees the plan; else 404. */
function entryOf(app, userId, id) {
  var item = findById(app, ITEMS, id);
  var plan = item === null ? null : findById(app, PLANS, item.getString('plan'));
  if (plan === null || !sees(app, userId, plan.getString('scope'))) {
    throw new NotFoundError(NOT_FOUND);
  }
  return { item: item, plan: plan };
}

/** A ticket the request may see (view rule of tickets, so never one in the trash), or null. */
function visibleTicket(e, app, id) {
  var ticket = findById(app, TICKETS, id);
  if (ticket === null) {
    return null;
  }
  var collection = app.findCollectionByNameOrId(TICKETS);
  return app.canAccessRecord(ticket, e.requestInfo(), collection.viewRule) ? ticket : null;
}

// --- Routes --------------------------------------------------------------------------------------

/**
 * GET /api/byl/dayplan?scope=&date=: the plan of the area and day. Today and tomorrow are created
 * when missing; today also takes the tickets of the automatic sources in. Days before today are read
 * only and never created. Answers the plan (null for a day before without one), whether it can change,
 * for today the suggestions that are left and the tickets left over from yesterday, the settings of
 * the sources and the plan of today of the other area of the account (only how many entries, none of
 * their content).
 */
function fetch(e) {
  if (!ready(e.app)) {
    return unavailable(e);
  }
  var actor = actorOf(e);
  var query = e.requestInfo().query || {};
  var days = daysOf(e.app);
  var date = dateOf(query.date, days);
  var area = areaOf(e.app, actor, query.scope);
  var editable = rules.isEditable(date, days.today, days.tomorrow);
  var outcome = { plan: null, adopted: 0 };
  if (editable) {
    e.app.runInTransaction(function (txApp) {
      var plan = ensurePlan(txApp, area, date, actor);
      if (date === days.today) {
        outcome.adopted = adoptAutomatic(txApp, plan, area.scope, days);
      }
      outcome.plan = plan;
    });
  } else {
    outcome.plan = planOf(e.app, area.scope, date);
  }
  var isToday = date === days.today && outcome.plan !== null;
  return answer(e, {
    date: date,
    today: days.today,
    tomorrow: days.tomorrow,
    scope: area.scope,
    editable: editable,
    plan: outcome.plan === null ? null : planJson(outcome.plan),
    suggestions: isToday ? suggestionsFor(e.app, outcome.plan, area.scope, days) : [],
    leftover: isToday ? leftoverOf(e.app, area.scope, days.yesterday) : [],
    settings: settingsFor(e.app, area.scope),
    other: otherOf(e.app, area, days.today),
    adopted: outcome.adopted
  });
}

/**
 * POST /api/byl/dayplan/items { ticket, scope?, date?, index? }: puts a ticket into the plan of its
 * area ("Zum Tagesplan", "+" and dragging from the pool). Without `scope` the area of the ticket,
 * without `date` today; a ticket of another area than `scope` is refused (validation_scope_mismatch),
 * a done one as well. An entry that is there already stays (`already`).
 */
function add(e) {
  if (!ready(e.app)) {
    return unavailable(e);
  }
  var actor = actorOf(e);
  var body = bodyOf(e);
  var days = daysOf(e.app);
  var date = dateOf(body.date, days);
  assertEditable(date, days);
  var outcome = { item: null, plan: null, already: false };
  e.app.runInTransaction(function (txApp) {
    var ticket = visibleTicket(e, txApp, typeof body.ticket === 'string' ? body.ticket : '');
    if (ticket === null) {
      throw fail('ticket', 'validation_dayplan_ticket_missing');
    }
    var scope = typeof body.scope === 'string' && body.scope !== '' ? body.scope : ticket.getString('scope');
    var area = areaOf(txApp, actor, scope);
    if (ticket.getString('scope') !== area.scope) {
      throw scopeFailure();
    }
    if (ticket.getString('status') === 'done') {
      throw fail('ticket', 'validation_dayplan_ticket_done');
    }
    var plan = ensurePlan(txApp, area, date, actor);
    var item = itemOf(txApp, plan.id, ticket.id);
    if (item !== null) {
      outcome.already = true;
    } else {
      item = newItem(txApp, plan, ticket.id, 'manual', nextPosition(itemsOf(txApp, plan.id)), actor);
      placeAt(txApp, plan, item, body.index);
      undismiss(txApp, plan, ticket.id);
    }
    outcome.item = findById(txApp, ITEMS, item.id);
    outcome.plan = findById(txApp, PLANS, plan.id);
  });
  return answer(e, { item: itemJson(outcome.item), plan: planJson(outcome.plan), already: outcome.already });
}

/**
 * POST /api/byl/dayplan/adopt { scope?, tickets }: "Übernehmen" of chosen suggestions into the plan of
 * today, at the end in the given order, each with the source it is suggested for (by hand when it is
 * no suggestion any more). Tickets of another area are refused, done ones and those in the plan are
 * left out.
 */
function adopt(e) {
  if (!ready(e.app)) {
    return unavailable(e);
  }
  var actor = actorOf(e);
  var body = bodyOf(e);
  var ids = body.tickets;
  if (Object.prototype.toString.call(ids) !== '[object Array]' || ids.length === 0) {
    throw fail('tickets', 'validation_dayplan_ticket_missing');
  }
  if (ids.length > rules.ADOPT_MAX) {
    throw fail('tickets', 'validation_dayplan_tickets');
  }
  var days = daysOf(e.app);
  var area = areaOf(e.app, actor, body.scope);
  var outcome = { items: [], plan: null };
  e.app.runInTransaction(function (txApp) {
    var plan = ensurePlan(txApp, area, days.today, actor);
    var origins = {};
    var suggestions = suggestionsFor(txApp, plan, area.scope, days);
    for (var i = 0; i < suggestions.length; i++) {
      origins[suggestions[i].id] = suggestions[i].origin;
    }
    var position = nextPosition(itemsOf(txApp, plan.id));
    for (var j = 0; j < ids.length; j++) {
      var ticket = visibleTicket(e, txApp, typeof ids[j] === 'string' ? ids[j] : '');
      if (ticket === null) {
        throw fail('tickets', 'validation_dayplan_ticket_missing');
      }
      if (ticket.getString('scope') !== area.scope) {
        throw errors.fieldFailure('tickets', 'validation_scope_mismatch', rules.SCOPE_TEXT);
      }
      if (ticket.getString('status') === 'done' || itemOf(txApp, plan.id, ticket.id) !== null) {
        continue;
      }
      var origin = Object.prototype.hasOwnProperty.call(origins, ticket.id) ? origins[ticket.id] : 'manual';
      outcome.items.push(newItem(txApp, plan, ticket.id, origin, position, actor));
      position += 1;
      undismiss(txApp, plan, ticket.id);
    }
    outcome.plan = findById(txApp, PLANS, plan.id);
  });
  var items = [];
  for (var k = 0; k < outcome.items.length; k++) {
    items.push(itemJson(outcome.items[k]));
  }
  return answer(e, { items: items, plan: planJson(outcome.plan) });
}

function ticketJson(ticket, previous) {
  return { id: ticket.id, key: ticket.getString('key'), status: ticket.getString('status'), previous_status: previous };
}

/**
 * POST /api/byl/dayplan/items/{id}/check { mode, completion? }: the check mark of an entry. `check`
 * completes a task through the save of the ticket (completion, history with the acting user, the next
 * ticket of a series, the pins) and checks an ongoing project for the day only; `today` is "Nur für
 * heute abhaken", `complete` is "Vorhaben abschließen …". With open blocking sub-tickets the ticket
 * refuses like in the list (validation_parent_open_children) unless `completion` answers the question.
 */
function check(e, id) {
  if (!ready(e.app)) {
    return unavailable(e);
  }
  var actor = actorOf(e);
  var body = bodyOf(e);
  var mode = typeof body.mode === 'string' ? body.mode : 'check';
  var completion = typeof body.completion === 'string' ? body.completion : '';
  if (completion !== '' && COMPLETIONS.indexOf(completion) === -1) {
    throw fail('completion', 'validation_dayplan_mode');
  }
  var days = daysOf(e.app);
  var outcome = { item: null, ticket: null, action: '', previous: '' };
  e.app.runInTransaction(function (txApp) {
    var entry = entryOf(txApp, actor, id);
    assertEditable(entry.plan.getString('date'), days);
    var ticket = findById(txApp, TICKETS, entry.item.getString('ticket'));
    if (ticket === null || ticket.getString('deleted_at') !== '') {
      throw fail('ticket', 'validation_dayplan_ticket_missing');
    }
    var action = rules.checkAction(ticket.getString('kind'), mode);
    if (action === null) {
      throw fail('mode', 'validation_dayplan_mode');
    }
    outcome.previous = ticket.getString('status');
    if (action === 'complete' && outcome.previous !== 'done') {
      var service = require(__hooks + '/lib/ticket-service.js');
      ticket.set('status', 'done');
      ticket.set(service.ACTOR_KEY, actor);
      if (completion === 'force') {
        ticket.set(service.FORCE_DONE_KEY, true);
      } else if (completion === 'complete_children') {
        ticket.set(service.COMPLETE_CHILDREN_KEY, true);
      }
      txApp.save(ticket);
    }
    var item = entry.item;
    if (action === 'today') {
      item.set('done_today', true);
    }
    item.set('checked_by', actor);
    item.set('done_at', new Date(nowOf(txApp)).toISOString());
    txApp.save(item);
    outcome.item = findById(txApp, ITEMS, item.id);
    outcome.ticket = findById(txApp, TICKETS, ticket.id);
    outcome.action = action;
  });
  return answer(e, {
    item: itemJson(outcome.item),
    ticket: ticketJson(outcome.ticket, outcome.previous),
    action: outcome.action
  });
}

/**
 * POST /api/byl/dayplan/items/{id}/uncheck { action?, status? }: takes a check mark back ("Rückgängig"
 * or the check mark itself). `today` only clears the mark of the day; `complete` opens the ticket
 * again with `status` (the status before, "Offen" by default) through the save of the ticket, whose
 * hooks decide about the series (a refusal comes back like in the list). Without `action` the mark of
 * the day goes first, else the ticket opens again.
 */
function uncheck(e, id) {
  if (!ready(e.app)) {
    return unavailable(e);
  }
  var actor = actorOf(e);
  var body = bodyOf(e);
  var action = typeof body.action === 'string' ? body.action : '';
  if (action !== '' && action !== 'today' && action !== 'complete') {
    throw fail('action', 'validation_dayplan_mode');
  }
  var status = typeof body.status === 'string' && body.status !== '' ? body.status : 'open';
  if (REOPEN_STATUSES.indexOf(status) === -1) {
    throw fail('status', 'validation_dayplan_status');
  }
  var days = daysOf(e.app);
  var outcome = { item: null, ticket: null, previous: '' };
  e.app.runInTransaction(function (txApp) {
    var entry = entryOf(txApp, actor, id);
    assertEditable(entry.plan.getString('date'), days);
    var item = entry.item;
    var ticket = findById(txApp, TICKETS, item.getString('ticket'));
    if (ticket === null || ticket.getString('deleted_at') !== '') {
      throw fail('ticket', 'validation_dayplan_ticket_missing');
    }
    var clearDay = action === 'today' || (action === '' && item.getBool('done_today'));
    outcome.previous = ticket.getString('status');
    if (!clearDay && outcome.previous === 'done') {
      ticket.set('status', status);
      ticket.set(require(__hooks + '/lib/ticket-service.js').ACTOR_KEY, actor);
      txApp.save(ticket);
    }
    if (clearDay) {
      item.set('done_today', false);
    }
    item.set('checked_by', '');
    item.set('done_at', '');
    txApp.save(item);
    outcome.item = findById(txApp, ITEMS, item.id);
    outcome.ticket = findById(txApp, TICKETS, ticket.id);
  });
  return answer(e, { item: itemJson(outcome.item), ticket: ticketJson(outcome.ticket, outcome.previous) });
}

/**
 * POST /api/byl/dayplan/items/{id}/tomorrow: "Auf morgen schieben" takes the entry out of the plan of
 * today (the sources leave the ticket out today) and puts it at the end of the plan of tomorrow.
 */
function tomorrow(e, id) {
  if (!ready(e.app)) {
    return unavailable(e);
  }
  var actor = actorOf(e);
  var days = daysOf(e.app);
  var outcome = { item: null, plan: null };
  e.app.runInTransaction(function (txApp) {
    var entry = entryOf(txApp, actor, id);
    if (entry.plan.getString('date') !== days.today) {
      throw fail('date', 'validation_dayplan_tomorrow');
    }
    var ticketId = entry.item.getString('ticket');
    var origin = entry.item.getString('origin');
    var scope = entry.plan.getString('scope');
    txApp.delete(entry.item);
    dismiss(txApp, entry.plan, ticketId);
    var area = { scope: scope, household: entry.plan.getString('household') };
    var next = ensurePlan(txApp, area, days.tomorrow, actor);
    var item = itemOf(txApp, next.id, ticketId);
    if (item === null) {
      item = newItem(txApp, next, ticketId, origin, nextPosition(itemsOf(txApp, next.id)), actor);
      undismiss(txApp, next, ticketId);
    }
    outcome.item = item;
    outcome.plan = findById(txApp, PLANS, next.id);
  });
  return answer(e, { item: itemJson(outcome.item), plan: planJson(outcome.plan) });
}

/** POST /api/byl/dayplan/items/{id}/remove: "Entfernen"; the sources leave the ticket out that day. */
function remove(e, id) {
  if (!ready(e.app)) {
    return unavailable(e);
  }
  var actor = actorOf(e);
  var days = daysOf(e.app);
  var outcome = { plan: null };
  e.app.runInTransaction(function (txApp) {
    var entry = entryOf(txApp, actor, id);
    assertEditable(entry.plan.getString('date'), days);
    var ticketId = entry.item.getString('ticket');
    txApp.delete(entry.item);
    dismiss(txApp, entry.plan, ticketId);
    outcome.plan = findById(txApp, PLANS, entry.plan.id);
  });
  return answer(e, { removed: id, plan: planJson(outcome.plan) });
}

/**
 * POST /api/byl/dayplan/items/{id}/move { index }: puts the entry at `index` of its plan (dragging,
 * "Nach oben", "Nach unten", Alt+arrow) and numbers the plan again. Answers every entry with its
 * position.
 */
function move(e, id) {
  if (!ready(e.app)) {
    return unavailable(e);
  }
  var actor = actorOf(e);
  var body = bodyOf(e);
  var index = typeof body.index === 'number' && isFinite(body.index) ? body.index : null;
  if (index === null) {
    throw fail('index', 'validation_dayplan_index');
  }
  var days = daysOf(e.app);
  var outcome = { items: [] };
  e.app.runInTransaction(function (txApp) {
    var entry = entryOf(txApp, actor, id);
    assertEditable(entry.plan.getString('date'), days);
    var items = itemsOf(txApp, entry.plan.id);
    var ids = [];
    for (var i = 0; i < items.length; i++) {
      ids.push(items[i].id);
    }
    savePositions(txApp, items, rules.moved(ids, entry.item.id, index));
    outcome.items = itemsOf(txApp, entry.plan.id);
  });
  var result = [];
  for (var j = 0; j < outcome.items.length; j++) {
    result.push({ id: outcome.items[j].id, position: outcome.items[j].getInt('position') });
  }
  return answer(e, { items: result });
}

/**
 * POST /api/byl/dayplan/settings { scope?, sources }: the modes of the sources of an area. The private
 * area belongs to the account, the household to every member alike. Missing sources keep their mode.
 */
function saveSettings(e) {
  if (!ready(e.app)) {
    return unavailable(e);
  }
  var actor = actorOf(e);
  var body = bodyOf(e);
  if (rules.sourcesViolation(body.sources) !== '') {
    throw fail('sources', 'validation_dayplan_sources');
  }
  var area = areaOf(e.app, actor, body.scope);
  var outcome = { settings: null };
  e.app.runInTransaction(function (txApp) {
    var record = settingsRecordOf(txApp, area.scope);
    var current = rules.settingsOf(record === null ? null : parsed(record.getString('sources'), null));
    for (var key in body.sources) {
      if (Object.prototype.hasOwnProperty.call(body.sources, key)) {
        current[key] = body.sources[key];
      }
    }
    if (record === null) {
      record = new Record(txApp.findCollectionByNameOrId(SETTINGS));
      record.set('owner', actor);
      record.set('household', area.household);
      record.set('scope', area.scope);
    }
    record.set('sources', current);
    txApp.save(record);
    outcome.settings = current;
  });
  return answer(e, { scope: area.scope, settings: outcome.settings });
}

// --- Hooks of other collections --------------------------------------------------------------------

/**
 * onRecordCreate of tickets: a new ticket without a kind is a task (the default of ADR-0065), also the
 * tickets of a series and duplicates. Before the migration the field does not exist.
 */
function defaultKind(record) {
  if (record.collection().fields.getByName('kind') === null) {
    return;
  }
  if (record.getString('kind') === '') {
    record.set('kind', rules.DEFAULT_KIND);
  }
}

/** The area and the trash of a ticket before a save, for ticketChanged. */
function placeOf(record) {
  return { scope: record.getString('scope'), trashed: record.getString('deleted_at') !== '' };
}

/**
 * onRecordUpdate of tickets after the save (in the transaction of the writer): a ticket that went to
 * the trash loses every entry of every plan, one that went into another area (ADR-0061) every entry of
 * a plan of its old area. The routes of the trash and of moving write in one transaction, so this
 * happens with them or not at all; tabs that see the plans get the "delete" after the commit.
 */
function ticketChanged(app, record, before) {
  if (!ready(app)) {
    return;
  }
  var after = placeOf(record);
  if ((before.trashed || !after.trashed) && before.scope === after.scope) {
    return;
  }
  var items = listOf(app.findRecordsByFilter(ITEMS, 'ticket = {:ticket}', '', 0, 0, { ticket: record.id }));
  for (var i = 0; i < items.length; i++) {
    var plan = findById(app, PLANS, items[i].getString('plan'));
    if (after.trashed || plan === null || plan.getString('scope') !== after.scope) {
      app.delete(items[i]);
    }
  }
}

/**
 * onRecordCreate and onRecordUpdate of day_plans and day_plan_settings: the scope follows owner and
 * household (like the records of every area); also for the superuser in the dashboard.
 */
function prepareArea(record) {
  record.set('scope', ticketKey.scopeOf(record.getString('owner'), record.getString('household')));
}

/**
 * onRecordCreate and onRecordUpdate of day_plan_items: the ticket lies in the area of the plan
 * (ADR-0059 §4), for every writer, the superuser included.
 */
function checkItem(app, record) {
  var plan = findById(app, PLANS, record.getString('plan'));
  var ticket = findById(app, TICKETS, record.getString('ticket'));
  if (plan === null || ticket === null || plan.getString('scope') !== ticket.getString('scope')) {
    throw scopeFailure();
  }
}

module.exports = {
  ready: ready,
  fetch: fetch,
  add: add,
  adopt: adopt,
  check: check,
  uncheck: uncheck,
  tomorrow: tomorrow,
  remove: remove,
  move: move,
  saveSettings: saveSettings,
  defaultKind: defaultKind,
  placeOf: placeOf,
  ticketChanged: ticketChanged,
  prepareArea: prepareArea,
  checkItem: checkItem,
  TEST_NOW_KEY: TEST_NOW_KEY
};
