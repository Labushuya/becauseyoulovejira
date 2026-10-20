// The outbox of the SPA at the server (OF-1, ADR-0074): identifiers of actions in client_ops, the time
// of the device and the conditional change per field. CommonJS module, ES5 only, Goja runtime only;
// the pure rules are in lib/client-ops-rules.js.
//
// - A request of an app account may name its action (`op_id`). The request hook remembers it on the
//   record (transient keys, never stored); the model hook looks it up and notes it in the transaction
//   of the change, so the note and the change are written together or not at all. An identifier the
//   account noted before changes nothing and answers like the first time: the Record API with the
//   record in its current state (expand and fields of the request), the routes of the day plan with
//   their answer. Two requests with the same identifier at the same time: PocketBase runs every
//   transaction on its one connection for writes, so the second one finds the note of the first in
//   its transaction, writes nothing, and its request hook answers the same way (the unique index of
//   (user, op) is the net).
// - Identifiers belong to their account: the index is per account, so another account neither reaches
//   nor notices them.
// - Rights stay those of the normal ways: the rules of the Record API run before these hooks, the
//   routes check the area themselves.
// - Before the migration of client_ops (the instance has new hooks, but no restart yet) nothing of
//   this works, and every request behaves as before.
'use strict';

var rules = require(__hooks + '/lib/client-ops-rules.js');
var errors = require(__hooks + '/lib/errors.js');

var OPS = 'client_ops';
var KEYS = rules.KEYS;

/** True once the migration of client_ops ran (the running instance may still miss it). */
function ready(app) {
  try {
    app.findCollectionByNameOrId(OPS);
    return true;
  } catch (err) {
    return false;
  }
}

function isAppUser(e) {
  return !!(e.auth && e.auth.collection().name === 'users');
}

function fail(field, code, params) {
  return errors.fieldFailure(field, code, rules.MESSAGES[code], params);
}

function bodyOf(e) {
  var body = e.requestInfo().body;
  return body && typeof body === 'object' ? body : {};
}

function findById(app, collection, id) {
  if (!id) {
    return null;
  }
  var found = app.findRecordsByFilter(collection, 'id = {:id}', '', 1, 0, { id: String(id) });
  return found.length > 0 ? found[0] : null;
}

function hasField(collection, name) {
  try {
    return !!collection.fields.getByName(name);
  } catch (err) {
    return false;
  }
}

function resultOf(record) {
  var raw = record.getString('result');
  if (raw === '' || raw === 'null') {
    return null;
  }
  try {
    return JSON.parse(raw);
  } catch (err) {
    return null;
  }
}

/** The note of `op` of the account `user` as { id, kind, record, result }, or null. */
function findClaim(app, user, op) {
  var found = app.findRecordsByFilter(OPS, 'user = {:user} && op = {:op}', '', 1, 0, { user: String(user), op: String(op) });
  if (found.length === 0) {
    return null;
  }
  return { id: found[0].id, kind: found[0].getString('kind'), record: found[0].getString('record'), result: resultOf(found[0]) };
}

/** Notes `op` of the account in the transaction of the change; `result` only for the routes. */
function insertClaim(txApp, user, op, kind, recordId, result) {
  var claim = new Record(txApp.findCollectionByNameOrId(OPS));
  claim.set('user', user);
  claim.set('op', op);
  claim.set('kind', kind);
  claim.set('record', recordId);
  if (result) {
    claim.set('result', result);
  }
  txApp.save(claim);
}

/**
 * The fields of a request for the routes and the request hooks: { op, user, offline, deviceAt } of an
 * app account after the migration; the identifier is checked (validation_op_invalid). Without the
 * migration or without an app account: no identifier, no user, not offline.
 */
function requestOf(e) {
  if (!isAppUser(e) || !ready(e.app)) {
    return { op: '', user: '', offline: false, deviceAt: '' };
  }
  var body = bodyOf(e);
  var op = rules.opOf(body.op_id);
  if (op.code !== '') {
    throw fail('op_id', op.code);
  }
  var offline = rules.offlineOf(body, Date.now());
  return { op: op.op, user: String(e.auth.id), offline: offline.offline, deviceAt: offline.deviceAt };
}

