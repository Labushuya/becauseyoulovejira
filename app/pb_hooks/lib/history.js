// Field diff for ticket_history (CLAUDE.md section 5, E1 plan OF-12).
// Pure CommonJS module, ES5 only, no dependencies (Goja runtime and Vitest).
//
// Callers pass plain values per field: string, number, boolean, array of strings, null or
// undefined. Record values of other types (for example DateTime) must be converted to strings
// by the caller; anything else throws instead of logging a meaningless value.
'use strict';

// Business fields of tickets that are recorded on change; the pinned comment since ADR-0044
// (pinned, released, replaced; the values are comment IDs), the own color since ADR-0052 (keys of
// the palette, '' for "wie Projekt"; before its migration the field reads as '' and changes nothing),
// the charm since ADR-0062 (keys of the catalog, '' for none; the same before its migration), the kind
// since ADR-0065 (`task` or `ongoing`; before its migration '' and no change).
var TRACKED_FIELDS = Object.freeze([
  'title',
  'description',
  'status',
  'priority',
  'due',
  'project',
  'tags',
  'parent',
  'blocks_parent',
  'recurrence',
  'key',
  'household',
  'pinned_comment',
  'color',
  'charm',
  'kind'
]);

// Multi-value fields: order does not matter, stored as sorted JSON array.
var MULTI_VALUE_FIELDS = Object.freeze(['tags']);

function serializeMulti(field, value) {
  var items;
  if (value === null || value === undefined || value === '') {
    items = [];
  } else if (typeof value === 'string') {
    items = [value];
  } else if (Object.prototype.toString.call(value) === '[object Array]') {
    items = value.slice();
  } else {
    throw new TypeError('history: unsupported value for field "' + field + '"');
  }
  for (var i = 0; i < items.length; i++) {
    if (typeof items[i] !== 'string') {
      throw new TypeError('history: unsupported item in field "' + field + '"');
    }
  }
  items.sort();
  return items.length === 0 ? '' : JSON.stringify(items);
}

// Stable string form of a field value; empty and null values both become "".
function serialize(field, value) {
  if (MULTI_VALUE_FIELDS.indexOf(field) !== -1) {
    return serializeMulti(field, value);
  }
  if (value === null || value === undefined) {
    return '';
  }
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'boolean' || typeof value === 'number') {
    return String(value);
  }
  throw new TypeError('history: unsupported value for field "' + field + '"');
}

// Returns one entry { field, old_value, new_value } per tracked field whose serialized value
// changed, in the order of TRACKED_FIELDS.
function diff(oldValues, newValues) {
  var before = oldValues || {};
  var after = newValues || {};
  var changes = [];
  for (var i = 0; i < TRACKED_FIELDS.length; i++) {
    var field = TRACKED_FIELDS[i];
    var oldValue = serialize(field, before[field]);
    var newValue = serialize(field, after[field]);
    if (oldValue !== newValue) {
      changes.push({ field: field, old_value: oldValue, new_value: newValue });
    }
  }
  return changes;
}

module.exports = {
  TRACKED_FIELDS: TRACKED_FIELDS,
  MULTI_VALUE_FIELDS: MULTI_VALUE_FIELDS,
  serialize: serialize,
  diff: diff
};
