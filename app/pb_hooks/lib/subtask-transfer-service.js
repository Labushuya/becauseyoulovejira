// "Auf Unteraufgaben übertragen …" (UE-1, ADR-0070), the database part. CommonJS module, ES5 only,
// Goja runtime only. The pure decisions are in lib/subtask-transfer-rules.js.
//
// POST /api/byl/tickets/{id}/subtasks/transfer gives sub-tasks of a ticket the values of chosen fields
// of that ticket (the parent), in one transaction of the route (e.app.runInTransaction, like
// "Duplizieren"), or nothing. The parent is the source of truth: the route reads its values in the
// transaction and refuses with 409 when it changed after the dialog read it (`expected_updated`).
//
// Every sub-task is saved with txApp, so the model hooks of tickets run for it as for a change through
// the Record API (ADR-0070 §4): checks of the fields (scope, archived project, assignee of the
// household), completed_at, a new key in the counter of a new project, the history with the acting
// account, the series (completing an instance fixes the next date, reopening may remove its untouched
// follow-up or refuse), the pins of a ticket that becomes done, the entries of the day plan, the read
// row of a new assignee and, after the commit, realtime and the follow-up of a series. The request
// hooks do not run for a save of a route; what they do is either nothing for such a save (source,
// series, trash and area stay as they are) or done here: the acting account (ACTOR_KEY), the rights of
// the update rule per sub-task and the expected state of the parent. A sub-task has no sub-tasks of
// its own, so `force` and `complete_children` of a completion have nothing to do.
//
// An assignee hears once of all sub-tasks given to him (ADR-0070 §5): the saves carry BATCH_KEY, so the
// after-success hook of each stays silent, and after the commit this route sends one notice per
// person ("Anna hat dir 3 Unteraufgaben von HAUS-12 zugewiesen.").
'use strict';

var rules = require(__hooks + '/lib/subtask-transfer-rules.js');
var errors = require(__hooks + '/lib/errors.js');
var trashRules = require(__hooks + '/lib/trash-rules.js');
var berlinTime = require(__hooks + '/lib/berlin-time.js');
var ticketService = require(__hooks + '/lib/ticket-service.js');
var assignees = require(__hooks + '/lib/assignee-service.js');

var TICKETS = 'tickets';
var FORBIDDEN = 'Dafür fehlt die Berechtigung.';
var FAILED = 'Die Unteraufgabe ließ sich nicht ändern.';

// Stored form of a due date (CLAUDE.md section 5).
var DUE_SUFFIX = ' 00:00:00.000Z';

function fail(field, code, params) {
  return errors.fieldFailure(field, code, rules.MESSAGES[code], params);
}

// The parent is gone, in the trash or not visible: 404 with the field `ticket`, so the SPA tells it
// from a server that does not know the route yet (404 without it, before the restart).
function missing() {
  var code = 'validation_transfer_missing';
  var data = {};
  data.ticket = new ValidationError(code, rules.MESSAGES[code]);
  return new NotFoundError(rules.MESSAGES[code], data);
}

// Returns the record or null; real database errors still throw.
function findById(app, collection, id) {
  if (typeof id !== 'string' || id === '') {
    return null;
  }
  var found = app.findRecordsByFilter(collection, 'id = {:id}', '', 1, 0, { id: id });
  return found.length > 0 ? found[0] : null;
}

function isTrashed(record) {
  return trashRules.isTrashed(record.getString('deleted_at'));
}

function stringList(values) {
  var list = [];
  for (var i = 0; i < values.length; i++) {
    list.push(String(values[i]));
  }
  return list;
}

// The signed-in app user of the request (the route requires one).
function actorOf(e) {
  return e.auth && e.auth.collection().name === 'users' ? e.auth.id : '';
}

function calendarOf(stored) {
  return stored === '' ? '' : stored.slice(0, 10);
}

function storedOf(date) {
  return date === '' ? '' : date + DUE_SUFFIX;
}

// The values of a ticket the rules compare; the assignee reads as '' before its migration.
function valuesOf(record) {
  return {
    due: calendarOf(record.getString('due')),
    priority: record.getString('priority'),
    status: record.getString('status'),
    assignee: record.getString('assignee'),
    project: record.getString('project'),
    tags: stringList(record.getStringSlice('tags'))
  };
}

function shift(date, days) {
  return berlinTime.addDays(date, days);
}

function apply(record, changes) {
  for (var name in changes) {
    if (Object.prototype.hasOwnProperty.call(changes, name)) {
      record.set(name, name === 'due' ? storedOf(changes[name]) : changes[name]);
    }
  }
}

/**
 * The sub-tasks the request names, read in the transaction: with 'open' every sub-task of the parent
 * that is not done (the category "abgeschlossen", lib/status.js) and not in the trash, oldest first;
 * with IDs exactly those, each a sub-task of this parent and not in the trash (otherwise the field
 * `targets` with its index). At least one, at most TARGETS_MAX.
 */
