// Trash for tickets, the database part (ADR-0037, docs/plan/papierkorb.md, package PB-1).
// CommonJS module, ES5 only, Goja runtime only. The pure decisions are in lib/trash-rules.js.
//
// Moving to the trash sets deleted_at, deleted_by and the snapshot `trash` on the ticket and its
// sub-tickets (the group) and clears the relations that would let a ticket in the trash show or
// count anywhere: project, parent (of the ticket itself), series (recurrence, occurrence) and,
// when its sources go back to the inbox, source_item. The API rules hide every ticket with
// deleted_at (migration 1790202300); every other read of the hooks goes through one of these
// relations or checks trashRules.isTrashed. Restoring puts the relations back from the
// snapshot, deleting for good runs the delete hook of tickets.pb.js (history, comments and read
// rows go with the ticket, the sources are settled there).
//
// Writes of the trash run with TRASH_OP_KEY, so the ticket hooks leave key, history and series
// alone; the trash writes its own history entry ("trash"). A change that hides a record does not
// reach realtime clients (PocketBase checks the rules with the new state), so after the commit
// broadcastRemoved sends the same "delete" event a hard delete would have sent, and the topic
// byl/trash tells open tabs of the owners to read the trash again.
'use strict';

var rules = require(__hooks + '/lib/trash-rules.js');
var berlinTime = require(__hooks + '/lib/berlin-time.js');
var errors = require(__hooks + '/lib/errors.js');
var ticketKey = require(__hooks + '/lib/ticket-key.js');
var history = require(__hooks + '/lib/history.js');

var TICKETS = 'tickets';
var INBOX = 'inbox_items';

// Transient record keys: TRASH_OP_KEY marks a write of the trash (the ticket hooks only call
// e.next()), PURGE_KEY a delete for good (the delete hook removes the content of discarded
// sources at once).
var TRASH_OP_KEY = '@trash_op';
var PURGE_KEY = '@trash_purge';

// Realtime topic that tells the tabs of the owners that the trash changed (no data).
var TOPIC = 'byl/trash';

// Visibility without the trash condition: the rule of tickets and inbox items before 1790202300
// (owner or household member). Used for the trash routes and to decide who gets the "delete"
// event of a hidden record.
var VISIBLE_RULE =
  '@request.auth.id != "" && (owner = @request.auth.id || (household != "" && ' +
  '@collection.household_members.household ?= household && @collection.household_members.user ?= @request.auth.id))';

// Rows per batch of the daily run.
var BATCH_SIZE = 100;

function fail(field, code, params) {
  return errors.fieldFailure(field, code, rules.MESSAGES[code], params);
}

function findById(app, collection, id) {
  if (id === '') {
    return null;
  }
  var found = app.findRecordsByFilter(collection, 'id = {:id}', '', 1, 0, { id: id });
  return found.length > 0 ? found[0] : null;
}

function listOf(found) {
  var list = [];
  for (var i = 0; i < found.length; i++) {
    list.push(found[i]);
  }
  return list;
}

/** Whether the migration of the trash ran (tickets.deleted_at exists). */
function trashReady(app) {
  try {
    return !!app.findCachedCollectionByNameOrId(TICKETS).fields.getByName('deleted_at');
  } catch (err) {
    return false;
  }
}

/** Routes of the trash: 503 with the restart hint before the migration. */
function assertReady(app) {
  if (!trashReady(app)) {
    throw new ApiError(503, 'Der Papierkorb steht nach dem nächsten Start der App bereit (stop.bat, dann start.bat).');
  }
}

function isTrashed(record) {
  return rules.isTrashed(record.getString('deleted_at'));
}

/** The signed-in app user of a request ('' for superusers and anonymous requests). */
function actorOf(e) {
  return e.auth && e.auth.collection().name === 'users' ? e.auth.id : '';
}

// onRecordUpdate of tickets: writes of the trash and internal saves of a ticket in the trash
// (PocketBase clearing a deleted tag or user) skip key, history and series.
function skipsTicketHooks(record) {
  return !!record.get(TRASH_OP_KEY) || rules.isTrashed(record.original().getString('deleted_at'));
}

