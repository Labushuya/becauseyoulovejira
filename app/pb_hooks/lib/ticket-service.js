// Ticket hook logic that needs the database (CLAUDE.md section 5, E1 plan packages 5 and 6).
// CommonJS module, ES5 only, Goja runtime only. Every function takes the app of the running
// transaction (`txApp`) and never uses `$app`, so reads and writes stay in that transaction.
'use strict';

var ticketKey = require(__hooks + '/lib/ticket-key.js');
var counters = require(__hooks + '/lib/counters.js');
var rules = require(__hooks + '/lib/ticket-rules.js');
var history = require(__hooks + '/lib/history.js');
var errors = require(__hooks + '/lib/errors.js');
var inbox = require(__hooks + '/lib/inbox-service.js');

// Transient record key for the acting user (E1 plan OF-4, variant A). Field names cannot contain
// "@", PocketBase neither stores nor exports unknown keys, and the Record API does not load
// unknown keys from the request body, so clients cannot set it.
var ACTOR_KEY = '@actor';

// Transient record key for the `updated` a client based its change of the description on
// (ADR-0032 section 6). It comes from the body field `expected_updated`, which is no field of the
// collection and is therefore never stored.
var EXPECTED_UPDATED_KEY = '@expected_updated';

var DESCRIPTION_STALE = 'Die Beschreibung wurde inzwischen geändert.';

var SCOPE_MISMATCH = 'Verknüpfter Datensatz nicht gefunden oder in einem anderen Bereich.';

var PROJECT_ARCHIVED = 'Das Projekt ist archiviert.';

var PARENT_MESSAGES = {
  validation_parent_self: 'Ein Ticket kann nicht sein eigenes Eltern-Ticket sein.',
  validation_parent_nested: 'Das Eltern-Ticket ist selbst ein Unter-Ticket (nur eine Ebene erlaubt).',
  validation_parent_has_children: 'Ein Ticket mit Unter-Tickets kann kein Eltern-Ticket bekommen.'
};

function scopeOfRecord(record) {
  return ticketKey.scopeOf(record.getString('owner'), record.getString('household'));
}

// Returns the record or null; real database errors still throw.
function findById(txApp, collection, id) {
  var found = txApp.findRecordsByFilter(collection, 'id = {:id}', '', 1, 0, { id: id });
  return found.length > 0 ? found[0] : null;
}

function hasChildren(txApp, record) {
  if (record.id === '') {
    return false;
  }
  return txApp.findRecordsByFilter('tickets', 'parent = {:id}', '', 1, 0, { id: record.id }).length > 0;
}

// Called from the request hooks: remembers the signed-in app user for the history. Superusers
// and anonymous requests leave it empty (ticket_history.user relates to users only).
function rememberActor(e) {
  if (e.auth && e.auth.collection().name === 'users') {
    e.record.set(ACTOR_KEY, e.auth.id);
  }
}

function actorOf(record) {
  var actor = record.get(ACTOR_KEY);
  return actor ? String(actor) : '';
}

// onRecordUpdateRequest: remembers the body field `expected_updated` (ADR-0032 section 6), if
// the client sent it. Without it an update works as before.
function rememberExpectedUpdated(e) {
  var value = e.requestInfo().body['expected_updated'];
  if (value === undefined || value === null) {
    return;
  }
  e.record.set(EXPECTED_UPDATED_KEY, String(value));
}

// onRecordUpdate before e.next(), inside the transaction: refuses the update when the stored
// ticket has another `updated` than the client based its change on. The ticket is read again in
// the transaction, so two requests with the same expectation cannot both pass.
function checkExpectedUpdated(txApp, record) {
  var expected = record.get(EXPECTED_UPDATED_KEY);
  if (expected === undefined || expected === null) {
    return;
  }
  var stored = findById(txApp, 'tickets', record.id);
  if (!stored || stored.getString('updated') !== String(expected)) {
    throw errors.fieldFailure('description', 'validation_description_stale', DESCRIPTION_STALE);
  }
}

