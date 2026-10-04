// Hooks of the connections (ADR-0016 section 2, ADR-0018; E4 plan package 10). CommonJS module,
// ES5 only, Goja runtime only. The rules themselves are pure (connection-rules.js).
'use strict';

var ticketKey = require(__hooks + '/lib/ticket-key.js');
var errors = require(__hooks + '/lib/errors.js');
var secrets = require(__hooks + '/lib/secrets.js');
var rules = require(__hooks + '/lib/connection-rules.js');
var keywords = require(__hooks + '/lib/keywords.js');
var targets = require(__hooks + '/lib/target-project-service.js');
var github = require(__hooks + '/lib/github-rules.js');

var COLLECTION = 'connections';
var UNAVAILABLE = 'Die Verbindungen stehen nach dem nächsten Neustart der App bereit (neu-starten.bat).';

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

// Field values as the pure rules read them; `settings_json` is the stored text of `settings`, for
// the rule that renaming changes nothing else.
function valuesOf(record) {
  var values = {
    type: record.getString('type'),
    label: record.getString('label'),
    enabled: record.getString('enabled'),
    owner: record.getString('owner'),
    household: record.getString('household'),
    secret_env: record.getString('secret_env'),
    settings: jsonOf(record, 'settings'),
    settings_json: record.getString('settings'),
    // '' before the migration 1790203100 (ADR-0049).
    target_project: record.getString('target_project')
  };
  for (var i = 0; i < rules.SERVER_FIELDS.length; i++) {
    // An empty JSON field (scan) reads as "null"; a missing field (before its migration) as ''.
    var raw = record.getString(rules.SERVER_FIELDS[i]);
    values[rules.SERVER_FIELDS[i]] = raw === 'null' ? '' : raw;
  }
  return values;
}

function throwIf(violation) {
  if (violation) {
    throw errors.fieldFailure(violation.field, violation.code, violation.message);
  }
}

// The rules of the settings of a folder connection for the platform of this server (ADR-0051).
function folderRules() {
  return require(__hooks + '/lib/folder-service.js').settingsRules();
}

// Whether the account of the request is the administrator of the app (ADR-0056 §5).
function requestIsAdmin(e) {
  var id = e.auth ? String(e.auth.id) : '';
  return require(__hooks + '/lib/account-service.js').isInstanceAdmin(e.app, id);
}

// onRecordCreateRequest; a superuser may set every field (tests, repairs in the admin UI). Only the
// administrator of the app sets up a connection with access data or folders (ADR-0056 §5), and
// never in a household (E7-3, ADR-0059 §5).
function guardCreate(e) {
  if (e.hasSuperuserAuth()) {
    return;
  }
  var values = valuesOf(e.record);
  throwIf(rules.areaViolation(values));
  throwIf(rules.adminViolation(requestIsAdmin(e), null, values));
  throwIf(rules.createViolation(values, secrets, keywords, github, folderRules()) || rules.labelViolation(values.label));
  targets.guardConnection(e, true);
  guardRepoTargets(e, null, values);
  guardFolders(e, null, values);
}

// onRecordUpdateRequest; a superuser may set every field. A new name comes alone (ADR-0026,
// addendum KK-3): the request may change nothing else with it. A new target project must be an
// active project of the area of the connection (ADR-0049), also the one of a repository of GitHub
// or of a folder. Only the administrator of the app changes a connection with access data or
// folders (ADR-0056 §5).
function guardUpdate(e) {
  if (e.hasSuperuserAuth()) {
    return;
  }
  var before = valuesOf(e.record.original());
  var after = valuesOf(e.record);
  throwIf(rules.adminViolation(requestIsAdmin(e), before, after));
  throwIf(
    rules.updateViolation(before, after, secrets, keywords, github, folderRules()) ||
      rules.labelViolation(after.label) ||
      rules.renameViolation(before, after)
  );
  targets.guardConnection(e, false);
  guardRepoTargets(e, before, after);
  guardFolders(e, before, after);
}

// A folder that is new in the settings of a folder connection (ADR-0051 §2) must exist on this
// machine, be readable, be reached without links and lie outside the app; its target project like
// the one of a repository (ADR-0049 §3). Folders that stay are not checked again.
function guardFolders(e, before, after) {
  if (after.type !== 'folder') {
    return;
  }
  var service = require(__hooks + '/lib/folder-service.js');
  service.assertNewFolders(e.app, before === null ? null : before.settings, after.settings);
  var changed = service.changedTargets(before === null ? null : before.settings, after.settings);
  var scope = ticketKey.scopeOf(after.owner, after.household);
  for (var i = 0; i < changed.length; i++) {
    targets.assertChoosable(e.app, 'settings', changed[i].target, scope);
  }
}

// The target project of a repository of a GitHub connection (ADR-0049 §3, ADR-0050 §2) lives as an
// ID in its settings: a target that is new for its repository must be an active project of the area
// of the connection, like the target of the connection itself. One that stays (also archived)
// passes.
function guardRepoTargets(e, before, after) {
  if (after.type !== 'github') {
    return;
  }
  var changed = github.changedTargets(before === null ? null : before.settings, after.settings);
  if (changed.length === 0) {
    return;
  }
  var scope = ticketKey.scopeOf(after.owner, after.household);
  for (var i = 0; i < changed.length; i++) {
    targets.assertChoosable(e.app, 'settings', changed[i].target, scope);
  }
}

// onRecordCreate/onRecordUpdate before e.next(), for every save: the scope, the name without white
// space at its ends, and a changed source starts over (new variable, bot, calendar or mailbox):
// cursor, error, hint and the full scan of the inbox are cleared (the mark of the migration
// 1790201700 stays for its rollback).
function prepareSave(record, isNew) {
  record.set('scope', ticketKey.scopeOf(record.getString('owner'), record.getString('household')));
  var label = rules.normalizeLabel(record.getString('label'));
  if (label !== record.getString('label')) {
    record.set('label', label);
  }
  if (isNew) {
    return;
  }
  var before = record.original();
  var sourceBefore = rules.sourceIdentity(before.getString('type'), before.getString('secret_env'), jsonOf(before, 'settings'));
  var sourceAfter = rules.sourceIdentity(record.getString('type'), record.getString('secret_env'), jsonOf(record, 'settings'));
  if (sourceBefore !== sourceAfter) {
    record.set('cursor', '');
    record.set('last_error', '');
    record.set('last_hint', '');
    if (hasScanField(record)) {
      var scan = jsonOf(record, 'scan');
      var marked = scan !== null && typeof scan === 'object' && scan.match_body_before === false;
      record.set('scan', marked ? { match_body_before: false } : null);
    }
  }
}

// Whether the connections have the field scan (migration 1790201700 has run).
function hasScanField(record) {
  try {
    return !!record.collection().fields.getByName('scan');
  } catch (err) {
    return false;
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