// Ticket request hooks: deleted_at, deleted_by and trash belong to the server. A create may not
// set them, an update may not change them (the admin UI sends every field unchanged).
function guardTrashFields(e, isCreate) {
  if (!trashReady(e.app)) {
    return;
  }
  var fields = ['deleted_at', 'deleted_by', 'trash'];
  for (var i = 0; i < fields.length; i++) {
    var value = e.record.getString(fields[i]);
    var before = isCreate ? '' : e.record.original().getString(fields[i]);
    if (value !== before && !(fields[i] === 'trash' && (value === 'null' || value === '') && (before === 'null' || before === ''))) {
      throw fail(fields[i], 'validation_trash_managed');
    }
  }
}

function stamp(nowMs) {
  return berlinTime.toPocketBaseDate(nowMs);
}

function historyEntry(txApp, ticketId, field, oldValue, newValue, actor) {
  var entry = new Record(txApp.findCollectionByNameOrId('ticket_history'));
  entry.set('ticket', ticketId);
  entry.set('field', field);
  entry.set('old_value', oldValue);
  entry.set('new_value', newValue);
  entry.set('user', actor);
  txApp.save(entry);
}

// The users that see a ticket: its owner and the members of its household.
function viewersOf(app, ticket) {
  var ids = [ticket.getString('owner')];
  var household = ticket.getString('household');
  if (household !== '') {
    var members = app.findRecordsByFilter('household_members', 'household = {:h}', '', 0, 0, { h: household });
    for (var i = 0; i < members.length; i++) {
      if (ids.indexOf(members[i].getString('user')) === -1) {
        ids.push(members[i].getString('user'));
      }
    }
  }
  return ids;
}

function signedInClients(app) {
  var clients = app.subscriptionsBroker().clients();
  var found = [];
  for (var id in clients) {
    var client = clients[id];
    if (!client || client.isDiscarded()) {
      continue;
    }
    var auth = client.get('auth');
    if (!auth || auth.collection().name !== 'users') {
      continue;
    }
    found.push({ client: client, auth: auth });
  }
  return found;
}

/**
 * After the commit: the "delete" event of every record the trash hides, for each app client that
 * could see it and subscribed to its collection or to the record itself, under the name of that
 * subscription (with its options). Only id and collection go out, like a hard delete needs.
 * Never throws: a client that went away simply misses it, and a reload or a reconnection brings
 * the lists up to date.
 */
function broadcastRemoved(app, collectionName, records) {
  if (records.length === 0) {
    return;
  }
  try {
    var targets = signedInClients(app);
    for (var t = 0; t < targets.length; t++) {
      var client = targets[t].client;
      var subscriptions = client.subscriptions(collectionName + '/');
      var names = [];
      for (var name in subscriptions) {
        names.push(name);
      }
      if (names.length === 0) {
        continue;
      }
      var info = new RequestInfo({ auth: targets[t].auth });
      for (var r = 0; r < records.length; r++) {
        var record = records[r];
        if (!app.canAccessRecord(record, info, VISIBLE_RULE)) {
          continue;
        }
        var data = JSON.stringify({
          action: 'delete',
          record: { id: record.id, collectionId: record.collection().id, collectionName: collectionName }
        });
        for (var n = 0; n < names.length; n++) {
          var base = names[n].split('?')[0];
          if (base === collectionName + '/*' || base === collectionName + '/' + record.id) {
            client.send(new SubscriptionMessage({ name: names[n], data: data }));
          }
        }
      }
    }
  } catch (err) {
    app.logger().warn('Papierkorb: Realtime-Hinweis nicht gesendet', 'error', String(err));
  }
}

/** After the commit: tells the open tabs of these users that their trash changed. */
function notifyTrash(app, userIds) {
  try {
    var targets = signedInClients(app);
    var message = new SubscriptionMessage({ name: TOPIC, data: '{}' });
    for (var i = 0; i < targets.length; i++) {
      if (userIds.indexOf(targets[i].auth.id) !== -1 && targets[i].client.hasSubscription(TOPIC)) {
        targets[i].client.send(message);
      }
    }
  } catch (err) {
    app.logger().warn('Papierkorb: Hinweis an offene Tabs nicht gesendet', 'error', String(err));
  }
}

