// Hooks of the connections (ADR-0016 section 2, ADR-0018; E4 plan package 10). CommonJS module,
// ES5 only, Goja runtime only. The rules themselves are pure (connection-rules.js).
'use strict';

var ticketKey = require(__hooks + '/lib/ticket-key.js');
var errors = require(__hooks + '/lib/errors.js');
var secrets = require(__hooks + '/lib/secrets.js');
var rules = require(__hooks + '/lib/connection-rules.js');
var keywords = require(__hooks + '/lib/keywords.js');

var COLLECTION = 'connections';
var UNAVAILABLE = 'Die Verbindungen stehen nach dem nächsten Start der App bereit (start.bat).';

function jsonOf(record, field) {
  var raw = record.getString(field);
  if (raw === '' || raw === 'null') {
    return null;
  }
  try {
    return JSON.parse(raw);
  } catch (err) {
    return raw;
  }
}

// Field values as the pure rules read them.
function valuesOf(record) {
  var values = {
    type: record.getString('type'),
    secret_env: record.getString('secret_env'),
    settings: jsonOf(record, 'settings')
  };
  for (var i = 0; i < rules.SERVER_FIELDS.length; i++) {
    values[rules.SERVER_FIELDS[i]] = record.getString(rules.SERVER_FIELDS[i]);
  }
  return values;
}

function throwIf(violation) {
  if (violation) {
    throw errors.fieldFailure(violation.field, violation.code, violation.message);
  }
}

// onRecordCreateRequest; a superuser may set every field (tests, repairs in the admin UI).
function guardCreate(e) {
  if (e.hasSuperuserAuth()) {
    return;
  }
  throwIf(rules.createViolation(valuesOf(e.record), secrets, keywords));
}

// onRecordUpdateRequest; a superuser may set every field.
function guardUpdate(e) {
  if (e.hasSuperuserAuth()) {
    return;
  }
  throwIf(rules.updateViolation(valuesOf(e.record.original()), valuesOf(e.record), secrets, keywords));
}

// onRecordCreate/onRecordUpdate before e.next(), for every save: the scope, and a changed
// variable name starts over (new bot, new calendar): cursor, error and hint are cleared.
function prepareSave(record, isNew) {
  record.set('scope', ticketKey.scopeOf(record.getString('owner'), record.getString('household')));
  if (isNew) {
    return;
  }
  var before = record.original();
  var namesBefore = rules.variableNames(before.getString('type'), before.getString('secret_env'), jsonOf(before, 'settings'));
  var namesAfter = rules.variableNames(record.getString('type'), record.getString('secret_env'), jsonOf(record, 'settings'));
  if (namesBefore.secret !== namesAfter.secret || namesBefore.allowlist !== namesAfter.allowlist) {
    record.set('cursor', '');
    record.set('last_error', '');
    record.set('last_hint', '');
  }
}

/**
 * The connection `id` if the request may see it (view rule), else null; throws a 503 error before
 * the migration has created the collection.
 */
function visibleConnection(e, id) {
  var collection;
  try {
    collection = e.app.findCollectionByNameOrId(COLLECTION);
  } catch (err) {
    throw new ApiError(503, UNAVAILABLE);
  }
  var found = e.app.findRecordsByFilter(COLLECTION, 'id = {:id}', '', 1, 0, { id: id });
  if (found.length === 0) {
    return null;
  }
  var record = found[0];
  return e.app.canAccessRecord(record, e.requestInfo(), collection.viewRule) ? record : null;
}

// { secret, allowlist }: whether the variables are set in the environment of the server.
function secretStatus(record) {
  return rules.secretStatus(
    record.getString('type'),
    record.getString('secret_env'),
    jsonOf(record, 'settings'),
    secrets,
    function (name) {
      return $os.getenv(name);
    }
  );
}

module.exports = {
  COLLECTION: COLLECTION,
  jsonOf: jsonOf,
  guardCreate: guardCreate,
  guardUpdate: guardUpdate,
  prepareSave: prepareSave,
  visibleConnection: visibleConnection,
  secretStatus: secretStatus
};
