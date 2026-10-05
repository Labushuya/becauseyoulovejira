// "Zuständig" in the household (E7-5, ADR-0068), the database part. CommonJS module, ES5 only, Goja
// runtime only; the pure rules are in lib/assignee-rules.js. Functions inside a hook take the app of
// the running transaction (`txApp`).
//
// - Tickets: the assignee is a current member of the household of the ticket, a private ticket has
//   none (every writer, the superuser included). An assignment by someone else sets `assigned_at`,
//   deletes the read row of the assignee in the same transaction (the ticket is "neu" for him again,
//   ADR-0015) and, after the commit, tells his open tabs on the topic byl/assigned.
// - Rules of a household: none, "fest" or "abwechselnd" with a stored pointer; every new occurrence
//   gets its person from the generation (lib/recurrence-service.js newInstance).
// - A membership that ends (leaving, being removed, dissolving, deleting an orphaned household) takes
//   the person out of every ticket and rule of that household, with one history entry per ticket.
// - Before the migration 1790204900 the fields are unknown, everything here does nothing.
'use strict';

var rules = require(__hooks + '/lib/assignee-rules.js');
var errors = require(__hooks + '/lib/errors.js');
var berlinTime = require(__hooks + '/lib/berlin-time.js');

var TICKETS = 'tickets';
var RULES = 'recurrence_rules';
var MEMBERS = 'household_members';
var READS = 'ticket_reads';
var USERS = 'users';
var TOPIC = 'byl/assigned';
var HISTORY_FIELD = 'assignee';

// Transient record keys (names with "@" are neither stored nor loaded from a request body).
// NOTICE_KEY carries an assignment by someone else ({ to, by } as JSON) from the model hook of a ticket
// to the after-success hook; CLEANUP_KEY marks the saves of this module that take a person out of a
// ticket (the ticket hooks then only call e.next(), this module writes the history itself);
// NEXT_SENT_KEY marks a request to a rule that names the pointer `assignee_next`; ACTOR_KEY is the
// account behind a membership that ends (the same name as in lib/ticket-service.js).
var NOTICE_KEY = '@assignee_notice';
var CLEANUP_KEY = '@assignee_cleanup';
var NEXT_SENT_KEY = '@assignee_next_sent';
var ACTOR_KEY = '@actor';

function hasField(app, collection, field) {
  try {
    return !!app.findCachedCollectionByNameOrId(collection).fields.getByName(field);
  } catch (err) {
    return false;
  }
}

/** Whether the migration 1790204900 ran for tickets (the field `assignee` exists). */
function ready(app) {
  return hasField(app, TICKETS, 'assignee');
}

/** Whether the migration 1790204900 ran for rules (the field `assignee_mode` exists). */
function rulesReady(app) {
  return hasField(app, RULES, 'assignee_mode');
}

function stringsOf(slice) {
  var list = [];
  if (slice) {
    for (var i = 0; i < slice.length; i++) {
      list.push(String(slice[i]));
    }
  }
  return list;
}

function listOf(found) {
  var list = [];
  for (var i = 0; i < found.length; i++) {
    list.push(found[i]);
  }
  return list;
}

/** The accounts of the members of a household. */
function memberIds(app, household) {
  if (household === '') {
    return [];
  }
  var found = app.findRecordsByFilter(MEMBERS, 'household = {:household}', 'created,id', 0, 0, { household: household });
  var ids = [];
  for (var i = 0; i < found.length; i++) {
    ids.push(found[i].getString('user'));
  }
  return ids;
}

function isMember(app, household, user) {
  if (household === '' || user === '') {
    return false;
  }
  return (
    app.findRecordsByFilter(MEMBERS, 'household = {:household} && user = {:user}', '', 1, 0, {
      household: household,
      user: user
    }).length > 0
  );
}

function fail(field, code, params) {
  return errors.fieldFailure(field, code, rules.MESSAGES[code], params);
}

