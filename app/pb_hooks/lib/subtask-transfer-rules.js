// "Auf Unteraufgaben übertragen …" (UE-1, ADR-0070), the pure rules of the route
// POST /api/byl/tickets/{id}/subtasks/transfer. CommonJS module, ES5 only, no dependencies (Goja
// runtime and Vitest); mirrored in web/src/lib/domain/subtask-transfer.ts
// (tests/unit/web-subtask-transfer.test.mjs keeps limits, texts and the changes equal).
//
// The parent is the source of truth: a request names which fields go to which sub-tasks, never their
// values; the server reads them from the parent in its transaction. Two parts carry more, for the
// change of a parent that UE-2 will offer after a change (ADR-0070 §6): the due date may move by a
// number of days (`shift`) instead of taking the date of the parent (`same`), and tags are added or
// removed (only tags the parent has are added, only tags it does not have are removed).
'use strict';

// Fields that go from the parent to its sub-tasks, in the order of the dialog. Title, description,
// series and kind never do (ADR-0070 §2).
var FIELDS = Object.freeze(['due', 'priority', 'status', 'assignee', 'tags', 'project']);

// Fields that take the value of the parent as it is; a request names them with `true`.
var COPIED_FIELDS = Object.freeze(['priority', 'status', 'assignee', 'project']);

var DUE_MODES = Object.freeze(['same', 'shift']);

// "Alle offenen Unteraufgaben" instead of a list of IDs.
var OPEN_TARGETS = 'open';

var TARGETS_MAX = 200;
var TAGS_MAX = 100;
var SHIFT_DAYS_MAX = 3650;
var ID_MAX = 50;

// Texts of the refusals, the same in the SPA (domain/subtask-transfer.ts TRANSFER_MESSAGES).
var MESSAGES = Object.freeze({
  validation_transfer_expected: 'Der bekannte Stand des Haupttickets fehlt. Bitte erneut öffnen.',
  validation_transfer_fields: 'Wähle mindestens ein Feld zum Übertragen.',
  validation_transfer_field: 'Dieses Feld lässt sich nicht auf Unteraufgaben übertragen.',
  validation_transfer_due: 'Die Fälligkeit wird gleich übernommen oder um 1 bis 3650 Tage verschoben.',
  validation_transfer_tags:
    'Tags: hinzufügen nur Tags des Haupttickets, entfernen nur Tags, die es nicht hat, je höchstens 100.',
  validation_transfer_targets: 'Wähle mindestens eine Unteraufgabe.',
  validation_transfer_targets_max: 'Höchstens 200 Unteraufgaben auf einmal.',
  validation_transfer_target: 'Diese Unteraufgabe gehört nicht zu diesem Ticket oder liegt im Papierkorb.',
  validation_transfer_unavailable: 'Die Zuständigkeit kennt der Server noch nicht.',
  validation_transfer_missing: 'Das Ticket gibt es nicht mehr, oder es liegt im Papierkorb.'
});

// The answer 409 when the parent changed after the dialog read it.
var STALE_MESSAGE = 'Das Hauptticket wurde inzwischen geändert. Bitte erneut öffnen.';

function isObject(value) {
  return typeof value === 'object' && value !== null && Object.prototype.toString.call(value) !== '[object Array]';
}

function isArray(value) {
  return Object.prototype.toString.call(value) === '[object Array]';
}

function refusal(field, code, params) {
  return params ? { field: field, code: code, params: params } : { field: field, code: code };
}

// A list of distinct IDs (non-empty strings of at most ID_MAX characters) with at most `max`
// entries, or null.
function idList(value, max) {
  if (!isArray(value) || value.length > max) {
    return null;
  }
  var list = [];
  for (var i = 0; i < value.length; i++) {
    var id = value[i];
    if (typeof id !== 'string' || id === '' || id.length > ID_MAX || list.indexOf(id) !== -1) {
      return null;
    }
    list.push(id);
  }
  return list;
}

// { mode: 'same' } or { mode: 'shift', days } with a whole number of days, 1 to SHIFT_DAYS_MAX either
// way; null for anything else.
function parseDue(value) {
  if (!isObject(value) || DUE_MODES.indexOf(value.mode) === -1) {
    return null;
  }
  if (value.mode === 'same') {
    return value.days === undefined ? { mode: 'same' } : null;
  }
  var days = value.days;
  if (typeof days !== 'number' || Math.floor(days) !== days || days === 0 || Math.abs(days) > SHIFT_DAYS_MAX) {
    return null;
  }
  return { mode: 'shift', days: days };
}

// { add, remove } with distinct IDs, none in both, at least one in all; null for anything else.
function parseTags(value) {
  if (!isObject(value)) {
    return null;
  }
  var add = value.add === undefined ? [] : idList(value.add, TAGS_MAX);
  var remove = value.remove === undefined ? [] : idList(value.remove, TAGS_MAX);
  if (add === null || remove === null || add.length + remove.length === 0) {
    return null;
  }
  for (var i = 0; i < add.length; i++) {
    if (remove.indexOf(add[i]) !== -1) {
      return null;
    }
  }
  return { add: add, remove: remove };
}

