// Tickets as sources of other tickets (QT-1, ADR-0067), the database part. CommonJS module, ES5 only,
// Goja runtime only. The pure decisions are in lib/ticket-source-rules.js.
//
// A link (collection ticket_sources: ticket, source, created_by, created) says "ticket stems from
// source". The API rules only let accounts read links between two tickets they see; writing is null,
// so every link comes through the routes of this module (ticket-sources.pb.js), "Duplizieren" with
// "Kopie der Herkunft übernehmen" (lib/duplicate-service.js) or a move between the areas
// (lib/area-move-service.js), each in one transaction with the history of both tickets.
//
// The model hooks of ticket_sources hold for every writer, the superuser included: no link of a ticket
// to itself, both tickets alive (not in the trash) and in the same area (ADR-0059 §4), and no link
// that would close a circle, however long (lib/ticket-source-rules.js cyclePath). The circle check
// runs after the insert, in the same transaction: PocketBase runs every transaction on its one
// connection for writing, so a second request that would close the circle the other way round only
// starts once the first committed, and then sees its link. Links to a ticket in the trash count for
// the check, because restoring brings them back.
'use strict';

var rules = require(__hooks + '/lib/ticket-source-rules.js');
var errors = require(__hooks + '/lib/errors.js');
var trashRules = require(__hooks + '/lib/trash-rules.js');
var ticketRules = require(__hooks + '/lib/ticket-rules.js');

var LINKS = 'ticket_sources';
var TICKETS = 'tickets';
var LINK_ORDER = 'created,id';

var UNAVAILABLE = 'Tickets als Quelle stehen nach dem nächsten Neustart der App bereit.';
var NOT_FOUND = 'Ticket nicht gefunden.';
var AREA_FORBIDDEN = 'In diesem Bereich darfst du keine Tickets anlegen.';

/** True once the migration of the links ran (the running instance may still miss it). */
function ready(app) {
  try {
    app.findCollectionByNameOrId(LINKS);
    return true;
  } catch (err) {
    return false;
  }
}

// Returns the record or null; real database errors still throw.
function findById(app, collection, id) {
  if (typeof id !== 'string' || id === '') {
    return null;
  }
  var found = app.findRecordsByFilter(collection, 'id = {:id}', '', 1, 0, { id: id });
  return found.length > 0 ? found[0] : null;
}

function isTrashed(ticket) {
  return trashRules.isTrashed(ticket.getString('deleted_at'));
}

function fail(field, code) {
  return errors.fieldFailure(field, code, rules.MESSAGES[code]);
}

function listOf(found) {
  var list = [];
  for (var i = 0; i < found.length; i++) {
    list.push(found[i]);
  }
  return list;
}

// The signed-in app user of the request (the routes require one).
function actorOf(e) {
  return e.auth && e.auth.collection().name === 'users' ? e.auth.id : '';
}

/** The links where `field` ('ticket' or 'source') is `id`, oldest first. */
function linksWhere(app, field, id) {
  return listOf(app.findRecordsByFilter(LINKS, field + ' = {:id}', LINK_ORDER, 0, 0, { id: id }));
}

/** Every link of a ticket, as follow-up and as source. */
function linksOfTicket(app, id) {
  return listOf(app.findRecordsByFilter(LINKS, 'ticket = {:id} || source = {:id}', LINK_ORDER, 0, 0, { id: id }));
}

/** The other ticket of a link seen from `ticketId`. */
function otherEnd(link, ticketId) {
  return link.getString('ticket') === ticketId ? link.getString('source') : link.getString('ticket');
}

function idsOf(links, field) {
  var ids = [];
  for (var i = 0; i < links.length; i++) {
    ids.push(links[i].getString(field));
  }
  return ids;
}

/** The IDs `id` stems from. */
function sourceIdsOf(app, id) {
  return idsOf(linksWhere(app, 'ticket', id), 'source');
}

/** The IDs that stem from `id`. */
function followUpIdsOf(app, id) {
  return idsOf(linksWhere(app, 'source', id), 'ticket');
}

function findLink(app, ticketId, sourceId) {
  var found = app.findRecordsByFilter(LINKS, 'ticket = {:ticket} && source = {:source}', '', 1, 0, {
    ticket: ticketId,
    source: sourceId
  });
  return found.length > 0 ? found[0] : null;
}

// --- Model hooks --------------------------------------------------------------------------------

/**
 * onRecordCreate and onRecordUpdate of ticket_sources before e.next(), in the transaction: no link of
 * a ticket to itself, both tickets alive and in the same area. A missing ticket is the error of the
 * relation (PocketBase).
 */
