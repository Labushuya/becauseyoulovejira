// The one way into the inbox (ADR-0014, E4 plan section 3): every channel creates inbox_items
// through this module, directly in a hook or through the Record API, whose hook uses it too.
// CommonJS module, ES5 only, Goja runtime only. Every function takes the app of the running
// transaction (`txApp`) and never uses `$app`.
'use strict';

var ticketKey = require(__hooks + '/lib/ticket-key.js');
var errors = require(__hooks + '/lib/errors.js');
var source = require(__hooks + '/lib/source.js');
var rules = require(__hooks + '/lib/inbox-rules.js');
var fingerprints = require(__hooks + '/lib/inbox-fingerprint.js');
var trashRules = require(__hooks + '/lib/trash-rules.js');
var targetRules = require(__hooks + '/lib/target-project-rules.js');
var targets = require(__hooks + '/lib/target-project-service.js');

var INBOX = 'inbox_items';

// Set once on create; a client update that changes them is rejected (ADR-0014 section 1). The
// target project is the one the entry got when it came in (ADR-0049 §2): only the server sets it.
var IMMUTABLE_FIELDS = ['channel', 'source_ref', 'source_date', 'fingerprint', 'original', 'target_project'];

var MESSAGES = {
  validation_inbox_duplicate: 'Dieser Eintrag ist schon vorhanden.',
  validation_inbox_immutable: 'Dieses Feld lässt sich nach dem Eingang nicht mehr ändern.',
  validation_inbox_transition: 'Dieser Zustandswechsel ist nicht erlaubt.',
  validation_inbox_item_handled: 'Dieser Eintrag wurde schon bearbeitet.',
  validation_inbox_ticket_required: 'Zum Zuordnen fehlt das Ticket.',
  validation_inbox_primary_source:
    'Die Hauptquelle bleibt bei dem Ticket, das aus ihr entstanden ist; sie lässt sich weder lösen noch verschieben.',
  validation_inbox_item_linked: 'Dieser Eintrag ist die Quelle eines Tickets und lässt sich nicht löschen.',
  validation_inbox_item_delete:
    'Eingangseinträge lassen sich nicht löschen, nur verwerfen. So bleibt die Sperre gegen erneutes Eintreffen erhalten.',
  validation_invalid_url: 'Nur http- und https-Adressen.',
  validation_required: 'Pflichtfeld.',
  validation_scope_mismatch: 'Verknüpfter Datensatz nicht gefunden oder in einem anderen Bereich.',
  validation_source_not_allowed: 'Diese Quelle lässt sich beim Anlegen nicht direkt setzen.'
};

// Transient record key for the acting user of a link or release, as for tickets
// (ticket-service.js, E1 plan OF-4): PocketBase neither stores nor exports unknown keys, and a
// client cannot set a field name with "@".
var ACTOR_KEY = '@actor';

// History field of linking and releasing a source (ADR-0031 section 2).
var SOURCE_LINK_FIELD = 'source_link';

// Transient record key of an item the trash gives back to the inbox or links again (ADR-0037):
// such a change writes no "source_link" entry, the ticket records "trash" instead.
var SILENT_KEY = '@trash_silent';

// Transient record key of the copy of a source for a duplicate ticket (ADR-0045): the fingerprint
// of the original entry, from which the copy derives a key of its own. Only the server sets it; a
// client cannot send a field name with "@".
var COPY_OF_KEY = '@copy_of';

// The ticket of an item as a duplicate or a lookup names it: a ticket in the trash counts as
// none (ADR-0037 §3), so no message names a key that cannot be opened.
function visibleTicket(txApp, ticketId) {
  var ticket = ticketId === '' ? null : findById(txApp, 'tickets', ticketId);
  return ticket && !trashRules.isTrashed(ticket.getString('deleted_at')) ? ticket : null;
}

function fail(field, code, params) {
  return errors.fieldFailure(field, code, MESSAGES[code], params);
}

// Returns the record or null; real database errors still throw.
function findById(txApp, collection, id) {
  var found = txApp.findRecordsByFilter(collection, 'id = {:id}', '', 1, 0, { id: id });
  return found.length > 0 ? found[0] : null;
}

