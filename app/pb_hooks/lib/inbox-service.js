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

var INBOX = 'inbox_items';

// Set once on create; a client update that changes them is rejected (ADR-0014 section 1).
var IMMUTABLE_FIELDS = ['channel', 'source_ref', 'source_date', 'fingerprint', 'original'];

var MESSAGES = {
  validation_inbox_duplicate: 'Dieser Eintrag ist schon vorhanden.',
  validation_inbox_immutable: 'Dieses Feld lässt sich nach dem Eingang nicht mehr ändern.',
  validation_inbox_transition: 'Dieser Zustandswechsel ist nicht erlaubt.',
  validation_inbox_item_handled: 'Dieser Eintrag wurde schon bearbeitet.',
  validation_inbox_ticket_required: 'Zum Zuordnen fehlt das Ticket.',
  validation_invalid_url: 'Nur http- und https-Adressen.',
  validation_required: 'Pflichtfeld.',
  validation_scope_mismatch: 'Verknüpfter Datensatz nicht gefunden oder in einem anderen Bereich.',
  validation_source_not_allowed: 'Diese Quelle lässt sich beim Anlegen nicht direkt setzen.'
};

function fail(field, code, params) {
  return errors.fieldFailure(field, code, MESSAGES[code], params);
}

// Returns the record or null; real database errors still throw.
function findById(txApp, collection, id) {
  var found = txApp.findRecordsByFilter(collection, 'id = {:id}', '', 1, 0, { id: id });
  return found.length > 0 ? found[0] : null;
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
  var ticketId = existing.getString('ticket');
  var ticket = ticketId === '' ? null : findById(txApp, 'tickets', ticketId);
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

// onRecordCreate before e.next(): prepareRecord plus the duplicate check in the scope.
function prepareCreate(txApp, record) {
  var prepared = prepareRecord(record);
  if (prepared.fingerprint !== '') {
    assertNoDuplicate(txApp, prepared.scope, prepared.fingerprint);
  }
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
 * .ics route, the calendar feed, the Telegram bot). The draft has the fields of inbox_items:
 * { channel, kind, title, body, source_url, source_ref, source_date, meta, original,
 * originalName, connection }; `original` is the text of the original file.
 * Returns { kind: 'created', item } or { kind: 'duplicate', item } with the existing record, so a
 * channel counts duplicates instead of failing (ADR-0014 section 3). Validation errors throw.
 * Runs in its own transaction; the record hook repeats the check as a safety net.
 */
function ingest(app, owner, draft) {
  var outcome = null;
  app.runInTransaction(function (txApp) {
    var record = new Record(txApp.findCollectionByNameOrId(INBOX));
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
    var prepared = prepareRecord(record);
    var existing = prepared.fingerprint === '' ? null : findByFingerprint(txApp, prepared.scope, prepared.fingerprint);
    if (existing) {
      outcome = { kind: 'duplicate', item: existing };
      return;
    }
    if (draft.original) {
      record.set('original', $filesystem.fileFromBytes(draft.original, draft.originalName || 'original.txt'));
    }
    txApp.save(record);
    outcome = { kind: 'created', item: record };
  });
  return outcome;
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

// onRecordUpdate before e.next(), for client and internal saves: scope, handled_at, and a
// converted item must point to a ticket of its scope.
function prepareUpdate(txApp, record) {
  var original = record.original();
  var scope = applyScope(record);
  var before = original.getString('state');
  var after = record.getString('state');

  if (after === 'converted' && before !== 'converted') {
    var ticketId = record.getString('ticket');
    var ticket = ticketId === '' ? null : findById(txApp, 'tickets', ticketId);
    if (!ticket || ticket.getString('scope') !== scope) {
      throw fail('ticket', 'validation_scope_mismatch');
    }
  }

  var action = rules.handledAtAction(before, after);
  if (action === 'set') {
    record.set('handled_at', new Date().toISOString());
  } else if (action === 'clear') {
    record.set('handled_at', '');
  } else {
    record.set('handled_at', original.getString('handled_at'));
  }
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

module.exports = {
  IMMUTABLE_FIELDS: IMMUTABLE_FIELDS,
  prepareCreate: prepareCreate,
  ingest: ingest,
  guardClientUpdate: guardClientUpdate,
  prepareUpdate: prepareUpdate,
  prepareConversion: prepareConversion,
  completeConversion: completeConversion
};