/** Whether `record` carries the mark of an action from the outbox. */
function isMarked(record) {
  return !!record.get(KEYS.offline);
}

/** The time of the device the mark of `record` names, '' without one. */
function deviceAtOf(record) {
  return isMarked(record) ? String(record.get(KEYS.deviceAt) || '') : '';
}

/** Puts the mark of an action from the outbox on `record`, for the history of its save. */
function markOffline(record, request) {
  if (request.offline) {
    record.set(KEYS.offline, true);
    record.set(KEYS.deviceAt, request.deviceAt);
  }
}

/** Passes the mark of `from` on to `to` (sub-tasks completed along, ADR-0033 §2). */
function copyOffline(from, to) {
  if (isMarked(from)) {
    to.set(KEYS.offline, true);
    to.set(KEYS.deviceAt, deviceAtOf(from));
  }
}

/**
 * The history entry of a save (lib/ticket-service.js saveHistoryEntry): `offline` and `device_at` from
 * the mark of the ticket, when the collection has the fields. `created` stays the time of the server.
 */
function markHistory(item, ticket, collection) {
  if (!isMarked(ticket) || !hasField(collection, 'offline')) {
    return;
  }
  item.set('offline', true);
  item.set('device_at', deviceAtOf(ticket));
}

/**
 * Request hooks of the Record API: remembers the identifier, the mark of the outbox and, for the change
 * of a ticket, the expected values (validation_expected_invalid). Returns the identifier, '' without one.
 */
function remember(e, kind) {
  var request = requestOf(e);
  if (request.user === '') {
    return '';
  }
  markOffline(e.record, request);
  if (kind === 'ticket.update') {
    var expected = bodyOf(e).expected;
    var history = require(__hooks + '/lib/history.js');
    if (rules.expectedViolation(expected, history.TRACKED_FIELDS) !== '') {
      throw fail('expected', 'validation_expected_invalid');
    }
    if (expected !== undefined && expected !== null) {
      e.record.set(KEYS.expected, JSON.stringify(expected));
    }
  }
  if (request.op !== '') {
    e.record.set(KEYS.op, request.op);
    e.record.set(KEYS.user, request.user);
  }
  return request.op;
}

/**
 * The answer to an identifier the account used before: the record of the first time in its current
 * state, with expand and fields of the request, as the Record API answers. Another action under the
 * identifier is refused (validation_op_reused); a record the account no longer sees is named only by
 * its ID (validation_op_applied). `target` is the ID the request named before any save: the record
 * of a change, the ID of the client of a new record or ''.
 */
function answerReplay(e, claim, kind, collectionName, target) {
  if (rules.replayOf(claim, kind, target) !== 'replay') {
    throw fail('op_id', 'validation_op_reused');
  }
  var record = findById(e.app, collectionName, claim.record);
  var collection = e.app.findCollectionByNameOrId(collectionName);
  if (record === null || !e.app.canAccessRecord(record, e.requestInfo(), collection.viewRule)) {
    throw fail('op_id', 'validation_op_applied', { record: claim.record, kind: claim.kind });
  }
  // The JSVM does not lift the request out of the embedded *RequestEvent of a record event.
  $apis.enrichRecord(e.requestEvent, record);
  return e.json(200, record);
}

/**
 * Request hooks of the Record API: `run` holds the checks of the hook and e.next(). With an identifier
 * the account used before, `run` does not run and the answer is the one of the first time; when the
 * other request with the same identifier won the race, the model hook refuses in its transaction
 * (checkClaim) and this hook answers the same way.
 */
function withOp(e, kind, collectionName, run) {
  var op = remember(e, kind);
  if (op === '') {
    return run();
  }
  var user = String(e.auth.id);
  // Read before the save: the validation of a new record draws an ID when the client sent none.
  var target = String(e.record.id || '');
  var claim = findClaim(e.app, user, op);
  if (claim !== null) {
    return answerReplay(e, claim, kind, collectionName, target);
  }
  try {
    return run();
  } catch (err) {
    if (e.record.get(KEYS.replay)) {
      var won = findClaim(e.app, user, op);
      if (won !== null) {
        return answerReplay(e, won, kind, collectionName, target);
      }
    }
    throw err;
  }
}

