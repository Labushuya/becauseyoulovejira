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
'use strict';

var rules = require(__hooks + '/lib/duplicate-rules.js');
var errors = require(__hooks + '/lib/errors.js');
var trashRules = require(__hooks + '/lib/trash-rules.js');
var berlinTime = require(__hooks + '/lib/berlin-time.js');
var ticketService = require(__hooks + '/lib/ticket-service.js');
var inbox = require(__hooks + '/lib/inbox-service.js');

var TICKETS = 'tickets';
var INBOX = 'inbox_items';
var COMMENTS = 'comments';

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

// The duplicate itself. Its parent stays only with "Übergeordnetes Ticket" for a sub-ticket; the
// series never comes along (ADR-0045), nor a pin (the hook allows none on create).
function saveDuplicate(txApp, original, options, context) {
  var taken = rules.takenValues(takeableValues(original), options);
  var parent = options.parent ? original.getString('parent') : '';
  var fields = {
    owner: context.actor,
    household: context.household,
    title: options.title,
    description: taken.description,
    status: options.status,
    priority: taken.priority,
    due: taken.due,
    project: options.project,
    tags: taken.tags,
    parent: parent,
    blocks_parent: parent === '' ? true : original.getBool('blocks_parent')
  };
  if (context.copy) {
    fields.source_item = context.copy.id;
  } else {
    fields.source = 'manual';
  }
  return saveTicket(txApp, withColor(fields, taken.color), context.actor);
}

// New, open sub-tickets of the duplicate, one per sub-ticket of the original (also done ones), in
// the order they were created, with the same choice of fields; their project is the one of the
// duplicate, like for every new sub-ticket (ADR-0033 section 4, ADR-0034 section 6).
function saveSubtasks(txApp, original, duplicate, options, actor) {
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
    var saved = saveTicket(
      txApp,
      withColor(
        {
          owner: duplicate.getString('owner'),
          household: duplicate.getString('household'),
          title: child.getString('title'),
          description: taken.description,
          status: 'open',
          priority: taken.priority,
          due: taken.due,
          project: duplicate.getString('project'),
          tags: taken.tags,
          parent: duplicate.id,
          blocks_parent: child.getBool('blocks_parent'),
          source: 'manual'
        },
        taken.color
      ),
      actor
    );
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

/**
 * Route "Ticket duplizieren" (ADR-0045): the request body as described in
 * lib/duplicate-rules.js parseRequest. Only a ticket the request may see (else 404; the trash is
 * never visible), only in an area where the user may create tickets (else 403). Answers { id, key,
 * title, original: { id, key }, subtasks: [{ id, key }], comments, source } with the ID of the
 * copied source ('' without one).
 */
function duplicate(e, id) {
  var original = visibleOriginal(e, id);
  var parsed = rules.parseRequest(e.requestInfo().body);
  if (!parsed.options) {
    throw fail(parsed.field, parsed.code);
  }
  var options = parsed.options;
  var actor = actorOf(e);
  var household = original.getString('household');
  assertMayCreate(e.app, actor, household);
  if (options.source === 'copy') {
    var main = findById(e.app, INBOX, original.getString('source_item'));
    if (!main) {
      throw fail('source', 'validation_duplicate_source_missing');
    }
    if (!inbox.originalFileExists(e.app, main)) {
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
    if (options.source === 'copy') {
      var item = findById(txApp, INBOX, current.getString('source_item'));
      if (!item) {
        throw fail('source', 'validation_duplicate_source_missing');
      }
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
    var duplicated = saveDuplicate(txApp, current, options, { actor: actor, household: household, copy: copy });
    var subtasks = saveSubtasks(txApp, current, duplicated, options, actor);
    var comments = options.comments ? saveComments(txApp, current, duplicated) : { count: 0, pinned: '' };
    pinCopy(txApp, duplicated, comments.pinned, actor);
    saveHistory(txApp, duplicated.id, rules.historyValue('from', current.id, key), actor);
    saveHistory(txApp, current.id, rules.historyValue('to', duplicated.id, duplicated.getString('key')), actor);
    result = {
      id: duplicated.id,
      key: duplicated.getString('key'),
      title: duplicated.getString('title'),
      original: { id: current.id, key: key },
      subtasks: subtasks,
      comments: comments.count,
      source: copy ? copy.id : ''
    };
  });
  return result;
}

module.exports = {
  duplicate: duplicate
};