// Loads the referenced project, tags, recurrence rule and parent. Rejects references that are
// missing or belong to another scope (OF-3 c), parents that break the one-level rule and a newly
// assigned archived project (E3 plan, T-11). `previousProject` is the stored project id before
// the write ('' on create). Returns the project record or null. Also used for the template of a
// recurrence rule (lib/recurrence-service.js), which has project and tags but no recurrence or
// parent field (getString gives '' for them).
function checkRelations(txApp, record, scope, previousProject) {
  var related = [];
  var fields = {};
  var project = null;

  var projectId = record.getString('project');
  if (projectId !== '') {
    project = findById(txApp, 'projects', projectId);
    related.push({ field: 'project', scope: project ? project.getString('scope') : null });
  }

  var tagIds = record.getStringSlice('tags');
  for (var i = 0; i < tagIds.length; i++) {
    var tag = findById(txApp, 'tags', tagIds[i]);
    related.push({ field: 'tags', scope: tag ? tag.getString('scope') : null });
  }

  var ruleId = record.getString('recurrence');
  if (ruleId !== '') {
    var rule = findById(txApp, 'recurrence_rules', ruleId);
    related.push({ field: 'recurrence', scope: rule ? scopeOfRecord(rule) : null });
  }

  var parentId = record.getString('parent');
  if (parentId !== '') {
    var parent = parentId === record.id ? null : findById(txApp, 'tickets', parentId);
    var parentCode = rules.parentViolation({
      id: record.id,
      parent: parentId,
      parentExists: parent !== null,
      parentParent: parent ? parent.getString('parent') : '',
      hasChildren: hasChildren(txApp, record)
    });
    if (parentCode !== '') {
      fields.parent = { code: parentCode, message: PARENT_MESSAGES[parentCode] };
    } else {
      related.push({ field: 'parent', scope: parent ? parent.getString('scope') : null });
    }
  }

  var violations = rules.scopeViolations(scope, related);
  for (var j = 0; j < violations.length; j++) {
    fields[violations[j]] = { code: 'validation_scope_mismatch', message: SCOPE_MISMATCH };
  }
  if (project && !fields.project) {
    var archivedCode = rules.archivedProjectViolation({
      project: projectId,
      previousProject: previousProject || '',
      archived: project.getBool('archived')
    });
    if (archivedCode !== '') {
      fields.project = { code: archivedCode, message: PROJECT_ARCHIVED };
    }
  }
  var failed = Object.keys(fields);
  if (failed.length > 0) {
    throw errors.validationFailure(fields[failed[0]].message, fields);
  }
  return project;
}

// Due dates are calendar dates only (CLAUDE.md section 5).
function checkDue(record) {
  if (!rules.isCalendarDate(record.getString('due'))) {
    throw errors.fieldFailure(
      'due',
      'validation_calendar_date',
      'Die Fälligkeit muss ein reines Datum sein (YYYY-MM-DD).'
    );
  }
}

// completed_at follows the status; client values are overwritten.
function applyCompletedAt(record, original) {
  var action = rules.completedAtAction(
    original === null,
    original ? original.getString('status') : '',
    record.getString('status')
  );
  if (action === 'set') {
    record.set('completed_at', new Date().toISOString());
  } else if (action === 'keep') {
    record.set('completed_at', original.getString('completed_at'));
  } else {
    record.set('completed_at', '');
  }
}

// Draws the next number of the scope/project counter and sets number and key.
function assignKey(txApp, record, scope, project) {
  var number = counters.nextValue(txApp, ticketKey.counterKey(scope, project ? project.id : ''));
  var code = project ? project.getString('code') : ticketKey.TASK;
  record.set('number', number);
  record.set('key', ticketKey.formatKey(code, number));
}

// Plain values of the tracked fields for lib/history.js (DateTime and slices become strings and
// arrays).
function historyValues(record) {
  var values = {};
  for (var i = 0; i < history.TRACKED_FIELDS.length; i++) {
    var field = history.TRACKED_FIELDS[i];
    if (field === 'blocks_parent') {
      values[field] = record.getBool(field);
    } else if (history.MULTI_VALUE_FIELDS.indexOf(field) !== -1) {
      var items = record.getStringSlice(field);
      var list = [];
      for (var j = 0; j < items.length; j++) {
        list.push(String(items[j]));
      }
      values[field] = list;
    } else {
      values[field] = record.getString(field);
    }
  }
  return values;
}

function saveHistoryEntry(txApp, record, entry) {
  var item = new Record(txApp.findCollectionByNameOrId('ticket_history'));
  item.set('ticket', record.id);
  item.set('field', entry.field);
  item.set('old_value', entry.old_value);
  item.set('new_value', entry.new_value);
  item.set('user', actorOf(record));
  txApp.save(item);
}

// onRecordCreate before e.next(): scope, defaults, guards, the inbox item to convert, completed_at
// and a fresh key. Client values for scope, number, key and completed_at are always overwritten.
// Every check runs before the key is drawn, so a rejected create uses no number. Returns the
// inbox item for recordCreation() (null without one).
function prepareCreate(txApp, record) {
  var scope = scopeOfRecord(record);
  record.set('scope', scope);

  var defaults = rules.createDefaults({
    status: record.getString('status'),
    priority: record.getString('priority')
  });
  for (var field in defaults) {
    if (Object.prototype.hasOwnProperty.call(defaults, field)) {
      record.set(field, defaults[field]);
    }
  }

  checkDue(record);
  var project = checkRelations(txApp, record, scope, '');
  var item = inbox.prepareConversion(txApp, record, scope);
  applyCompletedAt(record, null);
  assignKey(txApp, record, scope, project);
  return item;
}