/** Whether a record carries an identifier of a request. */
function hasOp(record) {
  return !!record.get(KEYS.op);
}

/**
 * Model hooks, before e.next() and inside the transaction: an identifier the account noted before
 * (meanwhile, by a request at the same time) refuses the write; the request hook answers like the
 * first time.
 */
function checkClaim(txApp, record) {
  if (!hasOp(record)) {
    return;
  }
  if (findClaim(txApp, String(record.get(KEYS.user)), String(record.get(KEYS.op))) !== null) {
    record.set(KEYS.replay, true);
    throw fail('op_id', 'validation_op_applied');
  }
}

/** Model hooks, after e.next() and inside the same transaction: notes the identifier with the record. */
function saveClaim(txApp, record, kind) {
  if (!hasOp(record)) {
    return;
  }
  insertClaim(txApp, String(record.get(KEYS.user)), String(record.get(KEYS.op)), kind, record.id, null);
}

/**
 * Model hook of tickets, before e.next() and inside the transaction (ADR-0074 §3): the ticket read
 * again; every field of `expected` whose stored value is neither the expected nor the desired one is
 * a conflict, at its field with code validation_ticket_conflict and { expected, actual, updated }.
 */
function checkExpected(txApp, record) {
  var raw = record.get(KEYS.expected);
  if (!raw) {
    return;
  }
  var expected = JSON.parse(String(raw));
  var stored = findById(txApp, 'tickets', record.id);
  if (stored === null) {
    return;
  }
  var history = require(__hooks + '/lib/history.js');
  var service = require(__hooks + '/lib/ticket-service.js');
  var storedValues = service.historyValues(stored);
  var desiredValues = service.historyValues(record);
  var want = {};
  var have = {};
  var wish = {};
  var names = Object.keys(expected);
  for (var i = 0; i < names.length; i++) {
    var field = names[i];
    try {
      want[field] = history.serialize(field, expected[field]);
    } catch (err) {
      throw fail('expected', 'validation_expected_invalid');
    }
    have[field] = history.serialize(field, storedValues[field]);
    wish[field] = history.serialize(field, desiredValues[field]);
  }
  throwConflicts(rules.conflictsOf(want, have, wish), stored.getString('updated'));
}

function throwConflicts(conflicts, updated) {
  if (conflicts.length === 0) {
    return;
  }
  var fields = {};
  for (var i = 0; i < conflicts.length; i++) {
    var conflict = conflicts[i];
    fields[conflict.field] = {
      code: conflict.field === 'checked' ? 'validation_dayplan_conflict' : 'validation_ticket_conflict',
      message: rules.conflictText(conflict.field),
      params: { expected: conflict.expected, actual: conflict.actual, updated: updated }
    };
  }
  throw errors.validationFailure(rules.CONFLICT_MESSAGE, fields);
}

// The two values of an entry of the day plan an action may expect.
var DAY_PLAN_EXPECTED = ['checked', 'status'];

function plainText(value) {
  return value === null || value === undefined ? '' : String(value);
}

/**
 * The routes `check` and `uncheck` of the day plan: { op, user, offline, deviceAt, expected } with
 * `expected` an object of `checked` (bool) and `status`, or null. Refuses an identifier or an
 * expectation of the wrong form. Without the migration or an app account all of it is left out.
 */
function dayPlanRequest(e) {
  var request = requestOf(e);
  request.expected = null;
  if (request.user === '') {
    return request;
  }
  var expected = bodyOf(e).expected;
  if (rules.expectedViolation(expected, DAY_PLAN_EXPECTED) !== '') {
    throw fail('expected', 'validation_expected_invalid');
  }
  if (expected !== undefined && expected !== null) {
    if (expected.checked !== undefined && typeof expected.checked !== 'boolean') {
      throw fail('expected', 'validation_expected_invalid');
    }
    if (expected.status !== undefined && expected.status !== null && typeof expected.status !== 'string') {
      throw fail('expected', 'validation_expected_invalid');
    }
    request.expected = expected;
  }
  return request;
}

/**
 * The conflicts of a check mark (ADR-0074 §3): `stored` and `desired` are { checked, status } of the
 * entry read in the transaction and after the action. Throws at the field like checkExpected.
 */