// Whether a ticket came from the item (tickets.source_item, the main source; ADR-0031 section 1).
function isPrimarySource(txApp, itemId) {
  return txApp.findRecordsByFilter('tickets', 'source_item = {:id}', '', 1, 0, { id: itemId }).length > 0;
}

// Request hook: remembers the signed-in app user for the history of a link or release.
function rememberActor(e) {
  if (e.auth && e.auth.collection().name === 'users') {
    e.record.set(ACTOR_KEY, e.auth.id);
  }
}

function applyScope(record) {
  var scope = ticketKey.scopeOf(record.getString('owner'), record.getString('household'));
  record.set('scope', scope);
  return scope;
}

// source_meta as a plain object ({} when empty or not an object).
function metaOf(record) {
  var raw = record.getString('source_meta');
  if (raw === '' || raw === 'null') {
    return {};
  }
  try {
    var value = JSON.parse(raw);
    return value && typeof value === 'object' ? value : {};
  } catch (err) {
    return {};
  }
}

// Throws the duplicate result with state, item and ticket of the existing entry as params, so
// every way into the inbox can report "schon im Eingang / verworfen / Ticket HAUS-12".
function assertNoDuplicate(txApp, scope, fingerprint) {
  var existing = findByFingerprint(txApp, scope, fingerprint);
  if (!existing) {
    return;
  }
  var state = existing.getString('state');
  var ticket = visibleTicket(txApp, existing.getString('ticket'));
  var key = ticket ? ticket.getString('key') : '';
  throw errors.fieldFailure('fingerprint', 'validation_inbox_duplicate', rules.duplicateMessage(state, key), {
    state: state,
    item: existing.id,
    ticket: ticket ? ticket.id : '',
    ticketKey: key
  });
}

// Scope, cleaned title and body, the state "new" and the fingerprint of a new record; rejects
// links other than http(s). Client values for scope, fingerprint, state, ticket and handled_at
// are always overwritten. Returns { scope, fingerprint } (fingerprint '' for an unknown channel,
// which the select field rejects with its own message during validation).
function prepareRecord(record) {
  var scope = applyScope(record);
  record.set('title', rules.normalizeTitle(record.getString('title')));
  record.set('body', rules.normalizeBody(record.getString('body')));
  record.set('state', 'new');
  record.set('ticket', '');
  record.set('handled_at', '');

  var url = record.getString('source_url');
  if (!rules.isAllowedSourceUrl(url)) {
    throw fail('source_url', 'validation_invalid_url');
  }
  var channel = record.getString('channel');
  if (!source.isChannel(channel)) {
    record.set('fingerprint', '');
    return { scope: scope, fingerprint: '' };
  }
  // The copy of a source for a duplicate ticket (ADR-0045) gets a key of its own, derived from the
  // original entry; the family key of its channel stays with the original.
  var copyOf = record.get(COPY_OF_KEY);
  if (copyOf) {
    var copyFingerprint = String($security.sha256(fingerprints.copyFingerprintKey(String(copyOf), $security.randomString(24))));
    record.set('fingerprint', copyFingerprint);
    return { scope: scope, fingerprint: copyFingerprint };
  }
  var result = fingerprints.fingerprint(
    {
      channel: channel,
      title: record.getString('title'),
      body: record.getString('body'),
      source_url: url,
      source_ref: record.getString('source_ref'),
      source_date: record.getString('source_date'),
      meta: metaOf(record)
    },
    function (key) {
      return $security.sha256(key);
    },
    $security.randomString(24)
  );
  if (result.fingerprint === '') {
    throw fail(result.missing, 'validation_required');
  }
  record.set('fingerprint', result.fingerprint);
  return { scope: scope, fingerprint: result.fingerprint };
}

// onRecordCreate before e.next(): prepareRecord plus the duplicate check in the scope, then the
// target project of the way the entry came (ADR-0049 §2). Every way into the inbox saves here: the
// Record API of the browser and inbox-service.ingest of the server.
function prepareCreate(txApp, record) {
  var prepared = prepareRecord(record);
  if (prepared.fingerprint !== '') {
    assertNoDuplicate(txApp, prepared.scope, prepared.fingerprint);
  }
  targets.applyToNewItem(txApp, record);
}

