// Dependencies of a ticket in the trash (ADR-0047, ADR-0037 addendum "Erst auflösen, dann
// löschen"). Pure CommonJS module, ES5 only, without require, so the Goja runtime and Vitest load
// it the same way; the SPA mirrors it in web/src/lib/domain/trash-dependencies.ts (parity test).
// The database part is lib/trash-service.js.
//
// A group of the trash (a ticket with the sub-tasks that went with it) is blocked while one of
// them is not done or a source still hangs on one of them (a source the user discarded with the
// ticket, ADR-0037 §6; sources given back to the inbox hang on nothing). Deleting for good
// ("Endgültig löschen", "Papierkorb leeren", the retention, the admin UI) refuses or skips a
// blocked group; the decision help offers only the ways our rules allow for each dependency.
'use strict';

var DONE = 'done';

// Decisions of the route POST /api/byl/trash/{id}/resolve, one per dependency.
var ACTIONS = ['complete', 'inbox', 'discard', 'move'];

// At most this many decisions in one request (the collective ways of a big group stay below).
var MAX_ACTIONS = 200;

function text(value) {
  return value === undefined || value === null ? '' : String(value);
}

/**
 * The dependencies of a group, in a fixed order: the open tickets (the first ticket of the group,
 * then its sub-tasks in their order), then the sources (per ticket of the group, the main source
 * first). `group`:
 *   tickets  [{ id, key, title, status, blocks }], the first ticket of the group first; `blocks`
 *            is blocks_parent of a sub-task (ADR-0033)
 *   sources  [{ id, ticket, title, channel, scope, primary }]: inbox entries bound to a ticket of
 *            the group; `primary`: the main source of that ticket (ADR-0031)
 * Each entry names the options the decision help offers (optionsOf).
 */
function dependenciesOf(group) {
  var tickets = group && group.tickets ? group.tickets : [];
  var sources = group && group.sources ? group.sources : [];
  var list = [];
  var openBlocking = 0;
  for (var c = 1; c < tickets.length; c++) {
    if (text(tickets[c].status) !== DONE && tickets[c].blocks !== false) {
      openBlocking += 1;
    }
  }
  var keys = {};
  for (var i = 0; i < tickets.length; i++) {
    var ticket = tickets[i];
    keys[text(ticket.id)] = text(ticket.key);
    if (text(ticket.status) === DONE) {
      continue;
    }
    var entry = {
      kind: 'ticket',
      ticket: text(ticket.id),
      key: text(ticket.key),
      title: text(ticket.title),
      status: text(ticket.status),
      subtask: i > 0,
      open_blocking: i === 0 ? openBlocking : 0
    };
    entry.options = optionsOf(entry);
    list.push(entry);
  }
  var ordered = [];
  for (var t = 0; t < tickets.length; t++) {
    for (var p = 0; p < 2; p++) {
      for (var s = 0; s < sources.length; s++) {
        var source = sources[s];
        if (text(source.ticket) === text(tickets[t].id) && !!source.primary === (p === 0)) {
          ordered.push(source);
        }
      }
    }
  }
  for (var o = 0; o < ordered.length; o++) {
    var item = ordered[o];
    var bound = {
      kind: 'source',
      item: text(item.id),
      ticket: text(item.ticket),
      key: keys[text(item.ticket)] || '',
      title: text(item.title),
      channel: text(item.channel),
      scope: text(item.scope),
      primary: !!item.primary
    };
    bound.options = optionsOf(bound);
    list.push(bound);
  }
  return list;
}

/**
 * The ways the decision help offers for one dependency, and only those our rules allow:
 * - an open ticket: "Als erledigt markieren" ('complete'; the first ticket with open blocking
 *   sub-tasks only together with them, 'complete_children', ADR-0033 §2) and "Wiederherstellen"
 *   ('restore', the whole group); a sub-task also "Lösen und als eigenständiges Ticket
 *   wiederherstellen" ('detach');
 * - a source: "Zurück in den Eingang" ('inbox') and "Verwerfen" ('discard', it stays as a block
 *   against the same object, ADR-0014); only a source that is not the main source also "Anderem
 *   Ticket zuordnen …" ('move'): the main source stays with its ticket (ADR-0031).
 */
