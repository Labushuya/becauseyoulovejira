// The own inbox with access keys (ADR-0038; plan eigener-eingang-whatsapp-web, EI-1). A user
// creates a key in the settings; the key is shown once and only its SHA-256 is stored
// (inbox_keys.token_hash, a hidden field). A key may do exactly one thing: create inbox entries of
// its owner through POST /api/byl/inbox/ingest (and GET for "Verbindung testen"). Neither the key
// nor the content of an entry is written to a log. CommonJS module, ES5 only, Goja runtime only.
'use strict';

var rules = require(__hooks + '/lib/inbox-key-rules.js');
var ingestRules = require(__hooks + '/lib/ingest-rules.js');
var keywords = require(__hooks + '/lib/keywords.js');
var inbox = require(__hooks + '/lib/inbox-service.js');
var errors = require(__hooks + '/lib/errors.js');

var KEYS = 'inbox_keys';
var RATE_PREFIX = 'byl_inbox_key_rate:';
var UNAVAILABLE = 'Der eigene Eingang steht nach dem nächsten Neustart der App bereit (neu-starten.bat).';

// Throws 503 until the migration 1790202400 has run.
function assertAvailable(app) {
  try {
    app.findCollectionByNameOrId(KEYS);
  } catch (err) {
    throw new ApiError(503, UNAVAILABLE);
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

/**
 * POST /api/byl/inbox/keys (signed-in app users): creates a key with { name } and answers 201
 * with the key in plain text, once. At most MAX_KEYS_PER_USER keys per user.
 */
function createKey(e) {
  assertAvailable(e.app);
  var parsed = rules.parseName((e.requestInfo().body || {}).name);
  if (parsed.error) {
    throw errors.fieldFailure('name', 'validation_inbox_key_name', parsed.error);
  }
  var owner = e.auth.id;
  var existing = e.app.findRecordsByFilter(KEYS, 'owner = {:owner}', '', rules.MAX_KEYS_PER_USER, 0, { owner: owner });
  if (existing.length >= rules.MAX_KEYS_PER_USER) {
    throw errors.fieldFailure('name', 'validation_inbox_key_limit', rules.MESSAGES.tooMany);
  }
  var token = rules.TOKEN_PREFIX + $security.randomStringWithAlphabet(rules.TOKEN_RANDOM_LENGTH, rules.TOKEN_ALPHABET);
  var record = new Record(e.app.findCollectionByNameOrId(KEYS));
  record.set('owner', owner);
  record.set('name', parsed.name);
  record.set('token_hash', $security.sha256(token));
  record.set('token_hint', rules.hintOf(token));
  e.app.save(record);
  return e.json(201, {
    id: record.id,
    name: record.getString('name'),
    token: token,
    token_hint: record.getString('token_hint'),
    created: record.getString('created')
  });
}

/**
 * The key of the request: 403 for a web page (Origin), 401 for a missing, malformed, unknown or
 * revoked key. Never says more.
 */
function authorize(e) {
  assertAvailable(e.app);
  if (!rules.originAllowed(e.request.header.get('Origin'))) {
    throw new ForbiddenError(rules.MESSAGES.origin);
  }
  var token = ingestRules.bearerToken(e.request.header.get('Authorization'));
  if (!rules.isTokenShape(token)) {
    throw new UnauthorizedError(rules.MESSAGES.token);
  }
  var found = e.app.findRecordsByFilter(KEYS, 'token_hash = {:hash}', '', 1, 0, { hash: $security.sha256(token) });
  if (found.length === 0) {
    throw new UnauthorizedError(rules.MESSAGES.token);
  }
  return found[0];
}

// Counts the request against the key; when the minute is used up, it answers 429 itself and
// returns true. The window lives in $app.store() (gone after a restart).
function limited(e, key) {
  var decision = null;
  var now = Date.now();
  e.app.store().setFunc(RATE_PREFIX + key.id, function (raw) {
    var entry = null;
    try {
      entry = typeof raw === 'string' ? JSON.parse(raw) : null;
    } catch (err) {
      entry = null;
    }
    decision = rules.rateDecision(entry, now);
    return JSON.stringify(decision.entry);
  });
  if (decision.allowed) {
    return false;
  }
  e.response.header().set('Retry-After', String(decision.retryAfter));
  e.json(429, { status: 'rate_limited', message: rules.MESSAGES.rate });
  return true;
}

// "zuletzt benutzt", at most once a minute; a failure here never fails the request.
function touch(app, key) {
  var now = Date.now();
  var last = Date.parse(key.getString('last_used_at').replace(' ', 'T'));
  if (!rules.lastUsedDue(last, now)) {
    return;
  }
  try {
    key.set('last_used_at', new Date(now).toISOString().replace('T', ' '));
    app.save(key);
  } catch (err) {
    app.logger().warn('Eigener Eingang: „zuletzt benutzt“ nicht gespeichert', 'key', key.id);
  }
}

function settingsOf(app, owner) {
  var found = app.findRecordsByFilter('users', 'id = {:id}', '', 1, 0, { id: owner });
  return found.length > 0 ? jsonOf(found[0], 'import_keywords') : null;
}

/**
 * GET /api/byl/inbox/ingest ("Verbindung testen"): 200 { status: "ok", name, keywords } with the
 * name of the key and the number of keywords per channel.
 */
function ping(e) {
  var key = authorize(e);
  if (limited(e, key)) {
    return null;
  }
  touch(e.app, key);
  var counts = rules.keywordCounts(settingsOf(e.app, key.getString('owner')), keywords);
  return e.json(200, { status: 'ok', name: key.getString('name'), keywords: counts });
}

/**
 * POST /api/byl/inbox/ingest: one entry for the inbox of the owner of the key (private scope).
 * 201 { status: "created", item }, 200 { status: "duplicate", item, state } (also for an entry
 * that was discarded: it does not come back), 422 { status: "filtered" } for "auto" without a
 * keyword of the channel (nothing is saved), 400 { status: "invalid", message }.
 */
function ingest(e) {
  var key = authorize(e);
  if (limited(e, key)) {
    return null;
  }
  touch(e.app, key);
  var parsed = rules.parsePayload(e.requestInfo().body);
  if (parsed.error) {
    return e.json(400, { status: 'invalid', message: parsed.error });
  }
  var draft = parsed.draft;
  var owner = key.getString('owner');
  var decision = rules.keywordDecision(settingsOf(e.app, owner), draft, keywords);
  if (!decision.accepted) {
    return e.json(422, { status: 'filtered', message: rules.MESSAGES.filtered });
  }
  if (decision.keyword !== '') {
    draft.meta.keyword = decision.keyword;
  }
  var outcome = inbox.ingest(e.app, owner, {
    channel: draft.channel,
    kind: draft.kind,
    title: draft.title,
    body: draft.body,
    source_url: draft.source_url,
    source_ref: draft.source_ref,
    source_date: draft.source_date,
    meta: draft.meta
  });
  if (outcome.kind === 'duplicate') {
    // An object whose entry moved into another area names no entry (state "moved", E7-4b).
    return e.json(200, { status: 'duplicate', item: outcome.item ? outcome.item.id : '', state: outcome.state });
  }
  return e.json(201, { status: 'created', item: outcome.item.id });
}

module.exports = {
  createKey: createKey,
  authorize: authorize,
  ping: ping,
  ingest: ingest
};