// onRecordCreate after e.next(): the creation itself is recorded with the key, and the inbox
// item the ticket came from becomes "converted" (ADR-0014 section 2), in the same transaction.
// A ticket a recurrence rule created (only the server sets `recurrence` on create since E5)
// carries the rule as old value, so the history can name "Wiederholung" as its author (T-9).
function recordCreation(txApp, record, item) {
  saveHistoryEntry(txApp, record, {
    field: 'created',
    old_value: record.getString('recurrence'),
    new_value: record.getString('key')
  });
  inbox.completeConversion(txApp, item || null, record);
}

// onRecordUpdateRequest: source and source_item are fixed after the create (ADR-0014 section
// 2). Only client updates pass through here; PocketBase clearing source_item when the inbox item
// is deleted does not.
function guardSourceChange(record) {
  var original = record.original();
  var fields = ['source', 'source_item'];
  for (var i = 0; i < fields.length; i++) {
    if (record.getString(fields[i]) !== original.getString(fields[i])) {
      throw errors.fieldFailure(
        fields[i],
        'validation_source_immutable',
        'Die Quelle eines Tickets lässt sich nicht ändern.'
      );
    }
  }
}

// onRecordUpdate before e.next(): recomputes the scope; a changed scope or project draws a new
// key in the target counter, otherwise number and key keep their stored values whatever the
// client sends. A ticket with sub-tickets keeps its scope. Returns the tracked values before the
// change for recordChanges().
function prepareUpdate(txApp, record) {
  var original = record.original();
  var scope = scopeOfRecord(record);
  record.set('scope', scope);

  if (scope !== original.getString('scope') && hasChildren(txApp, record)) {
    throw errors.fieldFailure(
      'household',
      'validation_ticket_has_children',
      'Ein Ticket mit Unter-Tickets kann den Bereich nicht wechseln.'
    );
  }
  checkDue(record);
  var project = checkRelations(txApp, record, scope, original.getString('project'));
  applyCompletedAt(record, original);

  var before = {
    key: original.getString('key'),
    scope: original.getString('scope'),
    project: original.getString('project')
  };
  if (rules.needsNewKey(before, { scope: scope, project: record.getString('project') })) {
    assignKey(txApp, record, scope, project);
  } else {
    record.set('number', original.getInt('number'));
    record.set('key', before.key);
  }
  return historyValues(original);
}

// onRecordUpdate after e.next(): one history entry per changed tracked field (OF-12).
function recordChanges(txApp, record, before) {
  var changes = history.diff(before, historyValues(record));
  for (var i = 0; i < changes.length; i++) {
    saveHistoryEntry(txApp, record, changes[i]);
  }
}

/**
 * Route "Ticket löschen mit Quellenbehandlung" (ADR-0031, addendum B): body { sources: 'inbox' |
 * 'discard' }. A ticket the request may not delete (deleteRule) is not found; the delete runs
 * through the model hook of tickets.pb.js, which settles the sources in the same transaction.
 */
function deleteWithSources(e, id) {
  var inboxRules = require(__hooks + '/lib/inbox-rules.js');
  var body = e.requestInfo().body || {};
  var handling = body.sources === undefined || body.sources === null ? '' : String(body.sources);
  if (!inboxRules.isSourceHandling(handling)) {
    throw new BadRequestError('Unbekannte Behandlung der Quellen: erlaubt sind „inbox“ und „discard“.');
  }
  var collection = e.app.findCollectionByNameOrId('tickets');
  var ticket = findById(e.app, 'tickets', id);
  if (!ticket || !e.app.canAccessRecord(ticket, e.requestInfo(), collection.deleteRule)) {
    throw new NotFoundError('Ticket nicht gefunden.');
  }
  ticket.set(inbox.SOURCE_HANDLING_KEY, handling);
  e.app.delete(ticket);
}

module.exports = {
  ACTOR_KEY: ACTOR_KEY,
  deleteWithSources: deleteWithSources,
  scopeOfRecord: scopeOfRecord,
  rememberActor: rememberActor,
  rememberExpectedUpdated: rememberExpectedUpdated,
  checkExpectedUpdated: checkExpectedUpdated,
  checkRelations: checkRelations,
  prepareCreate: prepareCreate,
  recordCreation: recordCreation,
  guardSourceChange: guardSourceChange,
  prepareUpdate: prepareUpdate,
  recordChanges: recordChanges
};