// --- Moving to the trash ------------------------------------------------------------------------

// One ticket of the group: series released like a delete, sources settled, snapshot written,
// relations cleared. Returns the sources that stay with it ("Quellen verwerfen"), hidden now.
function trashOne(txApp, ticket, isRoot, handling, actor, nowMs) {
  var recurrence = require(__hooks + '/lib/recurrence-service.js');
  var inbox = require(__hooks + '/lib/inbox-service.js');
  var at = stamp(nowMs);
  // Like deleting the open instance (ADR-0023 §6): the date counts as skipped, "nach Erledigung"
  // waits as if done today; a new instance comes with the next date, never at once.
  recurrence.prepareTicketDelete(txApp, ticket, nowMs);
  var sourceIds = inbox.sourcesOfDeletedTicket(txApp, ticket);
  var projectId = ticket.getString('project');
  var project = findById(txApp, 'projects', projectId);
  var key = ticket.getString('key');
  ticket.set('trash', {
    project: projectId,
    project_code: project ? project.getString('code') : '',
    parent: isRoot ? ticket.getString('parent') : '',
    recurrence: ticket.getString('recurrence'),
    occurrence: ticket.getString('occurrence'),
    source_item: handling === 'inbox' ? ticket.getString('source_item') : '',
    sources: { handling: handling, items: sourceIds }
  });
  ticket.set('deleted_at', at);
  ticket.set('deleted_by', actor);
  ticket.set('project', '');
  ticket.set('recurrence', '');
  if (recurrence.eachReady(txApp)) {
    ticket.set('occurrence', '');
  }
  if (isRoot) {
    ticket.set('parent', '');
  }
  if (handling === 'inbox') {
    ticket.set('source_item', '');
  }
  ticket.set(TRASH_OP_KEY, true);
  txApp.save(ticket);
  historyEntry(txApp, ticket.id, rules.TRASH_FIELD, '', rules.TRASHED, actor);

  var hidden = [];
  if (handling === 'inbox') {
    inbox.settleSourcesOfDeletedTicket(txApp, sourceIds, 'inbox', key, { ticket: ticket.id, silent: true });
  } else {
    for (var i = 0; i < sourceIds.length; i++) {
      var item = findById(txApp, INBOX, sourceIds[i]);
      if (item && item.getString('ticket') === ticket.id) {
        hidden.push(item);
      }
    }
  }
  return hidden;
}

/**
 * Moves a ticket and its sub-tickets to the trash in one transaction (ADR-0037 §2). `handling`
 * of the sources: 'inbox' or 'discard'. The caller checked the access. Returns { id, updated,
 * tickets: [{ id, key, updated }] }; `updated` is the base of "Rückgängig" (expected_updated).
 */
function moveToTrash(app, id, handling, actor) {
  if (rules.SOURCE_HANDLINGS.indexOf(handling) === -1) {
    throw fail('sources', 'validation_trash_source_handling');
  }
  var moved = null;
  var hidden = [];
  var nowMs = Date.now();
  app.runInTransaction(function (txApp) {
    var root = findById(txApp, TICKETS, id);
    if (!root || isTrashed(root)) {
      throw new NotFoundError('Ticket nicht gefunden.');
    }
    var members = [root].concat(
      listOf(txApp.findRecordsByFilter(TICKETS, 'parent = {:id}', 'created,id', 0, 0, { id: root.id }))
    );
    for (var i = 0; i < members.length; i++) {
      hidden = hidden.concat(trashOne(txApp, members[i], i === 0, handling, actor, nowMs));
    }
    moved = members;
  });
  broadcastRemoved(app, TICKETS, moved);
  broadcastRemoved(app, INBOX, hidden);
  notifyTrash(app, viewersOf(app, moved[0]));
  var tickets = [];
  for (var j = 0; j < moved.length; j++) {
    tickets.push({ id: moved[j].id, key: moved[j].getString('key'), updated: moved[j].getString('updated') });
  }
  return { id: moved[0].id, updated: moved[0].getString('updated'), tickets: tickets };
}

