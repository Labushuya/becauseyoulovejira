// "Ticket duplizieren" (ADR-0045), the database part. CommonJS module, ES5 only, Goja runtime
// only. The pure decisions are in lib/duplicate-rules.js.
//
// The route POST /api/byl/tickets/{id}/duplicate creates the duplicate, its new sub-tickets, the
// copied comments and the copy of the main source in one transaction of the route
// (e.app.runInTransaction, like the routes of the trash): every record is saved with txApp, so the
// hooks of tickets, comments and inbox_items run inside it (their own inTransaction reuses it) and
// key, scope, checks, conversion of the copied source and the history happen as for any new
// ticket. All checks of the request run before the first write; a failure of any write rolls back
// everything. Realtime events of the new records go out after the commit, as for saves of the
// Record API.
//
// Since MV-2 (ADR-0045, addendum MV-2) the duplicate may go into the other area of the account (`to`):
// into the household only an own private ticket, into the private area every member who sees the
// ticket of the household. Its project is one of the target or none, its tags are mapped by name (a
// missing one is created there), it is a top-level ticket, and no source comes along (entries of the
// inbox stay with the original, source tickets never cross the border). The original stays as it is.
// GET /api/byl/tickets/{id}/duplicate-target names the projects and the tags of the target first.
'use strict';

var rules = require(__hooks + '/lib/duplicate-rules.js');
var errors = require(__hooks + '/lib/errors.js');
var trashRules = require(__hooks + '/lib/trash-rules.js');
var berlinTime = require(__hooks + '/lib/berlin-time.js');
var ticketService = require(__hooks + '/lib/ticket-service.js');
var inbox = require(__hooks + '/lib/inbox-service.js');
var charms = require(__hooks + '/lib/charms.js');
var dayPlanRules = require(__hooks + '/lib/day-plan-rules.js');
var ticketKey = require(__hooks + '/lib/ticket-key.js');

var TICKETS = 'tickets';
var INBOX = 'inbox_items';
var COMMENTS = 'comments';
var PROJECTS = 'projects';
var PRIVATE_NAME = 'Privat';

// Order of creation: equal timestamps keep the order of the rows (like the comments of the SPA).
var CREATION_ORDER = 'created,@rowid';

var AREA_FORBIDDEN = 'In diesem Bereich darfst du keine Tickets anlegen.';

function fail(field, code) {
  return errors.fieldFailure(field, code, rules.MESSAGES[code]);
}