function targetsOf(txApp, parent, targets) {
  var status = require(__hooks + '/lib/status.js');
  var list = [];
  if (targets === rules.OPEN_TARGETS) {
    var children = txApp.findRecordsByFilter(TICKETS, 'parent = {:id}', 'created,id', 0, 0, { id: parent.id });
    for (var i = 0; i < children.length; i++) {
      if (!isTrashed(children[i]) && status.categoryOf(children[i].getString('status')) !== 'closed') {
        list.push(children[i]);
      }
    }
  } else {
    for (var j = 0; j < targets.length; j++) {
      var child = findById(txApp, TICKETS, targets[j]);
      if (child === null || child.getString('parent') !== parent.id || isTrashed(child)) {
        throw fail('targets', 'validation_transfer_target', { index: j, id: targets[j] });
      }
      list.push(child);
    }
  }
  if (list.length === 0) {
    throw fail('targets', 'validation_transfer_targets');
  }
  if (list.length > rules.TARGETS_MAX) {
    throw fail('targets', 'validation_transfer_targets_max');
  }
  return list;
}

// The first error per field of a refused save, as the hooks and PocketBase's own validation throw it
// (an ApiError with `data`, whose entries carry code and message as values or as methods).
function detailOf(err) {
  var holders = [err, err && err.value];
  for (var i = 0; i < holders.length; i++) {
    var data = holders[i] && typeof holders[i] === 'object' ? holders[i].data : null;
    if (!data || typeof data !== 'object') {
      continue;
    }
    for (var field in data) {
      if (!Object.prototype.hasOwnProperty.call(data, field) || !data[field]) {
        continue;
      }
      var entry = data[field];
      var code = typeof entry.code === 'function' ? entry.code() : entry.code;
      var message = typeof entry.message === 'function' ? entry.message() : entry.message;
      if (typeof code === 'string' && code !== '') {
        return { field: field, code: code, message: typeof message === 'string' && message !== '' ? message : FAILED };
      }
    }
  }
  return null;
}

// Saves a sub-task through the model hooks; a refusal names the sub-task: its key before the change
// in the message, ID, key and field in the params of the field `targets`. Anything that is no refusal
// of a field (a broken database) goes on as it is. Either way the transaction rolls back.
function saveTarget(txApp, record, key) {
  try {
    txApp.save(record);
  } catch (err) {
    var detail = detailOf(err);
    if (detail === null) {
      throw err;
    }
    throw errors.fieldFailure('targets', detail.code, key + ': ' + detail.message, {
      id: record.id,
      key: key,
      field: detail.field
    });
  }
}

/**
 * POST /api/byl/tickets/{id}/subtasks/transfer: the body as described in lib/subtask-transfer-rules.js
 * parseRequest. Only a ticket the request may see (else 404 with the field `ticket`) and change (else
 * 403), only its own sub-tasks (else 400 at `targets`), each one the request may change (else 403).
 * Answers { parent: { id, key }, changed, unchanged, tickets: [{ id, key, previous_key }] }: the
 * sub-tasks that changed with their key after and before (a new project gives a new key), and how many
 * had every chosen value already (they are not saved).
 */
function transfer(e, id) {
  var parsed = rules.parseRequest(e.requestInfo().body);
  if (!parsed.options) {
    throw fail(parsed.field, parsed.code, parsed.params);
  }
  var options = parsed.options;
  var info = e.requestInfo();
  var collection = e.app.findCollectionByNameOrId(TICKETS);
  var parent = findById(e.app, TICKETS, id);
  if (parent === null || isTrashed(parent) || !e.app.canAccessRecord(parent, info, collection.viewRule)) {
    throw missing();
  }
  if (!e.app.canAccessRecord(parent, info, collection.updateRule)) {
    throw new ForbiddenError(FORBIDDEN);
  }
  if (options.fields.assignee && !assignees.ready(e.app)) {
    throw fail('fields', 'validation_transfer_unavailable', { field: 'assignee' });
  }
  var actor = actorOf(e);
  var result = null;
  var notices = [];
  var source = null;
  e.app.runInTransaction(function (txApp) {
    var current = findById(txApp, TICKETS, parent.id);
    if (current === null || isTrashed(current)) {
      throw missing();
    }
    if (current.getString('updated') !== options.expected) {
      throw new ApiError(409, rules.STALE_MESSAGE);
    }
    var values = valuesOf(current);
    if (rules.tagsViolation(options.fields.tags, values.tags) !== '') {
      throw fail('tags', 'validation_transfer_tags');
    }
    var targets = targetsOf(txApp, current, options.targets);
    for (var i = 0; i < targets.length; i++) {
      if (!txApp.canAccessRecord(targets[i], info, collection.updateRule)) {
        throw new ForbiddenError(targets[i].getString('key') + ': ' + FORBIDDEN);
      }
    }
    var changed = [];
    for (var j = 0; j < targets.length; j++) {
      var target = targets[j];
      var changes = rules.changesOf(values, valuesOf(target), options.fields, shift);
      if (changes === null) {
        continue;
      }
      var previous = target.getString('key');
      apply(target, changes);
      target.set(ticketService.ACTOR_KEY, actor);
      target.set(assignees.BATCH_KEY, true);
      saveTarget(txApp, target, previous);
      changed.push({ id: target.id, key: target.getString('key'), previous_key: previous });
      var notice = assignees.noticeOf(target);
      if (notice !== null) {
        notices.push({ notice: notice, record: target });
      }
    }
    source = current;
    result = {
      parent: { id: current.id, key: current.getString('key') },
      changed: changed.length,
      unchanged: targets.length - changed.length,
      tickets: changed
    };
  });
  // After the commit: one notice per person for every sub-task given to him by someone else.
  assignees.notifyAssignedTogether(e.app, notices, source);
  return result;
}

module.exports = {
  transfer: transfer
};