/**
 * onRecordDeleteRequest of tickets once the trash exists: every way to delete through the Record
 * API moves the ticket to the trash, its sources back to the inbox (the safe default of HK-6),
 * and answers 204 like a delete. A ticket that is in the trash already (only a superuser sees
 * one, in the admin UI) is deleted for good with its group. The handler answers itself instead
 * of calling e.next(): e.next() would run the hard delete of PocketBase.
 */
function deleteRequest(e) {
  if (isTrashed(e.record)) {
    var viewers = [];
    e.app.runInTransaction(function (txApp) {
      var root = findById(txApp, TICKETS, e.record.id);
      if (root) {
        viewers = viewersOf(txApp, root);
        purgeGroup(txApp, root);
      }
    });
    notifyTrash(e.app, viewers);
    return e.noContent(204);
  }
  moveToTrash(e.app, e.record.id, 'inbox', actorOf(e));
  return e.noContent(204);
}

// --- Restoring ------------------------------------------------------------------------------

function groupOf(txApp, root) {
  return [root].concat(
    listOf(
      txApp.findRecordsByFilter(TICKETS, "parent = {:id} && deleted_at != ''", 'created,id', 0, 0, { id: root.id })
    )
  );
}

// Loads a ticket of the trash the request may see; a sub-ticket of a group is refused (it comes
// back with its parent).
function trashedRoot(e, txApp, id) {
  var ticket = findById(txApp, TICKETS, id);
  if (!ticket || !isTrashed(ticket) || !txApp.canAccessRecord(ticket, e.requestInfo(), VISIBLE_RULE)) {
    throw new NotFoundError('Ticket nicht im Papierkorb.');
  }
  if (ticket.getString('parent') !== '') {
    throw fail('id', 'validation_trash_group_member', { parent: ticket.getString('parent') });
  }
  return ticket;
}

// The project a member of the group goes back to: { project (record or null), newKey }.
function projectPlan(txApp, member, snapshot, target) {
  var current = findById(txApp, 'projects', snapshot.project);
  var decision = rules.projectDecision({
    snapshotProject: snapshot.project,
    snapshotCode: snapshot.project_code,
    project: current ? { scope: current.getString('scope'), code: current.getString('code') } : null,
    ticketScope: member.getString('scope')
  });
  if (decision.action === 'keep') {
    return { project: current, newKey: false };
  }
  if (target === undefined) {
    throw fail('project', 'validation_trash_project_required', {
      code: snapshot.project_code,
      reason: decision.reason,
      key: member.getString('key')
    });
  }
  return { project: target, newKey: true };
}

// The chosen target project: '' (none), a record, or a failure.
function targetOf(txApp, body, scope) {
  if (body.project === undefined || body.project === null) {
    return undefined;
  }
  var id = String(body.project);
  if (id === '') {
    return null;
  }
  var project = findById(txApp, 'projects', id);
  var violation = rules.targetViolation(
    project ? { scope: project.getString('scope'), archived: project.getBool('archived') } : null,
    scope
  );
  if (violation !== '') {
    throw fail('project', violation);
  }
  return project;
}