// Returns the record or null; real database errors still throw.
function findById(app, collection, id) {
  if (id === '') {
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

// The values of a ticket that a copy may take over; the color reads as '' before its migration
// (ADR-0052).
function takeableValues(ticket) {
  return {
    description: ticket.getString('description'),
    priority: ticket.getString('priority'),
    tags: stringList(ticket.getStringSlice('tags')),
    due: ticket.getString('due'),
    color: ticket.getString('color')
  };
}

// Sets the own color of a copy (ADR-0052); none means "wie Projekt", so nothing is set then.
function withColor(fields, color) {
  if (color !== '') {
    fields.color = color;
  }
  return fields;
}

// A copy keeps the charm of its ticket (ADR-0062), always, without a switch; every sub-ticket of the
// copy keeps its own. Before the migration the field reads as '', and a key the catalog no longer
// knows is left out, so it never stops the copy.
function withCharm(fields, ticket) {
  var charm = ticket.getString('charm');
  if (charms.isCharmKey(charm)) {
    fields.charm = charm;
  }
  return fields;
}

// A copy keeps the kind of its ticket (ADR-0065, PL-1) like its charm: always, without a switch, an
// ongoing project stays one, and every sub-ticket of the copy keeps its own. Before the migration of
// the day plan the field reads as '' and nothing is set; the model hook makes the copy a task then.
function withKind(fields, ticket) {
  var kind = ticket.getString('kind');
  if (dayPlanRules.KINDS.indexOf(kind) !== -1) {
    fields.kind = kind;
  }
  return fields;
}

// The signed-in app user of the request (the route requires one).
function actorOf(e) {
  return e.auth && e.auth.collection().name === 'users' ? e.auth.id : '';
}

// The original as the request may see it (view rule of tickets, which hides the trash since its
// migration); a ticket in the trash counts as missing also before that migration.
function visibleOriginal(e, id) {
  var ticket = findById(e.app, TICKETS, id);
  var collection = e.app.findCollectionByNameOrId(TICKETS);
  if (!ticket || isTrashed(ticket) || !e.app.canAccessRecord(ticket, e.requestInfo(), collection.viewRule)) {
    throw new NotFoundError('Ticket nicht gefunden.');
  }
  return ticket;
}

// The create rule of tickets for the duplicate: the acting user owns it, and a ticket of a
// household may only be created by a member. Since 1790203900 an owner who left the household no
// longer sees the original either (404 before this check, ADR-0058 §5); the check stays as the
// create rule of the Record API.
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

// Saves a new ticket through the ticket hooks (scope, key, checks, "created" in the history).
function saveTicket(txApp, fields, actor) {
  var record = new Record(txApp.findCollectionByNameOrId(TICKETS));
  for (var name in fields) {
    if (Object.prototype.hasOwnProperty.call(fields, name)) {
      record.set(name, fields[name]);
    }
  }
  record.set(ticketService.ACTOR_KEY, actor);
  txApp.save(record);
  return record;
}

function saveHistory(txApp, ticketId, value, actor) {
  var entry = new Record(txApp.findCollectionByNameOrId('ticket_history'));
  entry.set('ticket', ticketId);
  entry.set('field', rules.HISTORY_FIELD);
  entry.set('old_value', '');
  entry.set('new_value', value);
  entry.set('user', actor);
  txApp.save(entry);
}

// The tags of a copy in another area: mapped by name, each once (MV-2); in the same area as they are.
function tagsFor(tags, mapTag) {
  if (mapTag === null) {
    return tags;
  }
  var mapped = [];
  for (var i = 0; i < tags.length; i++) {
    var id = mapTag(tags[i]);
    if (id !== '' && mapped.indexOf(id) === -1) {
      mapped.push(id);
    }
  }
  return mapped;
}

// The duplicate itself. Its parent stays only with "Übergeordnetes Ticket" for a sub-ticket, never in
// another area (MV-2: the parent stays behind); the series never comes along (ADR-0045), nor a pin
// (the hook allows none on create).
function saveDuplicate(txApp, original, options, context) {
  var taken = rules.takenValues(takeableValues(original), options);
  var parent = options.parent && !context.crossing ? original.getString('parent') : '';
  var fields = {
    owner: context.actor,
    household: context.household,
    title: options.title,
    description: taken.description,
    status: options.status,
    priority: taken.priority,
    due: taken.due,
    project: options.project,
    tags: tagsFor(taken.tags, context.mapTag),
    parent: parent,
    blocks_parent: parent === '' ? true : original.getBool('blocks_parent')
  };
  if (context.copy) {
    fields.source_item = context.copy.id;
  } else {
    fields.source = 'manual';
  }
  var copied = withKind(withCharm(withColor(fields, taken.color), original), original);
  return saveTicket(txApp, copied, context.actor);
}

// New, open sub-tickets of the duplicate, one per sub-ticket of the original (also done ones), in
// the order they were created, with the same choice of fields; their project is the one of the
// duplicate, like for every new sub-ticket (ADR-0033 section 4, ADR-0034 section 6). In another area
// their tags are mapped like those of the duplicate (`mapTag`, MV-2).
function saveSubtasks(txApp, original, duplicate, options, actor, mapTag) {
  var created = [];
  if (!options.subtasks || original.getString('parent') !== '') {
    return created;
  }
  var children = txApp.findRecordsByFilter(TICKETS, 'parent = {:id}', CREATION_ORDER, 0, 0, { id: original.id });
  for (var i = 0; i < children.length; i++) {
    var child = children[i];
    if (isTrashed(child)) {
      continue;
    }
    var taken = rules.takenValues(takeableValues(child), options);
    var fields = {
      owner: duplicate.getString('owner'),
      household: duplicate.getString('household'),
      title: child.getString('title'),
      description: taken.description,
      status: 'open',
      priority: taken.priority,
      due: taken.due,
      project: duplicate.getString('project'),
      tags: tagsFor(taken.tags, mapTag),
      parent: duplicate.id,
      blocks_parent: child.getBool('blocks_parent'),
      source: 'manual'
    };
    var copied = withKind(withCharm(withColor(fields, taken.color), child), child);
    var saved = saveTicket(txApp, copied, actor);
    created.push({ id: saved.id, key: saved.getString('key') });
  }
  return created;
}

// Copies of the comments with the note "Kopiert aus HAUS-12": author and time stay those of the
// original comment (it is their text, and the order stays), so does its author's right to change
// it. Returns { count, pinned } with the copy of the pinned comment ('' without one).
function saveComments(txApp, original, duplicate) {
  var outcome = { count: 0, pinned: '' };
  var comments = txApp.findRecordsByFilter(COMMENTS, 'ticket = {:id}', CREATION_ORDER, 0, 0, { id: original.id });
  var collection = txApp.findCollectionByNameOrId(COMMENTS);
  var pinned = original.getString('pinned_comment');
  for (var i = 0; i < comments.length; i++) {
    var comment = comments[i];
    var copy = new Record(collection);
    copy.setRaw('created', comment.getString('created'));
    copy.setRaw('updated', comment.getString('updated'));
    copy.set('ticket', duplicate.id);
    copy.set('author', comment.getString('author'));
    copy.set(
      'body',
      rules.copiedCommentBody(comment.getString('body'), original.getString('key'), original.id, rules.COMMENT_MAX)
    );
    txApp.save(copy);
    outcome.count += 1;
    if (comment.id === pinned) {
      outcome.pinned = copy.id;
    }
  }
  return outcome;
}

// The copy of the pinned comment is pinned on the duplicate, through the ticket hooks (history
// "Kommentar angepinnt" with the acting user); a new ticket takes no pin on create (ADR-0044).
function pinCopy(txApp, duplicate, commentId, actor) {
  if (commentId === '') {
    return;
  }
  var ticket = findById(txApp, TICKETS, duplicate.id);
  ticket.set('pinned_comment', commentId);
  ticket.set(ticketService.ACTOR_KEY, actor);
  txApp.save(ticket);
}

// The area of the original as the history and the answer name it.
function areaOf(household) {
  return household === '' ? 'private' : 'household';
}

/**
 * The area of the duplicate (ADR-0045, addendum MV-2): that of the original without `to` (or with its
 * own), else the other one of the account: { crossing, household, scope, to, name }. Into the
 * household only an own private ticket of a member, into the private area every member who sees the
 * ticket; refusals at the field `to`.
 */
function targetArea(app, original, to, actor) {
  var household = original.getString('household');
  if (!rules.crossesArea(household, to)) {
    return { crossing: false, household: household, scope: original.getString('scope'), to: areaOf(household), name: '' };
  }
  var code = rules.areaViolation(to, { owner: original.getString('owner'), household: household }, actor);
  if (code !== '') {
    throw fail('to', code);
  }
  if (to === 'private') {
    return { crossing: true, household: '', scope: ticketKey.scopeOf(actor, ''), to: 'private', name: PRIVATE_NAME };
  }
  var mine = require(__hooks + '/lib/area-move-service.js').householdOf(app, actor);
  if (mine === null) {
    throw fail('to', 'validation_duplicate_no_household');
  }
  return { crossing: true, household: mine.id, scope: ticketKey.scopeOf('', mine.id), to: 'household', name: mine.name };
}

// The project of a duplicate in another area (MV-2): '' or an active project of the target, checked
// before the first write (the ticket hook would refuse it as well, but only while writing).
function assertTargetProject(app, projectId, area) {
  if (projectId === '') {
    return;
  }
  var project = findById(app, PROJECTS, projectId);
  if (project === null || project.getString('scope') !== area.scope || project.getBool('archived')) {
    throw fail('project', 'validation_duplicate_project_area');
  }
}

// The active projects of an area with their parent ID (sub projects, ADR-0034), by name; the tab
// knows only those of its own area.
function projectsIn(app, scope) {
  var found = app.findRecordsByFilter(PROJECTS, 'scope = {:scope} && archived = false', 'name,id', 0, 0, { scope: scope });
  var list = [];
  for (var i = 0; i < found.length; i++) {
    list.push({
      id: found[i].id,
      code: found[i].getString('code'),
      name: found[i].getString('name'),
      parent: found[i].getString('parent')
    });
  }
  return list;
}

/**
 * GET /api/byl/tickets/{id}/duplicate-target?to=household|private (ADR-0045, addendum MV-2): what the
 * question "Duplizieren" needs for the other area before anything is written. Only for a ticket the
 * request may see (else 404) and with the same checks as the duplicate itself (`to` at the field).
 * Answers { to, scope, name, projects: [{ id, code, name, parent }], tags: { reused, created } }: the
 * active projects of the target and the tags of the original by name there.
 */
function target(e, id) {
  var original = visibleOriginal(e, id);
  var to = String(e.request.url.query().get('to') || '');
  if (rules.AREAS.indexOf(to) === -1) {
    throw fail('to', 'validation_duplicate_area');
  }
  var actor = actorOf(e);
  var area = targetArea(e.app, original, to, actor);
  assertMayCreate(e.app, actor, area.household);
  var tags = stringList(original.getStringSlice('tags'));
  return {
    to: area.to,
    scope: area.scope,
    name: area.crossing ? area.name : '',
    projects: projectsIn(e.app, area.scope),
    tags: area.crossing ? require(__hooks + '/lib/area-move-service.js').tagPreviewIn(e.app, tags, area.scope) : { reused: [], created: [] }
  };
}

/**
 * Route "Ticket duplizieren" (ADR-0045): the request body as described in
 * lib/duplicate-rules.js parseRequest. Only a ticket the request may see (else 404; the trash is
 * never visible), only in an area where the user may create tickets (else 403). Answers { id, key,
 * title, original: { id, key }, subtasks: [{ id, key }], comments, source, ticket_sources, scope } with
 * the ID of the copied source ('' without one), the number of source tickets the duplicate stems from
 * like the original (QT-1, ADR-0067; only with "Kopie der Herkunft übernehmen") and the area of the
 * duplicate (MV-2: with `to` the other area of the account, see targetArea).
 */
function duplicate(e, id) {
  var original = visibleOriginal(e, id);
  var parsed = rules.parseRequest(e.requestInfo().body);
  if (!parsed.options) {
    throw fail(parsed.field, parsed.code);
  }
  var options = parsed.options;
  var actor = actorOf(e);
  var area = targetArea(e.app, original, options.to, actor);
  var household = area.household;
  assertMayCreate(e.app, actor, household);
  if (area.crossing) {
    if (options.source === 'copy') {
      throw fail('source', 'validation_duplicate_source_area');
    }
    assertTargetProject(e.app, options.project, area);
  }
  // "Kopie der Herkunft übernehmen" copies the main source and, since QT-1 (ADR-0067), takes the
  // source tickets of the original over as well; it needs at least one of them.
  var ticketSources = require(__hooks + '/lib/ticket-source-service.js');
  if (options.source === 'copy') {
    var main = findById(e.app, INBOX, original.getString('source_item'));
    if (!main && ticketSources.liveSourceCount(e.app, original.id) === 0) {
      throw fail('source', 'validation_duplicate_source_missing');
    }
    if (main && !inbox.originalFileExists(e.app, main)) {
      throw fail('source', 'validation_duplicate_source_file');
    }
  }

  var result = null;
  e.app.runInTransaction(function (txApp) {
    var current = findById(txApp, TICKETS, original.id);
    if (!current || isTrashed(current)) {
      throw new NotFoundError('Ticket nicht gefunden.');
    }
    var key = current.getString('key');
    var copy = null;
    var item = options.source === 'copy' ? findById(txApp, INBOX, current.getString('source_item')) : null;
    if (options.source === 'copy' && !item && ticketSources.liveSourceCount(txApp, current.id) === 0) {
      throw fail('source', 'validation_duplicate_source_missing');
    }
    if (item) {
      copy = inbox.copySource(txApp, item, {
        owner: actor,
        household: household,
        meta: rules.copyMeta(inbox.metaOf(item), {
          item: item.id,
          ticket: current.id,
          key: key,
          at: berlinTime.toPocketBaseDate(Date.now())
        })
      });
    }
    // Tags of another area by name, a missing one created there by the actor (MV-2).
    var mapTag = area.crossing ? require(__hooks + '/lib/area-move-service.js').tagMapperIn(txApp, area.scope, household, actor) : null;
    var duplicated = saveDuplicate(txApp, current, options, {
      actor: actor,
      household: household,
      copy: copy,
      crossing: area.crossing,
      mapTag: mapTag
    });
    var subtasks = saveSubtasks(txApp, current, duplicated, options, actor, mapTag);
    var comments = options.comments ? saveComments(txApp, current, duplicated) : { count: 0, pinned: '' };
    pinCopy(txApp, duplicated, comments.pinned, actor);
    // Across the border both entries name the area of the other ticket and only its key.
    saveHistory(txApp, duplicated.id, rules.historyValue('from', current.id, key, area.crossing ? areaOf(current.getString('household')) : ''), actor);
    saveHistory(txApp, current.id, rules.historyValue('to', duplicated.id, duplicated.getString('key'), area.crossing ? area.to : ''), actor);
    var linked = options.source === 'copy' ? ticketSources.copySources(txApp, current, duplicated, actor) : 0;
    result = {
      id: duplicated.id,
      key: duplicated.getString('key'),
      title: duplicated.getString('title'),
      original: { id: current.id, key: key },
      subtasks: subtasks,
      comments: comments.count,
      source: copy ? copy.id : '',
      ticket_sources: linked,
      scope: duplicated.getString('scope')
    };
  });
  return result;
}

module.exports = {
  duplicate: duplicate,
  target: target
};