function historyEntry(txApp, ticketId, oldValue, newValue, actor) {
  var entry = new Record(txApp.findCollectionByNameOrId('ticket_history'));
  entry.set('ticket', ticketId);
  entry.set('field', HISTORY_FIELD);
  entry.set('old_value', oldValue);
  entry.set('new_value', newValue);
  entry.set('user', actor);
  txApp.save(entry);
}

// --- Tickets -----------------------------------------------------------------------------------------

/** Writes of this module that clear an assignee: the ticket hooks leave them alone. */
function skipsTicketHooks(record) {
  return !!record.get(CLEANUP_KEY);
}

/**
 * The model hooks of a ticket before e.next(), in their transaction (lib/ticket-service.js): checks the
 * assignee, keeps `assigned_at` with the server, and marks an assignment by someone else for the read
 * row and the notice. `original` is null on create; `actor` is the account of the write ('' for the
 * server and the superuser).
 */
function prepareTicket(txApp, record, original, actor) {
  if (!ready(txApp)) {
    return;
  }
  var assignee = record.getString('assignee');
  var previous = original ? original.getString('assignee') : '';
  var household = record.getString('household');
  var changed = original === null || assignee !== previous || household !== original.getString('household');
  var code = rules.ticketViolation({
    household: household,
    assignee: assignee,
    changed: changed,
    isMember: assignee !== '' && household !== '' && changed ? isMember(txApp, household, assignee) : false
  });
  if (code !== '') {
    throw fail('assignee', code);
  }
  var facts = { assignee: assignee, previous: previous, actor: actor || '' };
  var action = rules.assignedAtAction(facts);
  if (action === 'set') {
    record.set('assigned_at', berlinTime.toPocketBaseDate(Date.now()));
  } else if (action === 'clear') {
    record.set('assigned_at', '');
  } else {
    record.set('assigned_at', original ? original.getString('assigned_at') : '');
  }
  if (rules.isForeignAssignment(facts)) {
    record.set(NOTICE_KEY, JSON.stringify({ to: assignee, by: facts.actor }));
  }
}

function noticeOf(record) {
  var raw = record.get(NOTICE_KEY);
  if (!raw) {
    return null;
  }
  try {
    return JSON.parse(String(raw));
  } catch (err) {
    return null;
  }
}

/**
 * The model hook of a changed ticket after e.next(), in its transaction: an assignment by someone else
 * deletes the read row of the assignee, so the ticket is "neu" for him again (ADR-0015, ADR-0068 §4).
 */
function afterTicketUpdate(txApp, record) {
  var notice = noticeOf(record);
  if (notice === null) {
    return;
  }
  var rows = txApp.findRecordsByFilter(READS, 'user = {:user} && ticket = {:ticket}', '', 0, 0, {
    user: notice.to,
    ticket: record.id
  });
  for (var i = 0; i < rows.length; i++) {
    txApp.delete(rows[i]);
  }
}

/**
 * After the commit of a create or an update: tells the open tabs of the new assignee that someone else
 * gave him the ticket ("Anna hat dir HAUS-12 zugewiesen."). The message carries the ticket, its key,
 * title and area and who it was (ID and name); only his own tabs get it. Never throws.
 */
function notifyAssigned(app, record) {
  var notice = noticeOf(record);
  if (notice === null) {
    return;
  }
  try {
    var name = '';
    try {
      name = app.findRecordById(USERS, notice.by).getString('name');
    } catch (err) {
      name = '';
    }
    var message = new SubscriptionMessage({
      name: TOPIC,
      data: JSON.stringify({
        ticket: record.id,
        key: record.getString('key'),
        title: record.getString('title'),
        scope: record.getString('scope'),
        by: notice.by,
        by_name: name
      })
    });
    var clients = app.subscriptionsBroker().clients();
    for (var id in clients) {
      var client = clients[id];
      if (!client || client.isDiscarded() || !client.hasSubscription(TOPIC)) {
        continue;
      }
      var auth = client.get('auth');
      if (!auth || auth.collection().name !== USERS || String(auth.id) !== notice.to) {
        continue;
      }
      client.send(message);
    }
  } catch (err) {
    app.logger().warn('byl-assignee: Hinweis an offene Tabs nicht gesendet', 'error', String(err));
  }
}