function checkLink(app, record) {
  var ticketId = record.getString('ticket');
  var sourceId = record.getString('source');
  if (ticketId !== '' && ticketId === sourceId) {
    throw fail('source', 'validation_ticket_source_self');
  }
  var ticket = findById(app, TICKETS, ticketId);
  var source = findById(app, TICKETS, sourceId);
  if (ticket === null || source === null) {
    return;
  }
  if (isTrashed(source)) {
    throw fail('source', 'validation_ticket_source_missing');
  }
  if (isTrashed(ticket)) {
    throw fail('ticket', 'validation_ticket_source_missing');
  }
  if (ticket.getString('scope') !== source.getString('scope')) {
    throw errors.fieldFailure('source', 'validation_scope_mismatch', ticketRules.scopeMessage('source'));
  }
}

/** The keys of the tickets of a chain, in its order (a ticket that is gone reads as its ID). */
function keysOf(app, ids) {
  var keys = [];
  for (var i = 0; i < ids.length; i++) {
    var ticket = findById(app, TICKETS, ids[i]);
    keys.push(ticket === null ? ids[i] : ticket.getString('key'));
  }
  return keys;
}

/**
 * onRecordCreate and onRecordUpdate of ticket_sources after e.next(), in the same transaction: the
 * link that is now stored must not close a circle (lib/ticket-source-rules.js cyclePath over every
 * link, those of tickets in the trash included). The refusal names the chain:
 * validation_ticket_source_cycle at the field `source` with `params.path` (keys) and the text of
 * cycleMessage; the transaction rolls the link back.
 */
function checkCircle(app, record) {
  var path = rules.cyclePath(
    function (id) {
      return sourceIdsOf(app, id);
    },
    record.getString('ticket'),
    record.getString('source')
  );
  if (path === null) {
    return;
  }
  if (path.length < 2) {
    throw fail('source', 'validation_ticket_source_self');
  }
  var keys = keysOf(app, path);
  throw errors.fieldFailure('source', 'validation_ticket_source_cycle', rules.cycleMessage(keys), { path: keys });
}

// --- Writing ------------------------------------------------------------------------------------

function saveHistory(txApp, ticketId, field, oldValue, newValue, actor) {
  var entry = new Record(txApp.findCollectionByNameOrId('ticket_history'));
  entry.set('ticket', ticketId);
  entry.set('field', field);
  entry.set('old_value', oldValue);
  entry.set('new_value', newValue);
  entry.set('user', actor || '');
  txApp.save(entry);
}

/**
 * Links `ticket` as stemming from `source` (both records) in the transaction of the caller: the model
 * hooks check area and circle; the history of the follow-up says "Quelle hinzugefügt: KEY", the one
 * of the source "Folge-Ticket: KEY". `actor` is the account ('' for the server). Returns the link.
 */
function link(txApp, ticket, source, actor) {
  var record = new Record(txApp.findCollectionByNameOrId(LINKS));
  record.set('ticket', ticket.id);
  record.set('source', source.id);
  record.set('created_by', actor || '');
  txApp.save(record);
  saveHistory(txApp, ticket.id, rules.HISTORY_SOURCE, '', rules.historyValue(source.id, source.getString('key')), actor);
  saveHistory(txApp, source.id, rules.HISTORY_FOLLOW_UP, '', rules.historyValue(ticket.id, ticket.getString('key')), actor);
  return record;
}

/**
 * Removes a link in the transaction of the caller, with "Quelle entfernt: KEY" in the history of the
 * follow-up and "Folge-Ticket entfernt: KEY" in the one of the source (also when one of them lies in
 * the trash: its history comes back with it).
 */
function unlink(txApp, record, actor) {
  var ticket = findById(txApp, TICKETS, record.getString('ticket'));
  var source = findById(txApp, TICKETS, record.getString('source'));
  txApp.delete(record);
  if (ticket !== null && source !== null) {
    saveHistory(txApp, ticket.id, rules.HISTORY_SOURCE, rules.historyValue(source.id, source.getString('key')), '', actor);
    saveHistory(txApp, source.id, rules.HISTORY_FOLLOW_UP, rules.historyValue(ticket.id, ticket.getString('key')), '', actor);
  }
}

/** The sources of a ticket that are alive (not in the trash), oldest link first. */
function liveSourcesOf(app, ticketId) {
  var links = linksWhere(app, 'ticket', ticketId);
  var sources = [];
  for (var i = 0; i < links.length; i++) {
    var source = findById(app, TICKETS, links[i].getString('source'));
    if (source !== null && !isTrashed(source)) {
      sources.push(source);
    }
  }
  return sources;
}

