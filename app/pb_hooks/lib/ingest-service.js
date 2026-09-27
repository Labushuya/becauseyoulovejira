// Ingest interface of the mail helper byl-mail.exe (ADR-0016 section 5, ADR-0018 section 8; E4 plan
// package 22). The helper has no account: it authenticates with the token in BYL_INGEST_TOKEN,
// which byl-control.ps1 hands to both processes. The token only reaches mail connections that are
// switched on, and entries are always created for the owner of the connection, through the one
// way into the inbox (inbox-service.ingest). CommonJS module, ES5 only, Goja runtime only.
'use strict';

var secrets = require(__hooks + '/lib/secrets.js');
var keywords = require(__hooks + '/lib/keywords.js');
var berlin = require(__hooks + '/lib/berlin-time.js');
var connectionRules = require(__hooks + '/lib/connection-rules.js');
var rules = require(__hooks + '/lib/ingest-rules.js');
var inbox = require(__hooks + '/lib/inbox-service.js');

var COLLECTION = 'connections';
var UNAVAILABLE = 'Die Verbindungen stehen nach dem nächsten Start der App bereit (start.bat).';

function getenv(name) {
  return $os.getenv(name);
}

function token() {
  return secrets.read(rules.TOKEN_ENV, getenv);
}

/**
 * Lets the request through only with the token: without the variable the interface does not
 * exist (404), a missing or wrong token is refused (401). Never says why beyond that.
 */
function authorize(e) {
  var expected = token();
  if (expected === '') {
    throw new NotFoundError();
  }
  if (!rules.tokenMatches(expected, rules.bearerToken(e.request.header.get('Authorization')))) {
    throw new UnauthorizedError('Ungültiger Token.');
  }
}

function jsonOf(record, field) {
  var raw = record.getString(field);
  if (raw === '' || raw === 'null') {
    return null;
  }
  try {
    return JSON.parse(raw);
  } catch (err) {
    return null;
  }
}

// Throws 503 until the migration of the connections has run.
function assertAvailable(app) {
  try {
    app.findCollectionByNameOrId(COLLECTION);
  } catch (err) {
    throw new ApiError(503, UNAVAILABLE);
  }
}

/** The mail connection `id` (null for other kinds or unknown IDs); `enabled` requires it on. */
function mailConnection(app, id, enabled) {
  assertAvailable(app);
  var found = app.findRecordsByFilter(COLLECTION, 'id = {:id} && type = "mail"', '', 1, 0, { id: id });
  if (found.length === 0 || (enabled && !found[0].getBool('enabled'))) {
    return null;
  }
  return found[0];
}

/** GET /api/byl/ingest/connections: the switched-on mail connections, without secrets. */
function listConnections(app) {
  assertAvailable(app);
  var found = app.findRecordsByFilter(COLLECTION, 'type = "mail" && enabled = true', 'created', 0, 0);
  var items = [];
  for (var i = 0; i < found.length; i++) {
    var record = found[i];
    items.push(
      rules.connectionView(
        {
          id: record.id,
          label: record.getString('label'),
          secret_env: record.getString('secret_env'),
          settings: jsonOf(record, 'settings'),
          cursor: record.getString('cursor'),
          scan: jsonOf(record, 'scan')
        },
        keywords,
        connectionRules
      )
    );
  }
  return items;
}

// The draft of a request: JSON body, or multipart with the field "draft" (JSON text) and the
// original mail as file "original".
function requestDraft(e) {
  var body = e.requestInfo().body || {};
  var value = body;
  if (typeof body.draft === 'string') {
    try {
      value = JSON.parse(body.draft);
    } catch (err) {
      value = null;
    }
  }
  return rules.parseDraft(value);
}

// The uploaded original of a multipart request; a JSON request has none.
function uploadedOriginal(e) {
  var type = String(e.request.header.get('Content-Type') || '').toLowerCase();
  if (type.indexOf('multipart/form-data') !== 0) {
    return [];
  }
  try {
    return e.findUploadedFiles('original') || [];
  } catch (err) {
    // No file in the field (http.ErrMissingFile): the mail comes without its original.
    return [];
  }
}