function findByFingerprint(txApp, scope, fingerprint) {
  var found = txApp.findRecordsByFilter(
    INBOX,
    'scope = {:scope} && fingerprint = {:fingerprint}',
    '',
    1,
    0,
    { scope: scope, fingerprint: fingerprint }
  );
  return found.length > 0 ? found[0] : null;
}

/**
 * Creates a private inbox item of `owner` from a draft of a channel that runs in the server (the
 * .ics route, the calendar feed, the Telegram bot, the mail helper). The draft has the fields of
 * inbox_items: { channel, kind, title, body, source_url, source_ref, source_date, meta, original,
 * originalName, originalFile, connection }; `original` is the text of the original file,
 * `originalFile` an uploaded file (the mail helper), taken as it is.
 * Returns { kind: 'created', item } or { kind: 'duplicate', item } with the existing record, so a
 * channel counts duplicates instead of failing (ADR-0014 section 3). Validation errors throw.
 * Runs in its own transaction; the record hook repeats the check as a safety net.
 */
function ingest(app, owner, draft) {
  var outcome = null;
  app.runInTransaction(function (txApp) {
    var record = draftRecord(txApp, owner, draft);
    var prepared = prepareRecord(record);
    var existing = prepared.fingerprint === '' ? null : findByFingerprint(txApp, prepared.scope, prepared.fingerprint);
    if (existing) {
      outcome = { kind: 'duplicate', item: existing };
      return;
    }
    if (draft.originalFile) {
      record.set('original', draft.originalFile);
    } else if (draft.original) {
      record.set('original', $filesystem.fileFromBytes(draft.original, draft.originalName || 'original.txt'));
    }
    txApp.save(record);
    outcome = { kind: 'created', item: record };
  });
  return outcome;
}

// An unsaved private record of `owner` with the fields of a draft (see ingest).
function draftRecord(app, owner, draft) {
  var record = new Record(app.findCollectionByNameOrId(INBOX));
  record.set('owner', owner);
  record.set('household', '');
  record.set('channel', draft.channel);
  record.set('kind', draft.kind);
  record.set('title', draft.title);
  record.set('body', draft.body || '');
  record.set('source_url', draft.source_url || '');
  record.set('source_ref', draft.source_ref || '');
  record.set('source_date', draft.source_date || '');
  record.set('source_meta', draft.meta || {});
  if (draft.connection) {
    record.set('connection', draft.connection);
  }
  return record;
}

/**
 * Whether a draft is in the private inbox of `owner` already, without saving anything (selection
 * views, E4 plan package 21): { state, item, ticketKey, message } of the existing entry, or null.
 * A draft the hook would refuse (e.g. a link other than http(s)) counts as not there; saving it
 * reports the reason.
 */
function lookup(app, owner, draft) {
  var record = draftRecord(app, owner, draft);
  var prepared;
  try {
    prepared = prepareRecord(record);
  } catch (err) {
    return null;
  }
  var existing = prepared.fingerprint === '' ? null : findByFingerprint(app, prepared.scope, prepared.fingerprint);
  if (!existing) {
    return null;
  }
  var state = existing.getString('state');
  var ticket = visibleTicket(app, existing.getString('ticket'));
  var key = ticket ? ticket.getString('key') : '';
  return { state: state, item: existing.id, ticketKey: key, message: rules.duplicateMessage(state, key) };
}

// onRecordUpdateRequest: what a client may change (ADR-0014 section 1). Internal saves (the
// ticket hook converting an item, PocketBase clearing `ticket` when the ticket is deleted) do
// not pass through here.
function guardClientUpdate(record) {
  var original = record.original();
  for (var i = 0; i < IMMUTABLE_FIELDS.length; i++) {
    var field = IMMUTABLE_FIELDS[i];
    if (record.getString(field) !== original.getString(field)) {
      throw fail(field, 'validation_inbox_immutable');
    }
  }
  var violation = rules.transitionViolation(
    { state: original.getString('state'), ticket: original.getString('ticket') },
    { state: record.getString('state'), ticket: record.getString('ticket') }
  );
  if (violation) {
    throw fail(violation.field, violation.code);
  }
}

