// Hook logic for projects and tags (CLAUDE.md section 5, E1 plan package 5, OF-6, OF-8, OF-14).
// CommonJS module, ES5 only, Goja runtime only. Every function takes the app of the running
// transaction (`txApp`) and never uses `$app`.
'use strict';

var ticketKey = require(__hooks + '/lib/ticket-key.js');
var errors = require(__hooks + '/lib/errors.js');

// Sets the scope from owner/household and returns it.
function applyScope(record) {
  var scope = ticketKey.scopeOf(record.getString('owner'), record.getString('household'));
  record.set('scope', scope);
  return scope;
}

function hasTickets(txApp, filter, id) {
  return txApp.findRecordsByFilter('tickets', filter, '', 1, 0, { id: id }).length > 0;
}

// Projects: scope, reserved code TASK (OF-14). Once tickets use the project, its scope and code
// are fixed: tickets keep their scope (OF-3 c), and a changed code would leave keys with the old
// code, which a new project with that code would collide with.
function prepareProject(txApp, record, isNew) {
  var scope = applyScope(record);
  var code = record.getString('code');
  if (code === ticketKey.TASK) {
    throw errors.fieldFailure(
      'code',
      'validation_reserved_code',
      'Der Code TASK ist für Tickets ohne Projekt reserviert.'
    );
  }
  if (isNew) {
    return;
  }
  var original = record.original();
  var scopeChanged = original.getString('scope') !== scope;
  var codeChanged = original.getString('code') !== code;
  if ((scopeChanged || codeChanged) && hasTickets(txApp, 'project = {:id}', record.id)) {
    throw errors.fieldFailure(
      scopeChanged ? 'household' : 'code',
      'validation_project_in_use',
      'Bereich und Code eines Projekts mit Tickets lassen sich nicht ändern.'
    );
  }
}

// Projects with tickets are archived instead of deleted (OF-6): deleting would empty the
// relation of the tickets and thereby change their keys.
function assertProjectDeletable(txApp, record) {
  if (hasTickets(txApp, 'project = {:id}', record.id)) {
    throw errors.fieldFailure(
      'id',
      'validation_project_in_use',
      'Ein Projekt mit Tickets kann nicht gelöscht werden. Bitte archivieren.'
    );
  }
}

// Tags: scope (OF-8). A tag used by tickets keeps its scope (OF-3 c).
function prepareTag(txApp, record, isNew) {
  var scope = applyScope(record);
  if (isNew) {
    return;
  }
  var scopeChanged = record.original().getString('scope') !== scope;
  if (scopeChanged && hasTickets(txApp, 'tags.id ?= {:id}', record.id)) {
    throw errors.fieldFailure(
      'household',
      'validation_tag_in_use',
      'Der Bereich eines Tags, das von Tickets verwendet wird, lässt sich nicht ändern.'
    );
  }
}

module.exports = {
  prepareProject: prepareProject,
  assertProjectDeletable: assertProjectDeletable,
  prepareTag: prepareTag
};