// Whether a member goes back into its series: { series, note } with note '' | 'rule_missing' |
// 'detached'. A conflict with an open ticket of the same series is refused unless the client
// asked to restore it as a normal ticket (detach_series), never doubled silently.
function seriesPlan(txApp, member, snapshot, detach) {
  var recurrence = require(__hooks + '/lib/recurrence-service.js');
  var recurrenceRules = require(__hooks + '/lib/recurrence-rules.js');
  if (snapshot.recurrence === '') {
    return { series: false, note: '' };
  }
  var rule = findById(txApp, 'recurrence_rules', snapshot.recurrence);
  if (!rule || ticketKey.scopeOf(rule.getString('owner'), rule.getString('household')) !== member.getString('scope')) {
    return { series: false, note: 'rule_missing' };
  }
  if (detach) {
    return { series: false, note: 'detached' };
  }
  if (member.getString('status') === 'done') {
    return { series: true, note: '' };
  }
  var each = rule.getBool('each_occurrence') && rule.getString('mode') === 'calendar' && recurrence.eachReady(txApp);
  var others = txApp.findRecordsByFilter(
    TICKETS,
    "recurrence = {:rule} && status != 'done' && deleted_at = '' && id != {:id}",
    '-created',
    0,
    0,
    { rule: rule.id, id: member.id }
  );
  var open = [];
  for (var i = 0; i < others.length; i++) {
    open.push({ ticket: others[i], occurrence: each ? others[i].getString('occurrence') : '' });
  }
  var conflicts = recurrenceRules.reopenConflicts(open, each ? snapshot.occurrence : '', each);
  if (conflicts.length > 0) {
    throw fail('recurrence', 'validation_trash_series_conflict', {
      key: conflicts[0].ticket.getString('key'),
      ticket: conflicts[0].ticket.id,
      trashKey: member.getString('key')
    });
  }
  return { series: true, note: '' };
}

// Sources given back to the inbox: which ones come back ({ item, skip }).
function sourcePlan(txApp, member, snapshot) {
  var plan = [];
  if (snapshot.sources.handling !== 'inbox') {
    return plan;
  }
  for (var i = 0; i < snapshot.sources.items.length; i++) {
    var item = findById(txApp, INBOX, snapshot.sources.items[i]);
    var skip = rules.sourceSkip(
      item
        ? { state: item.getString('state'), ticket: item.getString('ticket'), scope: item.getString('scope') }
        : null,
      member.getString('scope')
    );
    plan.push({ id: snapshot.sources.items[i], item: item, skip: skip });
  }
  return plan;
}

function restoreOne(txApp, member, isRoot, plan, actor, result) {
  var inbox = require(__hooks + '/lib/inbox-service.js');
  var recurrence = require(__hooks + '/lib/recurrence-service.js');
  var service = require(__hooks + '/lib/ticket-service.js');
  var snapshot = plan.snapshot;
  var before = service.historyValues(member);
  before.project = snapshot.project;
  before.recurrence = snapshot.recurrence;
  before.parent = isRoot ? snapshot.parent : member.getString('parent');

  var mainBack = false;
  for (var s = 0; s < plan.sources.length; s++) {
    if (plan.sources[s].id === snapshot.source_item && plan.sources[s].skip === '') {
      mainBack = true;
    }
  }
  member.set('deleted_at', '');
  member.set('deleted_by', '');
  member.set('trash', null);
  member.set('project', plan.project.project ? plan.project.project.id : '');
  if (plan.project.newKey) {
    service.assignKey(txApp, member, member.getString('scope'), plan.project.project);
  }
  member.set('recurrence', plan.series.series ? snapshot.recurrence : '');
  if (recurrence.eachReady(txApp)) {
    member.set('occurrence', plan.series.series ? snapshot.occurrence : '');
  }
  if (isRoot) {
    member.set('parent', plan.reattach ? snapshot.parent : '');
  }
  if (mainBack) {
    member.set('source_item', snapshot.source_item);
  }
  member.set(TRASH_OP_KEY, true);
  txApp.save(member);

  historyEntry(txApp, member.id, rules.TRASH_FIELD, rules.TRASHED, rules.RESTORED, actor);
  var changes = history.diff(before, service.historyValues(member));
  for (var c = 0; c < changes.length; c++) {
    historyEntry(txApp, member.id, changes[c].field, changes[c].old_value, changes[c].new_value, actor);
  }

  for (var i = 0; i < plan.sources.length; i++) {
    var source = plan.sources[i];
    if (source.skip !== '') {
      result.sources_skipped.push({
        id: source.id,
        title: source.item ? source.item.getString('title') : '',
        reason: source.skip,
        key: member.getString('key')
      });
      continue;
    }
    source.item.set('state', 'converted');
    source.item.set('ticket', member.id);
    source.item.set(inbox.SILENT_KEY, true);
    txApp.save(source.item);
  }
  if (snapshot.sources.handling === 'discard') {
    // The sources stayed with the ticket; saved again so open tabs get them back by realtime.
    var kept = txApp.findRecordsByFilter(INBOX, 'ticket = {:id}', 'created,id', 0, 0, { id: member.id });
    for (var k = 0; k < kept.length; k++) {
      kept[k].set(inbox.SILENT_KEY, true);
      txApp.save(kept[k]);
    }
  }
  if (plan.project.newKey) {
    result.new_keys.push({ id: member.id, key: member.getString('key'), previous: before.key });
  }
  if (plan.series.note === 'rule_missing') {
    result.rule_missing.push(member.getString('key'));
  } else if (plan.series.note === 'detached') {
    result.series_detached.push(member.getString('key'));
  }
}

