// Ticket hook logic that needs the database (CLAUDE.md section 5, E1 plan packages 5 and 6).
// CommonJS module, ES5 only, Goja runtime only. Every function takes the app of the running
// transaction (`txApp`) and never uses `$app`, so reads and writes stay in that transaction.
'use strict';

var ticketKey = require(__hooks + '/lib/ticket-key.js');
var counters = require(__hooks + '/lib/counters.js');
var rules = require(__hooks + '/lib/ticket-rules.js');
var errors = require(__hooks + '/lib/errors.js');

function scopeOfRecord(record) {
  return ticketKey.scopeOf(record.getString('owner'), record.getString('household'));
}

// Returns the record or null; real database errors still throw.
function findById(txApp, collection, id) {
  var found = txApp.findRecordsByFilter(collection, 'id = {:id}', '', 1, 0, { id: id });
  return found.length > 0 ? found[0] : null;
}

// Loads the referenced project, tags and recurrence rule and rejects references that are
// missing or belong to another scope (E1 plan OF-3 c). Returns the project record or null.
function checkRelations(txApp, record, scope) {
  var related = [];
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

  var violations = rules.scopeViolations(scope, related);
  if (violations.length > 0) {
    var message = 'Verknüpfter Datensatz nicht gefunden oder in einem anderen Bereich.';
    var fields = {};
    for (var j = 0; j < violations.length; j++) {
      fields[violations[j]] = { code: 'validation_scope_mismatch', message: message };
    }
    throw errors.validationFailure(message, fields);
  }
  return project;
}

// Draws the next number of the scope/project counter and sets number and key.
function assignKey(txApp, record, scope, project) {
  var number = counters.nextValue(txApp, ticketKey.counterKey(scope, project ? project.id : ''));
  var code = project ? project.getString('code') : ticketKey.TASK;
  record.set('number', number);
  record.set('key', ticketKey.formatKey(code, number));
}

// onRecordCreate: scope, defaults, relation scopes and a fresh key. Client values for scope,
// number and key are always overwritten.
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

  var project = checkRelations(txApp, record, scope);
  assignKey(txApp, record, scope, project);
}

// onRecordUpdate: recomputes the scope; a changed scope or project draws a new key in the target
// counter, otherwise number and key keep their stored values whatever the client sends.
function prepareUpdate(txApp, record) {
  var original = record.original();
  var scope = scopeOfRecord(record);
  record.set('scope', scope);

  var project = checkRelations(txApp, record, scope);
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
}

module.exports = {
  scopeOfRecord: scopeOfRecord,
  prepareCreate: prepareCreate,
  prepareUpdate: prepareUpdate
};