function checkDayPlanExpected(request, stored, desired, updated) {
  if (request.expected === null) {
    return;
  }
  var want = {};
  var have = {};
  var wish = {};
  var names = Object.keys(request.expected);
  for (var i = 0; i < names.length; i++) {
    want[names[i]] = plainText(request.expected[names[i]]);
    have[names[i]] = plainText(stored[names[i]]);
    wish[names[i]] = plainText(desired[names[i]]);
  }
  throwConflicts(rules.conflictsOf(want, have, wish), updated);
}

/** The note of the identifier of a route request in the transaction, null for a new action; another action under it is refused. */
function replayOfRoute(txApp, request, kind, recordId) {
  if (request.op === '') {
    return null;
  }
  var claim = findClaim(txApp, request.user, request.op);
  if (claim === null) {
    return null;
  }
  if (rules.replayOf(claim, kind, recordId) !== 'replay') {
    throw fail('op_id', 'validation_op_reused');
  }
  return claim;
}

/** Notes the identifier of a route request with its answer, in the transaction of the route. */
function claimRoute(txApp, request, kind, recordId, result) {
  if (request.op === '') {
    return;
  }
  insertClaim(txApp, request.user, request.op, kind, recordId, result);
}

/**
 * Request hooks of comments (ADR-0074 §4): `offline` and `device_at` come only from the server, never
 * from the body; a new comment gets them from the mark of the request, a changed one keeps its own.
 * Superusers stay free; before the migration the fields are missing and nothing changes.
 */
function applyCommentMarks(e, isCreate) {
  if (!isAppUser(e) || !hasField(e.record.collection(), 'offline')) {
    return;
  }
  if (isCreate) {
    e.record.set('offline', isMarked(e.record));
    e.record.set('device_at', deviceAtOf(e.record));
    return;
  }
  var original = e.record.original();
  e.record.set('offline', original.getBool('offline'));
  e.record.set('device_at', original.getString('device_at'));
}

/**
 * Request hook of a new entry of the inbox: the server alone writes `source_meta.offline` ({ device_at },
 * '' without an accepted time); a key of that name from the body goes.
 */
function applyInboxMarks(e) {
  if (!isAppUser(e) || !ready(e.app)) {
    return;
  }
  var raw = e.record.getString('source_meta');
  var meta = {};
  if (raw !== '' && raw !== 'null') {
    try {
      var parsed = JSON.parse(raw);
      meta = parsed && typeof parsed === 'object' && Object.prototype.toString.call(parsed) !== '[object Array]' ? parsed : null;
    } catch (err) {
      meta = null;
    }
  }
  if (meta === null) {
    return;
  }
  var had = Object.prototype.hasOwnProperty.call(meta, 'offline');
  delete meta.offline;
  if (isMarked(e.record)) {
    meta.offline = { device_at: deviceAtOf(e.record) };
  } else if (!had) {
    return;
  }
  e.record.set('source_meta', meta);
}

/** Cron byl-client-ops-cleanup: notes older than 30 days go. Before the migration it does nothing. */
function cleanup(app, now) {
  if (!ready(app)) {
    return;
  }
  app.db().newQuery('DELETE FROM client_ops WHERE created < {:cutoff}').bind({ cutoff: rules.retentionCutoff(now) }).execute();
}

/** `offline_ops` of GET /api/byl/tickets/create: version and actions, null before the migration. */
function capability(app) {
  return rules.capabilityOf(ready(app));
}

module.exports = {
  ready: ready,
  findClaim: findClaim,
  requestOf: requestOf,
  markOffline: markOffline,
  copyOffline: copyOffline,
  markHistory: markHistory,
  remember: remember,
  withOp: withOp,
  hasOp: hasOp,
  checkClaim: checkClaim,
  saveClaim: saveClaim,
  checkExpected: checkExpected,
  dayPlanRequest: dayPlanRequest,
  checkDayPlanExpected: checkDayPlanExpected,
  replayOfRoute: replayOfRoute,
  claimRoute: claimRoute,
  applyCommentMarks: applyCommentMarks,
  applyInboxMarks: applyInboxMarks,
  cleanup: cleanup,
  capability: capability
};