/**
 * Restores a ticket of the trash with its group (ADR-0037 §4 to §7). Body: expected_updated
 * (refuses if the ticket changed since, "Rückgängig"), project (target when the project is gone
 * or has another code: '' for none, else an active project of the scope), detach_series (restore
 * instances as normal tickets when their series has an open ticket). Everything is checked
 * before the first write; the writes run in one transaction. Returns the result for the SPA.
 */
function restore(e, id) {
  var body = e.requestInfo().body || {};
  var actor = actorOf(e);
  var detach = body.detach_series === true || body.detach_series === 'true';
  var result = {
    id: id,
    key: '',
    updated: '',
    tickets: [],
    new_keys: [],
    parent_detached: false,
    rule_missing: [],
    series_detached: [],
    sources_skipped: []
  };
  var members = [];
  e.app.runInTransaction(function (txApp) {
    var root = trashedRoot(e, txApp, id);
    if (body.expected_updated !== undefined && body.expected_updated !== null && String(body.expected_updated) !== root.getString('updated')) {
      throw fail('id', 'validation_trash_stale');
    }
    members = groupOf(txApp, root);
    var target = targetOf(txApp, body, root.getString('scope'));
    var plans = [];
    for (var i = 0; i < members.length; i++) {
      var snapshot = rules.readSnapshot(members[i].getString('trash'));
      plans.push({
        snapshot: snapshot,
        project: projectPlan(txApp, members[i], snapshot, target),
        series: seriesPlan(txApp, members[i], snapshot, detach),
        sources: sourcePlan(txApp, members[i], snapshot),
        reattach: false
      });
    }
    var rootSnapshot = plans[0].snapshot;
    if (rootSnapshot.parent !== '') {
      var parent = findById(txApp, TICKETS, rootSnapshot.parent);
      plans[0].reattach =
        members.length === 1 &&
        rules.reattachesParent(
          parent
            ? { scope: parent.getString('scope'), parent: parent.getString('parent'), trashed: isTrashed(parent) }
            : null,
          root.getString('scope')
        );
      result.parent_detached = !plans[0].reattach;
    }
    for (var j = 0; j < members.length; j++) {
      restoreOne(txApp, members[j], j === 0, plans[j], actor, result);
    }
  });
  for (var k = 0; k < members.length; k++) {
    result.tickets.push({ id: members[k].id, key: members[k].getString('key'), updated: members[k].getString('updated') });
  }
  result.key = members[0].getString('key');
  result.updated = members[0].getString('updated');
  notifyTrash(e.app, viewersOf(e.app, members[0]));
  return result;
}

// --- Deleting for good ------------------------------------------------------------------------

// Deletes a group for good inside a transaction: sub-tickets first, each through the delete hook
// of tickets.pb.js with the discarded sources emptied at once (PURGE_KEY). Returns the count.
function purgeGroup(txApp, root) {
  var inbox = require(__hooks + '/lib/inbox-service.js');
  var members = groupOf(txApp, root);
  for (var i = members.length - 1; i >= 0; i--) {
    members[i].set(inbox.SOURCE_HANDLING_KEY, 'discard');
    members[i].set(PURGE_KEY, true);
    txApp.delete(members[i]);
  }
  return members.length;
}