/**
 * A ticket leaves the household for the private area (moving, ADR-0061): it loses its assignee in the
 * caller's save. Returns the assignee it had ('' for none), for the history entry (clearedHistory).
 */
function dropAssignee(ticket) {
  var previous = ticket.getString('assignee');
  if (previous !== '') {
    ticket.set('assignee', '');
    ticket.set('assigned_at', '');
  }
  return previous;
}

/** "Zuständigkeit entfernt" in the history of a ticket, with the account that caused it. */
function clearedHistory(txApp, ticketId, previous, actor) {
  if (previous !== '') {
    historyEntry(txApp, ticketId, previous, '', actor || '');
  }
}

// --- Rules -------------------------------------------------------------------------------------------

/** Request hooks of rules: whether the body names the pointer `assignee_next`. */
function rememberNextSent(e) {
  var value = e.requestInfo().body['assignee_next'];
  if (value !== undefined && value !== null && value !== '') {
    e.record.set(NEXT_SENT_KEY, true);
  }
}

function ruleState(record) {
  return {
    mode: rules.modeOf(record.getString('assignee_mode')),
    assignees: stringsOf(record.getStringSlice('assignees')),
    next: record.getInt('assignee_next')
  };
}

function writeRule(record, value) {
  record.set('assignee_mode', value.mode);
  record.set('assignees', value.assignees);
  record.set('assignee_next', value.next);
}

function sameList(a, b) {
  if (a.length !== b.length) {
    return false;
  }
  for (var i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) {
      return false;
    }
  }
  return true;
}

/**
 * The model hooks of a rule before e.next() (lib/recurrence-service.js): checks and normalizes the
 * assignment for every writer. `original` is null on create; `system` marks a save of the server,
 * which only moves the pointer (left alone) unless mode, list or household changed as well.
 */
function checkRule(txApp, record, original, system) {
  if (!rulesReady(txApp)) {
    return;
  }
  var after = ruleState(record);
  var before = original ? ruleState(original) : { mode: '', assignees: [], next: 0 };
  var listChanged = original === null || after.mode !== before.mode || !sameList(after.assignees, before.assignees);
  var householdChanged = original !== null && record.getString('household') !== original.getString('household');
  if (system && !listChanged && !householdChanged) {
    return;
  }
  var nextSent = !!record.get(NEXT_SENT_KEY) || (system && original !== null && after.next !== before.next);
  var household = record.getString('household');
  var checked = rules.ruleCheck({
    household: household,
    mode: record.getString('assignee_mode'),
    assignees: after.assignees,
    next: after.next,
    nextSent: nextSent,
    listChanged: listChanged,
    householdChanged: householdChanged,
    members: listChanged || householdChanged ? memberIds(txApp, household) : []
  });
  if (checked.code !== '') {
    var field = checked.code === 'validation_recurrence_assignee_next' ? 'assignee_next' : checked.code === 'validation_recurrence_assignee_mode' ? 'assignee_mode' : 'assignees';
    throw fail(field, checked.code, checked.index >= 0 ? { index: checked.index } : undefined);
  }
  writeRule(record, checked.value);
}

/**
 * The person of a new occurrence of `rule` (newInstance of lib/recurrence-service.js), with the pointer
 * moved on in the record of the rule, which the generation saves after its tickets. A person who is no
 * member any more (never stored, but never a reason to stop the series) gives none.
 */
function occurrenceAssignee(txApp, rule) {
  if (!rulesReady(txApp) || !ready(txApp)) {
    return '';
  }
  var state = ruleState(rule);
  if (state.mode === '') {
    return '';
  }
  var step = rules.nextAssignee(state);
  rule.set('assignee_next', step.next);
  var household = rule.getString('household');
  return step.assignee !== '' && isMember(txApp, household, step.assignee) ? step.assignee : '';
}