function optionsOf(dependency) {
  if (dependency.kind === 'ticket') {
    var complete = dependency.open_blocking > 0 ? 'complete_children' : 'complete';
    return dependency.subtask ? [complete, 'restore', 'detach'] : [complete, 'restore'];
  }
  return dependency.primary ? ['inbox', 'discard'] : ['inbox', 'discard', 'move'];
}

/** Whether the group may be deleted for good: only without dependencies. */
function isBlocked(dependencies) {
  return dependencies.length > 0;
}

/** { total, tickets, sources } of a list of dependencies. */
function countsOf(dependencies) {
  var counts = { total: dependencies.length, tickets: 0, sources: 0 };
  for (var i = 0; i < dependencies.length; i++) {
    if (dependencies[i].kind === 'ticket') {
      counts.tickets += 1;
    } else {
      counts.sources += 1;
    }
  }
  return counts;
}

/**
 * The decisions of a collective way, for the preview and the request: 'complete' marks every open
 * ticket of the group as done (the sub-tasks first, so the first ticket is never refused because
 * of them), 'inbox' gives every source back to the inbox, 'discard' discards every source.
 */
function collectiveActions(dependencies, kind) {
  var actions = [];
  var i;
  if (kind === 'complete') {
    for (i = 0; i < dependencies.length; i++) {
      if (dependencies[i].kind === 'ticket' && dependencies[i].subtask) {
        actions.push({ action: 'complete', ticket: dependencies[i].ticket });
      }
    }
    for (i = 0; i < dependencies.length; i++) {
      if (dependencies[i].kind === 'ticket' && !dependencies[i].subtask) {
        actions.push({ action: 'complete', ticket: dependencies[i].ticket });
      }
    }
    return actions;
  }
  if (kind === 'inbox' || kind === 'discard') {
    for (i = 0; i < dependencies.length; i++) {
      if (dependencies[i].kind === 'source') {
        actions.push({ action: kind, item: dependencies[i].item });
      }
    }
  }
  return actions;
}

function find(dependencies, kind, field, id) {
  for (var i = 0; i < dependencies.length; i++) {
    if (dependencies[i].kind === kind && dependencies[i][field] === id) {
      return dependencies[i];
    }
  }
  return null;
}

/**
 * Checks the decisions of a request against the dependencies of the group before anything is
 * written. Returns null or { index, code } with the code of trash-rules MESSAGES:
 * - validation_trash_resolve_empty: no list, an empty one, or more than MAX_ACTIONS;
 * - validation_trash_resolve_action: an unknown decision;
 * - validation_trash_resolve_target: a ticket or source that is no (longer an) open dependency of
 *   this group, the same one twice, or "move" without a target or onto a ticket of the group;
 * - validation_trash_resolve_primary: "move" of a main source (ADR-0031).
 */
function actionsViolation(actions, dependencies, groupIds) {
  if (Object.prototype.toString.call(actions) !== '[object Array]' || actions.length === 0 || actions.length > MAX_ACTIONS) {
    return { index: -1, code: 'validation_trash_resolve_empty' };
  }
  var seen = {};
  for (var i = 0; i < actions.length; i++) {
    var action = actions[i];
    var name = action && typeof action === 'object' ? text(action.action) : '';
    if (ACTIONS.indexOf(name) === -1) {
      return { index: i, code: 'validation_trash_resolve_action' };
    }
    var id = name === 'complete' ? text(action.ticket) : text(action.item);
    var dependency = name === 'complete' ? find(dependencies, 'ticket', 'ticket', id) : find(dependencies, 'source', 'item', id);
    if (id === '' || dependency === null || seen[id]) {
      return { index: i, code: 'validation_trash_resolve_target' };
    }
    seen[id] = true;
    if (name === 'move') {
      if (dependency.primary) {
        return { index: i, code: 'validation_trash_resolve_primary' };
      }
      var target = text(action.target);
      if (target === '' || (groupIds || []).indexOf(target) !== -1) {
        return { index: i, code: 'validation_trash_resolve_target' };
      }
    }
  }
  return null;
}

module.exports = {
  DONE: DONE,
  ACTIONS: ACTIONS,
  MAX_ACTIONS: MAX_ACTIONS,
  dependenciesOf: dependenciesOf,
  optionsOf: optionsOf,
  isBlocked: isBlocked,
  countsOf: countsOf,
  collectiveActions: collectiveActions,
  actionsViolation: actionsViolation
};