/** "Endgültig löschen" of one ticket of the trash with its group (ADR-0037 §8). */
function purge(e, id) {
  var viewers = [];
  e.app.runInTransaction(function (txApp) {
    var root = trashedRoot(e, txApp, id);
    viewers = viewersOf(txApp, root);
    purgeGroup(txApp, root);
  });
  notifyTrash(e.app, viewers);
}

// Tickets of the trash (groups only by their first ticket) the user sees, newest first.
function visibleRoots(app, userId) {
  var memberships = app.findRecordsByFilter('household_members', 'user = {:user}', '', 0, 0, { user: userId });
  var filter = "deleted_at != '' && parent = '' && (owner = {:user}";
  var params = { user: userId };
  for (var i = 0; i < memberships.length; i++) {
    filter += ' || household = {:h' + i + '}';
    params['h' + i] = memberships[i].getString('household');
  }
  filter += ')';
  return listOf(app.findRecordsByFilter(TICKETS, filter, '-deleted_at,-id', 0, 0, params));
}

/** "Papierkorb leeren": every group of the trash the user sees, each in its own transaction. */
function empty(e) {
  var roots = visibleRoots(e.app, e.auth.id);
  var purged = 0;
  var viewers = [e.auth.id];
  for (var i = 0; i < roots.length; i++) {
    e.app.runInTransaction(function (txApp) {
      var root = findById(txApp, TICKETS, roots[i].id);
      if (root && isTrashed(root)) {
        var ids = viewersOf(txApp, root);
        for (var v = 0; v < ids.length; v++) {
          if (viewers.indexOf(ids[v]) === -1) {
            viewers.push(ids[v]);
          }
        }
        purged += purgeGroup(txApp, root);
      }
    });
  }
  notifyTrash(e.app, viewers);
  return purged;
}

function retentionOf(app, cache, ownerId) {
  if (!Object.prototype.hasOwnProperty.call(cache, ownerId)) {
    var user = findById(app, 'users', ownerId);
    cache[ownerId] = rules.retentionDays(user ? user.getString('trash_retention') : '');
  }
  return cache[ownerId];
}

/**
 * Daily run (ADR-0037 §8): deletes for good every group whose retention (of its owner) ran out.
 * Idempotent; each group in its own transaction, a failing one is logged and the others go on.
 * Never throws. Returns { checked, purged, failed, unavailable }.
 */
function purgeDue(app, nowMs) {
  var result = { checked: 0, purged: 0, failed: 0, unavailable: false };
  if (!trashReady(app)) {
    result.unavailable = true;
    return result;
  }
  var cache = {};
  var after = '';
  var viewers = [];
  for (;;) {
    var batch = app.findRecordsByFilter(
      TICKETS,
      "deleted_at != '' && parent = '' && id > {:after}",
      'id',
      BATCH_SIZE,
      0,
      { after: after }
    );
    for (var i = 0; i < batch.length; i++) {
      var candidate = batch[i];
      after = candidate.id;
      result.checked += 1;
      var days = retentionOf(app, cache, candidate.getString('owner'));
      if (!rules.isDue(candidate.getString('deleted_at'), days, nowMs, berlinTime)) {
        continue;
      }
      try {
        app.runInTransaction(function (txApp) {
          var root = findById(txApp, TICKETS, candidate.id);
          if (root && isTrashed(root) && root.getString('parent') === '') {
            viewers = viewers.concat(viewersOf(txApp, root));
            result.purged += purgeGroup(txApp, root);
          }
        });
      } catch (err) {
        result.failed += 1;
        app.logger().warn('Papierkorb: Ticket nicht endgültig gelöscht', 'ticket', candidate.id, 'error', String(err));
      }
    }
    if (batch.length < BATCH_SIZE) {
      break;
    }
  }
  if (result.purged > 0 || result.failed > 0) {
    app.logger().info('Papierkorb: abgelaufene Tickets endgültig gelöscht', 'tickets', result.purged, 'failed', result.failed);
    notifyTrash(app, viewers);
  }
  return result;
}

// --- Reading --------------------------------------------------------------------------------