/**
 * POST /api/byl/ingest/items. Answers { status: "created" | "duplicate", item, state?, message? },
 * 422 { status: "unmatched" } for a fetched mail without keyword (nothing is saved), 404 for a
 * connection that is not a switched-on mail connection, 400 for an invalid draft.
 */
function ingestItem(e) {
  var parsed = requestDraft(e);
  if (parsed.error) {
    throw new BadRequestError(parsed.error);
  }
  var draft = parsed.draft;
  var connection = mailConnection(e.app, draft.connection, true);
  if (!connection) {
    throw new NotFoundError('Keine eingeschaltete Mail-Verbindung.');
  }
  var decision = rules.keywordDecision(draft.origin, jsonOf(connection, 'settings'), draft, keywords, connectionRules);
  if (!decision.accepted) {
    return e.json(422, { status: 'unmatched', message: rules.UNMATCHED_MESSAGE });
  }
  if (decision.keyword !== '') {
    draft.meta.keyword = decision.keyword;
  }
  var files = uploadedOriginal(e);
  var outcome = inbox.ingest(e.app, connection.getString('owner'), {
    channel: draft.channel,
    kind: draft.kind,
    title: draft.title,
    body: draft.body,
    source_url: draft.source_url,
    source_ref: draft.source_ref,
    source_date: draft.source_date,
    meta: draft.meta,
    connection: connection.id,
    originalFile: files && files.length > 0 ? files[0] : null
  });
  if (outcome.kind === 'duplicate') {
    var state = outcome.item.getString('state');
    return e.json(200, { status: 'duplicate', item: outcome.item.id, state: state });
  }
  return e.json(200, { status: 'created', item: outcome.item.id });
}

/**
 * POST /api/byl/ingest/connections/{id}/status: result of a run of the helper. Stores the time,
 * the cleaned error (the password of the connection and the token become ***), the hint and the
 * cursor. Answers 404 for anything but a mail connection.
 */
function reportStatus(e, id) {
  var parsed = rules.parseStatus(e.requestInfo().body || {});
  if (parsed.error) {
    throw new BadRequestError(parsed.error);
  }
  var connection = mailConnection(e.app, id, false);
  if (!connection) {
    throw new NotFoundError('Keine Mail-Verbindung.');
  }
  var status = parsed.status;
  var hidden = [secrets.read(connection.getString('secret_env'), getenv), token()];
  var error = status.error === '' ? '' : secrets.redact(status.error, hidden);
  var stamp = berlin.toPocketBaseDate(Date.now());
  connection.set('last_run_at', stamp);
  connection.set('last_error', error);
  if (error === '') {
    connection.set('last_ok_at', stamp);
  }
  if (status.hint !== undefined) {
    connection.set('last_hint', secrets.redact(status.hint, hidden));
  }
  if (status.cursor !== undefined) {
    connection.set('cursor', status.cursor);
  }
  // Before the migration 1790201700 has run, the field does not exist yet; the scan then starts
  // over after the next start of the app.
  if (status.scan !== undefined && hasField(connection, 'scan')) {
    connection.set('scan', rules.mergeScan(jsonOf(connection, 'scan'), status.scan));
  }
  e.app.save(connection);
  return e.json(200, { status: 'ok' });
}

/** Whether the collection of `record` has the field `name` (fields added by later migrations). */
function hasField(record, name) {
  try {
    return !!record.collection().fields.getByName(name);
  } catch (err) {
    return false;
  }
}

/**
 * "Abbrechen" while the helper runs no scan of the connection: marks a running, paused or failed
 * scan as cancelled, so the helper does not continue it. True when something changed.
 */
function cancelStoredScan(app, connection) {
  if (!hasField(connection, 'scan')) {
    return false;
  }
  var next = rules.cancelledScan(jsonOf(connection, 'scan'));
  if (next === null) {
    return false;
  }
  connection.set('scan', next);
  app.save(connection);
  return true;
}

module.exports = {
  hasField: hasField,
  cancelStoredScan: cancelStoredScan,
  authorize: authorize,
  listConnections: listConnections,
  ingestItem: ingestItem,
  reportStatus: reportStatus
};
