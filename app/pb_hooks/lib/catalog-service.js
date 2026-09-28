// Hook logic for projects and tags (CLAUDE.md section 5, E1 plan package 5, OF-6, OF-8, OF-14;
// sub projects ADR-0034). CommonJS module, ES5 only, Goja runtime only. Every function takes the
// app of the running transaction (`txApp`) and never uses `$app`.
'use strict';

var ticketKey = require(__hooks + '/lib/ticket-key.js');
var errors = require(__hooks + '/lib/errors.js');
var rules = require(__hooks + '/lib/catalog-rules.js');

// Sets the scope from owner/household and returns it.
function applyScope(record) {
  var scope = ticketKey.scopeOf(record.getString('owner'), record.getString('household'));
  record.set('scope', scope);
  return scope;
}

function hasTickets(txApp, filter, id) {
  return txApp.findRecordsByFilter('tickets', filter, '', 1, 0, { id: id }).length > 0;
}

// projects.parent exists only after the migration 1790202100_projects_parent.js; until the next
// start the running instance has the old schema, and the hooks behave as before (ADR-0034).
function hierarchyReady(record) {
  return !!record.collection().fields.getByName('parent');
}

function hasSubProjects(txApp, id) {
  return (
    id !== '' && txApp.findRecordsByFilter('projects', 'parent = {:id}', '', 1, 0, { id: id }).length > 0
  );
}

function projectFailure(field, code) {
  return errors.fieldFailure(field, code, rules.PROJECT_PARENT_MESSAGES[code]);
}

// Checks the parent of a project (ADR-0034 section 2). The parent is looked up in the scope of
// the project, so a foreign id reads like a missing one.
function checkParent(txApp, record, scope) {
  var parentId = record.getString('parent');
  var input = {
    id: record.id,
    parent: parentId,
    parentFound: false,
    parentParent: '',
    parentArchived: false,
    archived: record.getBool('archived'),
    hasChildren: false
  };
  if (parentId !== '') {
    var found = txApp.findRecordsByFilter('projects', 'id = {:id} && scope = {:scope}', '', 1, 0, {
      id: parentId,
      scope: scope
    });
    if (found.length > 0) {
      input.parentFound = true;
      input.parentParent = found[0].getString('parent');
      input.parentArchived = found[0].getBool('archived');
    }
    input.hasChildren = hasSubProjects(txApp, record.id);
  }
  var code = rules.projectParentViolation(input);
  if (code !== '') {
    throw projectFailure('parent', code);
  }
}

// Projects: scope, reserved code TASK (OF-14). Once tickets use the project, its scope and code
// are fixed: tickets keep their scope (OF-3 c), and a changed code would leave keys with the old
// code, which a new project with that code would collide with. Sub projects (ADR-0034): the
// parent is checked, and a project with sub projects keeps its scope.
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
  var hierarchy = hierarchyReady(record);
  if (hierarchy) {
    checkParent(txApp, record, scope);
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
  if (scopeChanged && hierarchy && hasSubProjects(txApp, record.id)) {
    throw projectFailure('household', 'validation_project_scope_children');
  }
}

// Archiving a project archives its active sub projects in the same transaction (ADR-0034
// section 3). Each one is saved through txApp.save, so its own hook runs (and checks the
// invariant) and its realtime event follows the commit. Runs after e.next(), so the parent is
// archived already when the hooks of the sub projects read it.
function archiveSubProjects(txApp, record) {
  if (!hierarchyReady(record)) {
    return;
  }
  var wasArchived = record.original().getBool('archived');
  if (!rules.archivesProject(wasArchived, record.getBool('archived'))) {
    return;
  }
  var children = txApp.findRecordsByFilter(
    'projects',
    'parent = {:id} && archived = false',
    'name,id',
    0,
    0,
    { id: record.id }
  );
  for (var i = 0; i < children.length; i++) {
    children[i].set('archived', true);
    txApp.save(children[i]);
  }
}

// Projects with tickets are archived instead of deleted (OF-6): deleting would empty the
// relation of the tickets and thereby change their keys. A project with sub projects is not
// deleted either (ADR-0034 section 3); PocketBase would otherwise empty their parent silently.
function assertProjectDeletable(txApp, record) {
  if (hasTickets(txApp, 'project = {:id}', record.id)) {
    throw errors.fieldFailure(
      'id',
      'validation_project_in_use',
      'Ein Projekt mit Tickets kann nicht gelöscht werden. Bitte archivieren.'
    );
  }
  if (hierarchyReady(record) && hasSubProjects(txApp, record.id)) {
    throw projectFailure('id', 'validation_project_has_children');
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
  archiveSubProjects: archiveSubProjects,
  assertProjectDeletable: assertProjectDeletable,
  prepareTag: prepareTag
};