function projectInfo(app, snapshot) {
  if (snapshot.project === '') {
    return null;
  }
  var project = findById(app, 'projects', snapshot.project);
  return {
    id: snapshot.project,
    code: snapshot.project_code,
    name: project ? project.getString('name') : '',
    exists: !!project && project.getString('code') === snapshot.project_code
  };
}

function summaryOf(app, ticket, cache, nowMs) {
  var snapshot = rules.readSnapshot(ticket.getString('trash'));
  var days = retentionOf(app, cache, ticket.getString('owner'));
  var children = app.findRecordsByFilter(TICKETS, "parent = {:id} && deleted_at != ''", '', 0, 0, { id: ticket.id });
  return {
    id: ticket.id,
    key: ticket.getString('key'),
    title: ticket.getString('title'),
    status: ticket.getString('status'),
    priority: ticket.getString('priority'),
    due: ticket.getString('due'),
    project: projectInfo(app, snapshot),
    recurring: snapshot.recurrence !== '',
    children: children.length,
    deleted_at: ticket.getString('deleted_at'),
    deleted_by: ticket.getString('deleted_by'),
    updated: ticket.getString('updated'),
    days_left: rules.daysLeft(ticket.getString('deleted_at'), days, nowMs, berlinTime),
    purge_date: rules.purgeDate(ticket.getString('deleted_at'), days, berlinTime)
  };
}

/** GET /api/byl/trash: { items, retention } of the signed-in user. */
function list(e) {
  var cache = {};
  var nowMs = Date.now();
  var roots = visibleRoots(e.app, e.auth.id);
  var items = [];
  for (var i = 0; i < roots.length; i++) {
    items.push(summaryOf(e.app, roots[i], cache, nowMs));
  }
  var retention = e.auth.getString('trash_retention');
  return { items: items, retention: rules.isRetention(retention) ? retention : '' };
}

/**
 * GET /api/byl/trash/{id}: the read-only preview of a ticket of the trash, also of a sub-ticket
 * (then with `group`, the first ticket of its group): the summary plus description, tags,
 * sub-tickets and the handling of the sources.
 */
function preview(e, id) {
  var ticket = findById(e.app, TICKETS, id);
  if (!ticket || !isTrashed(ticket) || !e.app.canAccessRecord(ticket, e.requestInfo(), VISIBLE_RULE)) {
    throw new NotFoundError('Ticket nicht im Papierkorb.');
  }
  var summary = summaryOf(e.app, ticket, {}, Date.now());
  var snapshot = rules.readSnapshot(ticket.getString('trash'));
  var tags = [];
  var tagIds = ticket.getStringSlice('tags');
  for (var i = 0; i < tagIds.length; i++) {
    var tag = findById(e.app, 'tags', String(tagIds[i]));
    if (tag) {
      tags.push({ id: tag.id, name: tag.getString('name') });
    }
  }
  var children = [];
  var found = e.app.findRecordsByFilter(TICKETS, "parent = {:id} && deleted_at != ''", 'created,id', 0, 0, { id: ticket.id });
  for (var j = 0; j < found.length; j++) {
    children.push({ id: found[j].id, key: found[j].getString('key'), title: found[j].getString('title'), status: found[j].getString('status') });
  }
  summary.description = ticket.getString('description');
  summary.tags = tags;
  summary.subtasks = children;
  summary.group = ticket.getString('parent');
  summary.sources = { handling: snapshot.sources.handling, count: snapshot.sources.items.length };
  return summary;
}

module.exports = {
  TRASH_OP_KEY: TRASH_OP_KEY,
  PURGE_KEY: PURGE_KEY,
  TOPIC: TOPIC,
  VISIBLE_RULE: VISIBLE_RULE,
  trashReady: trashReady,
  assertReady: assertReady,
  actorOf: actorOf,
  skipsTicketHooks: skipsTicketHooks,
  guardTrashFields: guardTrashFields,
  moveToTrash: moveToTrash,
  deleteRequest: deleteRequest,
  restore: restore,
  purge: purge,
  empty: empty,
  purgeDue: purgeDue,
  list: list,
  preview: preview
};
