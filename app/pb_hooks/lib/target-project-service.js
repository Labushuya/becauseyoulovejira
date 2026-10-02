// Target project of the ways into the inbox (ADR-0049, package 1 "Standardprojekt je Verbindung"):
// what the hooks read and check in the database. CommonJS module, ES5 only, Goja runtime only; the
// rules are pure (target-project-rules.js). Every function takes the app of the running
// transaction or request and never uses `$app`.
'use strict';

var rules = require(__hooks + '/lib/target-project-rules.js');
var ticketKey = require(__hooks + '/lib/ticket-key.js');
var errors = require(__hooks + '/lib/errors.js');

// Returns the record or null; real database errors still throw.
function findById(app, collection, id) {
  if (!rules.isRecordId(id)) {
    return null;
  }
  var found = app.findRecordsByFilter(collection, 'id = {:id}', '', 1, 0, { id: id });
  return found.length > 0 ? found[0] : null;
}

// Whether the collection of a record has the field: the migration 1790203100 has run. Before it the
// hooks behave as before.
function hasField(record, name) {
  try {
    return !!record.collection().fields.getByName(name);
  } catch (err) {
    return false;
  }
}

// { scope, archived } of a project, or null.
function projectFacts(app, id) {
  var project = findById(app, 'projects', id);
  return project ? { scope: project.getString('scope'), archived: project.getBool('archived') } : null;
}

function parsed(raw) {
  if (raw === '' || raw === 'null') {
    return null;
  }
  try {
    return JSON.parse(raw);
  } catch (err) {
    return raw;
  }
}

/**
 * onRecordCreate of inbox_items, after the scope is set: the target the new entry keeps (ADR-0049
 * §2), from the target given by the server, the connection or the card of the channel; it must
 * exist in the area of the entry. Whatever a client sent is overwritten, so only the server sets
 * the field. Before the migration nothing happens.
 */
function applyToNewItem(app, record) {
  if (!hasField(record, rules.FIELD)) {
    return;
  }
  var connectionId = record.getString('connection');
  var connection = connectionId === '' ? null : findById(app, 'connections', connectionId);
  var cardTarget = '';
  var card = connectionId === '' ? rules.cardOfChannel(record.getString('channel')) : '';
  if (card !== '') {
    var user = findById(app, 'users', record.getString('owner'));
    cardTarget = user ? rules.targetsOf(user.getString(rules.USER_FIELD))[card] : '';
  }
  var id = rules.requestedTarget({
    given: record.get(rules.GIVEN_KEY),
    hasConnection: connectionId !== '',
    connectionTarget: connection ? connection.getString(rules.FIELD) : '',
    cardTarget: cardTarget
  });
  var project = id === '' ? null : projectFacts(app, id);
  record.set(rules.FIELD, rules.usableTarget(id, project, record.getString('scope')));
}

// A user chooses a target: the project must exist in `scope` and be active, else a field failure.
function assertChoosable(app, field, id, scope) {
  var code = rules.choiceViolation(projectFacts(app, id), scope);
  if (code !== '') {
    throw errors.fieldFailure(field, code, rules.MESSAGES[code]);
  }
}

/**
 * onRecordCreateRequest/onRecordUpdateRequest of connections, for app users (a superuser is free,
 * as for every field of a connection): a target that is new must be an active project in the area
 * of the connection. A target that stays as it is (also an archived one) is not checked again.
 */
function guardConnection(e, isCreate) {
  if (!hasField(e.record, rules.FIELD)) {
    return;
  }
  var after = e.record.getString(rules.FIELD);
  var before = isCreate ? '' : e.record.original().getString(rules.FIELD);
  if (after === '' || after === before) {
    return;
  }
  var scope = ticketKey.scopeOf(e.record.getString('owner'), e.record.getString('household'));
  assertChoosable(e.app, rules.FIELD, after, scope);
}

/**
 * onRecordCreateRequest/onRecordUpdateRequest of users: the shape of inbox_targets for everyone,
 * and for an app user every target that changed must be an active project of the private area of
 * the user (the entries of these cards are private, ADR-0038 §1). Before the migration the field
 * reads as '' and passes.
 */
function guardUserTargets(e, isCreate) {
  if (!hasField(e.record, rules.USER_FIELD)) {
    return;
  }
  var raw = e.record.getString(rules.USER_FIELD);
  var message = rules.targetsViolation(parsed(raw));
  if (message !== '') {
    throw errors.fieldFailure(rules.USER_FIELD, 'validation_inbox_targets', message);
  }
  if (isCreate || e.hasSuperuserAuth()) {
    return;
  }
  var changed = rules.changedCards(e.record.original().getString(rules.USER_FIELD), raw);
  var targets = rules.targetsOf(raw);
  var scope = ticketKey.scopeOf(e.record.id, '');
  for (var i = 0; i < changed.length; i++) {
    if (targets[changed[i]] !== '') {
      assertChoosable(e.app, rules.USER_FIELD, targets[changed[i]], scope);
    }
  }
}

module.exports = {
  applyToNewItem: applyToNewItem,
  guardConnection: guardConnection,
  guardUserTargets: guardUserTargets
};
