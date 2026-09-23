// Pure decisions of the ticket hooks (CLAUDE.md section 5, E1 plan packages 5 and 6).
// CommonJS module, ES5 only, no dependencies and no `$app` (Goja runtime and Vitest).
'use strict';

// Defaults for create when the client leaves the fields empty (E1 plan OF-11).
var DEFAULT_STATUS = 'open';
var DEFAULT_PRIORITY = 'medium';

function isEmpty(value) {
  return value === null || value === undefined || value === '';
}

// Returns the fields to set on create: { status?, priority? }.
function createDefaults(values) {
  var result = {};
  if (isEmpty(values.status)) {
    result.status = DEFAULT_STATUS;
  }
  if (isEmpty(values.priority)) {
    result.priority = DEFAULT_PRIORITY;
  }
  return result;
}

// A ticket gets a new key when it has none yet or when its scope or project changes; the key
// then comes from the counter of the target scope and project (CLAUDE.md section 5).
function needsNewKey(before, after) {
  if (isEmpty(before.key)) {
    return true;
  }
  return (before.scope || '') !== (after.scope || '') || (before.project || '') !== (after.project || '');
}

// `related` lists the referenced records as { field, scope }; scope is null when the record
// does not exist. Returns the field names (each once, in order) whose record is missing or
// belongs to another scope than `scope` (E1 plan OF-3 c).
function scopeViolations(scope, related) {
  var fields = [];
  for (var i = 0; i < related.length; i++) {
    var item = related[i];
    if (item.scope !== scope && fields.indexOf(item.field) === -1) {
      fields.push(item.field);
    }
  }
  return fields;
}

// completed_at (CLAUDE.md section 5): 'set' when the ticket becomes done, 'keep' while it stays
// done, 'clear' otherwise. Client values are never taken over.
function completedAtAction(isNew, oldStatus, newStatus) {
  if (newStatus !== 'done') {
    return 'clear';
  }
  return !isNew && oldStatus === 'done' ? 'keep' : 'set';
}

// Due dates are pure calendar dates, stored as "YYYY-MM-DD 00:00:00.000Z" (CLAUDE.md section 5).
var CALENDAR_DATE_PATTERN = /^\d{4}-\d{2}-\d{2} 00:00:00\.000Z$/;

function isCalendarDate(value) {
  return value === '' || (typeof value === 'string' && CALENDAR_DATE_PATTERN.test(value));
}

// Parent guard (stage 2 data model, one level only). `input`:
//   id            the ticket's id ('' when not known yet)
//   parent        the parent id ('' when none)
//   parentExists  whether the parent was found
//   parentParent  the parent's own parent id
//   hasChildren   whether other tickets use this ticket as parent
// Returns an error code or '' when the parent is allowed. Scope equality is checked separately.
function parentViolation(input) {
  if (input.parent === '') {
    return '';
  }
  if (input.id !== '' && input.parent === input.id) {
    return 'validation_parent_self';
  }
  if (!input.parentExists) {
    return '';
  }
  if (input.parentParent !== '') {
    return 'validation_parent_nested';
  }
  if (input.hasChildren) {
    return 'validation_parent_has_children';
  }
  return '';
}

module.exports = {
  DEFAULT_STATUS: DEFAULT_STATUS,
  DEFAULT_PRIORITY: DEFAULT_PRIORITY,
  CALENDAR_DATE_PATTERN: CALENDAR_DATE_PATTERN,
  createDefaults: createDefaults,
  needsNewKey: needsNewKey,
  scopeViolations: scopeViolations,
  completedAtAction: completedAtAction,
  isCalendarDate: isCalendarDate,
  parentViolation: parentViolation
};