/**
 * "Duplizieren" with "Kopie der Herkunft übernehmen" (ADR-0045, addendum QT-1): the duplicate stems
 * from every live source ticket of the original, in the transaction of the duplication. Returns how
 * many links it got. Before the migration nothing happens.
 */
function copySources(txApp, original, duplicate, actor) {
  if (!ready(txApp)) {
    return 0;
  }
  var sources = liveSourcesOf(txApp, original.id);
  for (var i = 0; i < sources.length; i++) {
    link(txApp, duplicate, sources[i], actor);
  }
  return sources.length;
}

/** Number of live source tickets of a ticket (0 before the migration). */
function liveSourceCount(app, ticketId) {
  return ready(app) ? liveSourcesOf(app, ticketId).length : 0;
}

// --- Routes -------------------------------------------------------------------------------------

function unavailable(e) {
  return e.json(503, { status: 503, message: UNAVAILABLE, reason: 'missing' });
}

function answer(e, body) {
  e.response.header().set('Cache-Control', 'no-store');
  return e.json(200, body);
}

/**
 * A ticket the request may see (view rule of tickets, so never one in the trash), or null. Every
 * member of an area may change its tickets, so seeing a ticket is enough to change its sources.
 */
function visibleTicket(e, app, id) {
  var ticket = findById(app, TICKETS, id);
  if (ticket === null) {
    return null;
  }
  var collection = app.findCollectionByNameOrId(TICKETS);
  return app.canAccessRecord(ticket, e.requestInfo(), collection.viewRule) ? ticket : null;
}

function entryOf(record, other) {
  return {
    link: record.id,
    id: other.id,
    key: other.getString('key'),
    title: other.getString('title'),
    status: other.getString('status'),
    trashed: isTrashed(other),
    created: record.getString('created'),
    created_by: record.getString('created_by')
  };
}

/**
 * The origins of a ticket for the sections "Quellen" and "Folge-Tickets": its source tickets and its
 * direct follow-ups (a ticket in the trash with `trashed`, so the section says "(im Papierkorb)"), and
 * every ticket that stems from it over any number of steps (`descendants`): none of them may become
 * its source. Only tickets the account sees, the trash aside (they lie in the area of the ticket).
 */
function originsOf(e, app, ticket) {
  var visible = require(__hooks + '/lib/trash-service.js').VISIBLE_RULE;
  var info = e.requestInfo();
  function entries(field, otherField) {
    var links = linksWhere(app, field, ticket.id);
    var list = [];
    for (var i = 0; i < links.length; i++) {
      var other = findById(app, TICKETS, links[i].getString(otherField));
      if (other !== null && app.canAccessRecord(other, info, visible)) {
        list.push(entryOf(links[i], other));
      }
    }
    return list;
  }
  return {
    ticket: ticket.id,
    sources: entries('ticket', 'source'),
    follow_ups: entries('source', 'ticket'),
    descendants: rules.reachable(function (id) {
      return followUpIdsOf(app, id);
    }, ticket.id)
  };
}

/** GET /api/byl/tickets/{id}/ticket-sources: the origins of a visible ticket (else 404). */
function origins(e, id) {
  if (!ready(e.app)) {
    return unavailable(e);
  }
  var ticket = visibleTicket(e, e.app, id);
  if (ticket === null) {
    throw new NotFoundError(NOT_FOUND);
  }
  return answer(e, originsOf(e, e.app, ticket));
}

/**
 * POST /api/byl/tickets/{id}/ticket-sources { source }: "Quelle hinzufügen → Ticket". The ticket and
 * the source must be visible (any status, never in the trash); a link that exists already is no error
 * (`already`). Area and circle are checked by the model hooks in the same transaction. Answers the
 * origins of the ticket.
 */
function add(e, id) {
  if (!ready(e.app)) {
    return unavailable(e);
  }
  var parsed = rules.parseAdd(e.requestInfo().body);
  if (parsed.code) {
    throw fail('source', parsed.code);
  }
  var actor = actorOf(e);
  var outcome = { already: false };
  e.app.runInTransaction(function (txApp) {
    var ticket = visibleTicket(e, txApp, id);
    if (ticket === null) {
      throw new NotFoundError(NOT_FOUND);
    }
    var source = visibleTicket(e, txApp, parsed.source);
    if (source === null) {
      throw fail('source', 'validation_ticket_source_missing');
    }
    if (findLink(txApp, ticket.id, source.id) !== null) {
      outcome.already = true;
      return;
    }
    link(txApp, ticket, source, actor);
  });
  var body = originsOf(e, e.app, findById(e.app, TICKETS, id));
  body.already = outcome.already;
  return answer(e, body);
}