// The chosen fields: { due, priority, status, assignee, project, tags } or a refusal.
function parseFields(value) {
  if (!isObject(value)) {
    return refusal('fields', 'validation_transfer_fields');
  }
  var fields = { due: null, priority: false, status: false, assignee: false, project: false, tags: null };
  var chosen = 0;
  for (var name in value) {
    if (!Object.prototype.hasOwnProperty.call(value, name)) {
      continue;
    }
    var entry = value[name];
    if (FIELDS.indexOf(name) === -1) {
      return refusal('fields', 'validation_transfer_field', { field: name });
    }
    if (entry === false || entry === null || entry === undefined) {
      continue;
    }
    if (name === 'due') {
      fields.due = parseDue(entry);
      if (fields.due === null) {
        return refusal('due', 'validation_transfer_due');
      }
    } else if (name === 'tags') {
      fields.tags = parseTags(entry);
      if (fields.tags === null) {
        return refusal('tags', 'validation_transfer_tags');
      }
    } else if (entry === true) {
      fields[name] = true;
    } else {
      return refusal('fields', 'validation_transfer_field', { field: name });
    }
    chosen += 1;
  }
  return chosen === 0 ? refusal('fields', 'validation_transfer_fields') : { value: fields };
}

// 'open' or a list of 1 to TARGETS_MAX distinct IDs; a refusal otherwise.
function parseTargets(value) {
  if (value === OPEN_TARGETS) {
    return { value: OPEN_TARGETS };
  }
  if (isArray(value) && value.length > TARGETS_MAX) {
    return refusal('targets', 'validation_transfer_targets_max');
  }
  var ids = idList(value, TARGETS_MAX);
  if (ids === null || ids.length === 0) {
    return refusal('targets', 'validation_transfer_targets');
  }
  return { value: ids };
}

/**
 * The body of a request: { expected_updated, fields, targets }. Returns { options: { expected,
 * fields, targets } } or { field, code, params? } of the first refusal, before anything is read.
 */
function parseRequest(body) {
  var source = isObject(body) ? body : {};
  var expected = source.expected_updated;
  if (typeof expected !== 'string' || expected === '') {
    return refusal('expected_updated', 'validation_transfer_expected');
  }
  var fields = parseFields(source.fields);
  if (!fields.value) {
    return fields;
  }
  var targets = parseTargets(source.targets);
  if (!targets.value) {
    return targets;
  }
  return { options: { expected: expected, fields: fields.value, targets: targets.value } };
}

/**
 * The tags of a request against the tags of the parent (its source of truth): only tags it has are
 * added, only tags it does not have are removed. Returns '' or the code.
 */
function tagsViolation(tags, parentTags) {
  if (tags === null) {
    return '';
  }
  for (var i = 0; i < tags.add.length; i++) {
    if (parentTags.indexOf(tags.add[i]) === -1) {
      return 'validation_transfer_tags';
    }
  }
  for (var j = 0; j < tags.remove.length; j++) {
    if (parentTags.indexOf(tags.remove[j]) !== -1) {
      return 'validation_transfer_tags';
    }
  }
  return '';
}

// The tags of a sub-task after the change: its own without the removed ones, then the added ones it
// lacks, in the order of the request.
function nextTags(own, tags) {
  var list = [];
  for (var i = 0; i < own.length; i++) {
    if (tags.remove.indexOf(own[i]) === -1 && list.indexOf(own[i]) === -1) {
      list.push(own[i]);
    }
  }
  for (var j = 0; j < tags.add.length; j++) {
    if (list.indexOf(tags.add[j]) === -1) {
      list.push(tags.add[j]);
    }
  }
  return list;
}

function sameSet(a, b) {
  if (a.length !== b.length) {
    return false;
  }
  for (var i = 0; i < a.length; i++) {
    if (b.indexOf(a[i]) === -1) {
      return false;
    }
  }
  return true;
}

/**
 * What a sub-task gets: `parent` and `child` as { due ('YYYY-MM-DD' or ''), priority, status, assignee,
 * project, tags (IDs) }, `fields` as parsed. `shift(date, days)` moves a calendar date (berlin-time.js
 * addDays on the server, berlin-date.ts on the client). Returns the changed fields with their new
 * values, or null when the sub-task has all of them already (it is not saved then and does not count).
 */
function changesOf(parent, child, fields, shift) {
  var changes = {};
  var changed = false;
  if (fields.due !== null) {
    var due = fields.due.mode === 'same' ? parent.due : child.due === '' ? '' : shift(child.due, fields.due.days);
    if (due !== child.due) {
      changes.due = due;
      changed = true;
    }
  }
  for (var i = 0; i < COPIED_FIELDS.length; i++) {
    var name = COPIED_FIELDS[i];
    if (fields[name] && parent[name] !== child[name]) {
      changes[name] = parent[name];
      changed = true;
    }
  }
  if (fields.tags !== null) {
    var tags = nextTags(child.tags, fields.tags);
    if (!sameSet(tags, child.tags)) {
      changes.tags = tags;
      changed = true;
    }
  }
  return changed ? changes : null;
}

module.exports = {
  FIELDS: FIELDS,
  COPIED_FIELDS: COPIED_FIELDS,
  DUE_MODES: DUE_MODES,
  OPEN_TARGETS: OPEN_TARGETS,
  TARGETS_MAX: TARGETS_MAX,
  TAGS_MAX: TAGS_MAX,
  SHIFT_DAYS_MAX: SHIFT_DAYS_MAX,
  MESSAGES: MESSAGES,
  STALE_MESSAGE: STALE_MESSAGE,
  parseRequest: parseRequest,
  tagsViolation: tagsViolation,
  changesOf: changesOf
};