// onRecordUpdate before e.next(), for client and internal saves: scope, handled_at, a converted
// item must point to a ticket of its scope when it gets one (a missing, a foreign ID and a ticket
// in the trash give the same message), and the main source of a ticket is never released nor moved to another ticket
// (ADR-0031 section 2 and its addendum). Returns the change for recordLinkChange():
// { kind: 'link' | 'release' | 'move' | '', ticket, from }.
function prepareUpdate(txApp, record) {
  var original = record.original();
  var scope = applyScope(record);
  var before = original.getString('state');
  var after = record.getString('state');
  var ticketBefore = original.getString('ticket');
  var ticketAfter = record.getString('ticket');

  if (after === 'converted' && (before !== 'converted' || (ticketAfter !== ticketBefore && ticketAfter !== ''))) {
    var ticket = visibleTicket(txApp, ticketAfter);
    if (!ticket || ticket.getString('scope') !== scope) {
      throw fail('ticket', 'validation_scope_mismatch');
    }
  }
  var kind = rules.linkChange({ state: before, ticket: ticketBefore }, { state: after, ticket: ticketAfter });
  if ((kind === 'release' || kind === 'move') && isPrimarySource(txApp, record.id)) {
    throw fail(kind === 'release' ? 'state' : 'ticket', 'validation_inbox_primary_source');
  }
  // An item that belongs to a ticket again no longer needs the note of an earlier, deleted one.
  if (after === 'converted' && ticketAfter !== '') {
    var cleared = rules.withoutDeletedTicket(metaOf(record));
    if (cleared) {
      record.set('source_meta', cleared);
    }
  }
  // Only PocketBase empties the target project, when the project is deleted (ADR-0049 §2: clients
  // cannot change it, the server never clears it); the entry notes that it had one.
  if (original.getString(targetRules.FIELD) !== '' && record.getString(targetRules.FIELD) === '') {
    record.set('source_meta', targetRules.withTargetGone(metaOf(record)));
  }

  var action = rules.handledAtAction(before, after);
  if (action === 'set') {
    record.set('handled_at', new Date().toISOString());
  } else if (action === 'clear') {
    record.set('handled_at', '');
  } else {
    record.set('handled_at', original.getString('handled_at'));
  }
  return {
    kind: kind,
    ticket: kind === 'release' ? ticketBefore : ticketAfter,
    from: kind === 'move' ? ticketBefore : ''
  };
}

function saveSourceLinkEntry(txApp, record, ticketId, oldValue, newValue) {
  var entry = new Record(txApp.findCollectionByNameOrId('ticket_history'));
  entry.set('ticket', ticketId);
  entry.set('field', SOURCE_LINK_FIELD);
  entry.set('old_value', oldValue);
  entry.set('new_value', newValue);
  var actor = record.get(ACTOR_KEY);
  entry.set('user', actor ? String(actor) : '');
  txApp.save(entry);
}

// onRecordUpdate after e.next(), in the same transaction: linking and releasing leave an entry
// "source_link" in the history of the ticket (ADR-0031 section 2), with the acting user. Moving
// leaves one in both tickets: "moved to" in the old one (old value), "moved from" in the new one
// (new value). Converting writes none (the ticket records its creation), nor does releasing an
// item whose ticket is gone, nor a change of the trash (SILENT_KEY).
function recordLinkChange(txApp, record, change) {
  if (!change || change.kind === '' || change.ticket === '' || record.get(SILENT_KEY)) {
    return;
  }
  var ticket = findById(txApp, 'tickets', change.ticket);
  if (!ticket || (change.kind === 'link' && ticket.getString('source_item') === record.id)) {
    return;
  }
  var item = { id: record.id, channel: record.getString('channel'), title: record.getString('title') };
  if (change.kind === 'move') {
    var from = findById(txApp, 'tickets', change.from);
    if (from) {
      var movedTo = rules.sourceLinkValue(item, { direction: 'to', ticket: ticket.id, key: ticket.getString('key') });
      saveSourceLinkEntry(txApp, record, from.id, movedTo, '');
    }
    var movedFrom = rules.sourceLinkValue(item, {
      direction: 'from',
      ticket: change.from,
      key: from ? from.getString('key') : ''
    });
    saveSourceLinkEntry(txApp, record, ticket.id, '', movedFrom);
    return;
  }
  var value = rules.sourceLinkValue(item);
  saveSourceLinkEntry(
    txApp,
    record,
    ticket.id,
    change.kind === 'release' ? value : '',
    change.kind === 'link' ? value : ''
  );
}