/**
 * POST /api/byl/tickets/{id}/ticket-sources/{source}/remove: the ticket no longer stems from the
 * source (also one in the trash). A link that is gone already is no error (`already`). Answers the
 * origins of the ticket.
 */
function remove(e, id, sourceId) {
  if (!ready(e.app)) {
    return unavailable(e);
  }
  var actor = actorOf(e);
  var outcome = { already: false };
  e.app.runInTransaction(function (txApp) {
    var ticket = visibleTicket(e, txApp, id);
    if (ticket === null) {
      throw new NotFoundError(NOT_FOUND);
    }
    var record = findLink(txApp, ticket.id, typeof sourceId === 'string' ? sourceId : '');
    if (record === null) {
      outcome.already = true;
      return;
    }
    unlink(txApp, record, actor);
  });
  var body = originsOf(e, e.app, findById(e.app, TICKETS, id));
  body.already = outcome.already;
  return answer(e, body);
}

// A ticket of a household may only be created by a member (like the create rule of tickets).
function assertMayCreate(app, userId, household) {
  if (household === '') {
    return;
  }
  var members = app.findRecordsByFilter(
    'household_members',
    'household = {:household} && user = {:user}',
    '',
    1,
    0,
    { household: household, user: userId }
  );
  if (members.length === 0) {
    throw new ForbiddenError(AREA_FORBIDDEN);
  }
}

/**
 * POST /api/byl/tickets/{id}/follow-up { title, tags, charm, description }: "Folge-Ticket anlegen …".
 * A new open ticket of the kind "Aufgabe" in the area and the project of the source (none when that is
 * archived), with the tags, the charm and the description of the source as chosen, which stems from
 * the source: ticket and link in one transaction through the hooks (key, history "hat das Ticket
 * angelegt", "Quelle hinzugefügt", "Folge-Ticket"). Any visible ticket may be the source, done ones
 * included; one in the trash or out of sight is 404, an area the user may not create in 403. Answers
 * { id, key, title, project, source: { id, key } }.
 */
function followUp(e, id) {
  if (!ready(e.app)) {
    return unavailable(e);
  }
  var parsed = rules.parseFollowUp(e.requestInfo().body);
  if (!parsed.options) {
    throw fail(parsed.field, parsed.code);
  }
  var options = parsed.options;
  var actor = actorOf(e);
  var visible = visibleTicket(e, e.app, id);
  if (visible === null) {
    throw new NotFoundError(NOT_FOUND);
  }
  assertMayCreate(e.app, actor, visible.getString('household'));
  var ticketService = require(__hooks + '/lib/ticket-service.js');
  var charms = require(__hooks + '/lib/charms.js');
  var result = null;
  e.app.runInTransaction(function (txApp) {
    var source = findById(txApp, TICKETS, id);
    if (source === null || isTrashed(source)) {
      throw new NotFoundError(NOT_FOUND);
    }
    var projectId = source.getString('project');
    var project = projectId === '' ? null : findById(txApp, 'projects', projectId);
    var record = new Record(txApp.findCollectionByNameOrId(TICKETS));
    record.set('owner', actor);
    record.set('household', source.getString('household'));
    record.set('title', options.title);
    record.set('status', 'open');
    record.set('kind', 'task');
    record.set('blocks_parent', true);
    record.set('source', 'manual');
    record.set('project', rules.followUpProject(project === null ? '' : project.id, project !== null && project.getBool('archived')));
    if (options.tags) {
      record.set('tags', source.getStringSlice('tags'));
    }
    if (options.description) {
      record.set('description', source.getString('description'));
    }
    var charm = source.getString('charm');
    if (options.charm && charms.isCharmKey(charm)) {
      record.set('charm', charm);
    }
    record.set(ticketService.ACTOR_KEY, actor);
    txApp.save(record);
    link(txApp, record, source, actor);
    result = {
      id: record.id,
      key: record.getString('key'),
      title: record.getString('title'),
      project: record.getString('project'),
      source: { id: source.id, key: source.getString('key') }
    };
  });
  return answer(e, result);
}

module.exports = {
  ready: ready,
  checkLink: checkLink,
  checkCircle: checkCircle,
  link: link,
  unlink: unlink,
  linksOfTicket: linksOfTicket,
  otherEnd: otherEnd,
  copySources: copySources,
  liveSourceCount: liveSourceCount,
  origins: origins,
  add: add,
  remove: remove,
  followUp: followUp
};