/**
 * Reopening an instance removes its untouched follow-up (ADR-0023 section 3): the rotation goes back by
 * one when that follow-up had the person before the pointer. Returns whether the pointer changed (the
 * caller saves the rule).
 */
function takeBackOccurrence(txApp, rule, assignee) {
  if (!rulesReady(txApp)) {
    return false;
  }
  var state = ruleState(rule);
  var next = rules.pointerBack(state, assignee);
  if (next === state.next) {
    return false;
  }
  rule.set('assignee_next', next);
  return true;
}

/** A rule that moves into the private area (ADR-0061): no assignment there. */
function dropRuleAssignment(txApp, rule) {
  if (!rulesReady(txApp)) {
    return;
  }
  writeRule(rule, { mode: '', assignees: [], next: 0 });
}

// --- A membership that ends ------------------------------------------------------------------------

/**
 * onRecordDelete of household_members after e.next(), in the transaction of the route (leaving, being
 * removed, dissolving, deleting an orphaned household; ADR-0068 §6): the person goes out of every
 * ticket of that household (in the trash as well), each with "Zuständigkeit entfernt" in its history
 * by the account behind the change (ACTOR_KEY of the membership, '' without one), and out of every
 * rule of it; a rotation that is empty then becomes "keine". Returns how many tickets and rules
 * changed.
 */
function releaseMembership(txApp, membership) {
  var counts = { tickets: 0, rules: 0 };
  var household = membership.getString('household');
  var user = membership.getString('user');
  if (household === '' || user === '') {
    return counts;
  }
  var actor = membership.get(ACTOR_KEY) ? String(membership.get(ACTOR_KEY)) : '';
  if (ready(txApp)) {
    var tickets = listOf(
      txApp.findRecordsByFilter(TICKETS, 'household = {:household} && assignee = {:user}', 'created,id', 0, 0, {
        household: household,
        user: user
      })
    );
    for (var i = 0; i < tickets.length; i++) {
      var ticket = tickets[i];
      var previous = dropAssignee(ticket);
      ticket.set(CLEANUP_KEY, true);
      txApp.save(ticket);
      clearedHistory(txApp, ticket.id, previous, actor);
      counts.tickets += 1;
    }
  }
  if (rulesReady(txApp)) {
    var recurrence = require(__hooks + '/lib/recurrence-service.js');
    var found = listOf(
      txApp.findRecordsByFilter(RULES, 'household = {:household} && assignees.id ?= {:user}', 'created,id', 0, 0, {
        household: household,
        user: user
      })
    );
    for (var j = 0; j < found.length; j++) {
      var rule = found[j];
      var result = rules.withoutMember(ruleState(rule), user);
      if (!result.changed) {
        continue;
      }
      writeRule(rule, result.value);
      rule.set(recurrence.SYSTEM_KEY, true);
      txApp.save(rule);
      counts.rules += 1;
    }
  }
  return counts;
}

module.exports = {
  TOPIC: TOPIC,
  HISTORY_FIELD: HISTORY_FIELD,
  NOTICE_KEY: NOTICE_KEY,
  CLEANUP_KEY: CLEANUP_KEY,
  ready: ready,
  rulesReady: rulesReady,
  memberIds: memberIds,
  skipsTicketHooks: skipsTicketHooks,
  prepareTicket: prepareTicket,
  afterTicketUpdate: afterTicketUpdate,
  notifyAssigned: notifyAssigned,
  dropAssignee: dropAssignee,
  clearedHistory: clearedHistory,
  rememberNextSent: rememberNextSent,
  checkRule: checkRule,
  occurrenceAssignee: occurrenceAssignee,
  takeBackOccurrence: takeBackOccurrence,
  dropRuleAssignment: dropRuleAssignment,
  releaseMembership: releaseMembership
};
