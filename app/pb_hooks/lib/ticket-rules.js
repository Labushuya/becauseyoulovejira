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

module.exports = {
  DEFAULT_STATUS: DEFAULT_STATUS,
  DEFAULT_PRIORITY: DEFAULT_PRIORITY,
  createDefaults: createDefaults,
  needsNewKey: needsNewKey,
  scopeViolations: scopeViolations
};