// onRecordDeleteRequest (ADR-0014, addendum of 2026-10-01; ADR-0031 section 3): no inbox item is
// deleted through the API, also not by a superuser in the admin UI and also before the migration
// 1790202800. Deleting would take its fingerprint, and the same object would come in again; the
// app discards instead (tombstone). Always throws: the source of a ticket (a linked item or the
// main source) names that reason, every other item the general one. Deletes of the server itself
// ($app.delete, the trash, migrations) do not pass the request hook.
function refuseDelete(app, record) {
  if (record.getString('ticket') !== '' || isPrimarySource(app, record.id)) {
    throw fail('ticket', 'validation_inbox_item_linked');
  }
  throw fail('state', 'validation_inbox_item_delete');
}

// Ticket create, before e.next() (ADR-0014 section 2): with `source_item` the item must exist in
// the scope of the ticket and still be new; the ticket then takes its channel as source. Without
// it a client may only send an empty source, "manual" or "quick". Returns the item or null.
// Before the migrations 17902012xx the fields do not exist and read as '', so nothing happens.
function prepareConversion(txApp, ticket, scope) {
  var itemId = ticket.getString('source_item');
  if (itemId === '') {
    if (!source.isClientTicketSource(ticket.getString('source'))) {
      throw fail('source', 'validation_source_not_allowed');
    }
    return null;
  }
  var item = findById(txApp, INBOX, itemId);
  if (!item || item.getString('scope') !== scope) {
    throw fail('source_item', 'validation_scope_mismatch');
  }
  if (item.getString('state') !== 'new') {
    throw fail('source_item', 'validation_inbox_item_handled');
  }
  ticket.set('source', item.getString('channel'));
  return item;
}

// Ticket create, after e.next(): marks the item as converted in the same transaction, so ticket,
// key, history and item change are committed together or not at all.
function completeConversion(txApp, item, ticket) {
  if (!item) {
    return;
  }
  item.set('state', 'converted');
  item.set('ticket', ticket.id);
  txApp.save(item);
}

// Transient record key of a ticket for the handling of its sources when it is deleted ('inbox'
// or 'discard'); set by the route "Ticket löschen mit Quellenbehandlung", missing for every other
// way to delete, which then means 'inbox' (ADR-0031, addendum B).
var SOURCE_HANDLING_KEY = '@source_handling';

// Ticket delete, before e.next(): the IDs of its sources (items with `ticket = <id>` and the main
// source), so they can be settled after PocketBase has cleared the relation. [] before the inbox
// exists.
function sourcesOfDeletedTicket(txApp, ticket) {
  try {
    txApp.findCollectionByNameOrId(INBOX);
  } catch (err) {
    return [];
  }
  var ids = [];
  var linked = txApp.findRecordsByFilter(INBOX, 'ticket = {:id}', 'created', 0, 0, { id: ticket.id });
  for (var i = 0; i < linked.length; i++) {
    ids.push(linked[i].id);
  }
  var main = ticket.getString('source_item');
  if (main !== '' && ids.indexOf(main) === -1) {
    ids.push(main);
  }
  return ids;
}

/**
 * Ticket delete, after e.next(), in the same transaction (ADR-0031, addendum B): every source of
 * the deleted ticket that is still converted becomes new ('inbox') or discarded ('discard', a
 * tombstone that keeps its fingerprint), without ticket and with source_meta.ticket_deleted =
 * { key, at }. Nothing is deleted with the ticket. Returns the number of settled items.
 * `options` (trash, ADR-0037): `ticket` also notes the ID of the ticket in the trash, `silent`
 * writes no history entry. A ticket of the trash is deleted for good only without bound sources
 * (ADR-0047), so this settles none then.
 */
