// Pure decisions of the project hook about sub projects (ADR-0034, package UP-1).
// CommonJS module, ES5 only, no dependencies and no `$app` (Goja runtime and Vitest).
'use strict';

// Messages of the codes, worded like the interface ("Oberprojekt", "Unterprojekt"). The SPA has
// the same texts in web/src/lib/domain/project-tree.ts (parity test web-project-tree.test.mjs).
var PROJECT_PARENT_MESSAGES = {
  validation_project_parent_self: 'Ein Projekt kann nicht sein eigenes Oberprojekt sein.',
  validation_project_parent_missing: 'Das Oberprojekt wurde nicht gefunden.',
  validation_project_parent_nested:
    'Das gewählte Projekt ist selbst ein Unterprojekt. Es gibt nur eine Ebene.',
  validation_project_parent_has_children:
    'Ein Projekt mit Unterprojekten kann kein Unterprojekt werden.',
  validation_project_parent_archived:
    'Das Oberprojekt ist archiviert. Bitte zuerst das Oberprojekt zurückholen.',
  validation_project_has_children:
    'Ein Projekt mit Unterprojekten kann nicht gelöscht werden. Erst die Unterprojekte löschen oder einem anderen Projekt zuordnen.',
  validation_project_scope_children:
    'Der Bereich eines Projekts mit Unterprojekten lässt sich nicht ändern. Erst die Unterprojekte verschieben oder lösen.'
};

// Parent guard of a project (one level only, same scope). `input`:
//   id              the project's id ('' when not known yet)
//   parent          the parent id ('' when none)
//   parentFound     whether the parent exists in the scope of the project; a missing parent and
//                   one of another scope give the same code, so foreign ids cannot be probed
//   parentParent    the parent's own parent id ('' when none)
//   parentArchived  whether the parent is archived
//   archived        whether the project itself is (or stays) archived
//   hasChildren     whether other projects use this project as parent
// Returns an error code or '' when the parent is allowed. With one level there are no cycles:
// the parent never has a parent, and a project with sub projects never gets one.
function projectParentViolation(input) {
  if (input.parent === '') {
    return '';
  }
  if (input.id !== '' && input.parent === input.id) {
    return 'validation_project_parent_self';
  }
  if (!input.parentFound) {
    return 'validation_project_parent_missing';
  }
  if (input.parentParent !== '') {
    return 'validation_project_parent_nested';
  }
  if (input.hasChildren) {
    return 'validation_project_parent_has_children';
  }
  // Invariant: an archived parent has only archived sub projects. A new or restored sub project
  // under an archived parent is refused; archiving the parent archives its sub projects.
  if (input.parentArchived && !input.archived) {
    return 'validation_project_parent_archived';
  }
  return '';
}

// Whether an update archives the project (active before, archived now); only then the archive
// cascades to the sub projects. Restoring a parent does not restore them.
function archivesProject(wasArchived, isArchived) {
  return !wasArchived && !!isArchived;
}

module.exports = {
  PROJECT_PARENT_MESSAGES: PROJECT_PARENT_MESSAGES,
  projectParentViolation: projectParentViolation,
  archivesProject: archivesProject
};