function settleSourcesOfDeletedTicket(txApp, ids, handling, key, options) {
  var opts = options || {};
  var mode = rules.isSourceHandling(handling) ? handling : rules.DEFAULT_SOURCE_HANDLING;
  var at = new Date().toISOString().replace('T', ' ');
  var settled = 0;
  for (var i = 0; i < ids.length; i++) {
    var item = findById(txApp, INBOX, ids[i]);
    if (!item || item.getString('state') !== 'converted') {
      continue;
    }
    item.set('state', mode === 'discard' ? 'discarded' : 'new');
    item.set('ticket', '');
    item.set('source_meta', rules.deletedTicketMeta(metaOf(item), key, at, opts.ticket));
    if (opts.silent) {
      item.set(SILENT_KEY, true);
    }
    txApp.save(item);
    settled += 1;
  }
  return settled;
}

// Storage key of the original file of an entry ('' without one).
function originalFileKey(item) {
  var name = item.getString('original');
  return name === '' ? '' : item.baseFilesPath() + '/' + name;
}

/**
 * "Kopie der Herkunft übernehmen" (ADR-0045): a new, own entry with everything the source kept
 * (channel, kind, title, text, address, reference, date, details and the original file, also a
 * saved page), saved as "new" in the transaction of the duplicate, whose ticket hook then converts
 * it. `target` { owner, household, meta }: the owner and area of the duplicate and the details of
 * the copy (with `copy_of`). The copy takes no connection: it did not come in through one, so the
 * counts of a connection stay those of its channel. Its fingerprint derives from the original
 * entry (COPY_OF_KEY), so the duplicate check of the original is neither blocked nor answered by
 * it. The caller checked that the original file exists; the file is copied in the storage without
 * reading it into memory. The copy keeps the target project of the original (ADR-0049 §2): it came
 * by the same way, and converting it again chooses the same project in advance.
 */
function copySource(txApp, item, target) {
  var copy = new Record(txApp.findCollectionByNameOrId(INBOX));
  copy.set('owner', target.owner);
  copy.set('household', target.household);
  var fields = ['channel', 'kind', 'title', 'body', 'source_url', 'source_ref', 'source_date'];
  for (var i = 0; i < fields.length; i++) {
    copy.set(fields[i], item.getString(fields[i]));
  }
  copy.set('source_meta', target.meta);
  copy.set(COPY_OF_KEY, item.getString('fingerprint'));
  copy.set(targetRules.GIVEN_KEY, item.getString(targetRules.FIELD));
  var key = originalFileKey(item);
  if (key === '') {
    txApp.save(copy);
    return copy;
  }
  var fsys = txApp.newFilesystem();
  try {
    copy.set('original', fsys.getReuploadableFile(key, true));
    txApp.save(copy);
  } finally {
    fsys.close();
  }
  return copy;
}

// Whether the original file of an entry is in the storage (true without one).
function originalFileExists(app, item) {
  var key = originalFileKey(item);
  if (key === '') {
    return true;
  }
  var fsys = app.newFilesystem();
  try {
    return fsys.exists(key);
  } finally {
    fsys.close();
  }
}

module.exports = {
  IMMUTABLE_FIELDS: IMMUTABLE_FIELDS,
  metaOf: metaOf,
  prepareCreate: prepareCreate,
  ingest: ingest,
  lookup: lookup,
  rememberActor: rememberActor,
  guardClientUpdate: guardClientUpdate,
  prepareUpdate: prepareUpdate,
  recordLinkChange: recordLinkChange,
  refuseDelete: refuseDelete,
  prepareConversion: prepareConversion,
  completeConversion: completeConversion,
  SOURCE_HANDLING_KEY: SOURCE_HANDLING_KEY,
  SILENT_KEY: SILENT_KEY,
  COPY_OF_KEY: COPY_OF_KEY,
  ACTOR_KEY: ACTOR_KEY,
  SOURCE_LINK_FIELD: SOURCE_LINK_FIELD,
  findById: findById,
  sourcesOfDeletedTicket: sourcesOfDeletedTicket,
  settleSourcesOfDeletedTicket: settleSourcesOfDeletedTicket,
  copySource: copySource,
  originalFileExists: originalFileExists
};
