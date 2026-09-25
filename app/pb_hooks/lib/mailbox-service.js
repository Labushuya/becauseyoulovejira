// Mailbox selection (ADR-0016 section 6; E4 plan package 23): the web app asks PocketBase, and the
// hook passes the request on to the local interface of the mail helper on 127.0.0.1 with the
// ingest token. The browser never talks to the helper, and nothing of the list is stored. Only a
// signed-in user who may see the connection gets an answer; the connection must be a switched-on
// mail connection. CommonJS module, ES5 only, Goja runtime only.
'use strict';

var secrets = require(__hooks + '/lib/secrets.js');
var rules = require(__hooks + '/lib/mailbox-rules.js');
var ingestRules = require(__hooks + '/lib/ingest-rules.js');
var inbox = require(__hooks + '/lib/inbox-service.js');
var connections = require(__hooks + '/lib/connection-service.js');

function getenv(name) {
  return $os.getenv(name);
}

// The connection of the route if the request may see it and it is a switched-on mail connection.
function mailConnection(e) {
  var record = connections.visibleConnection(e, e.request.pathValue('id'));
  if (!record || record.getString('type') !== 'mail') {
    throw new NotFoundError();
  }
  if (!record.getBool('enabled')) {
    throw new BadRequestError(rules.DISABLED);
  }
  return record;
}

// POST to the helper. { unavailable: true } when it cannot be asked (no token, invalid port,
// nothing listens, timeout), else { statusCode, json }. "Connection: close": Go would otherwise
// keep the connection and reuse it for the next request; after a restart of the helper (or its
// keep-alive timeout) that connection is gone, and Go does not retry a POST, so the first request
// would answer "Der Mail-Hilfsprozess läuft nicht". A new connection per request costs nothing on
// 127.0.0.1.
function askHelper(path, payload) {
  var token = secrets.read(ingestRules.TOKEN_ENV, getenv);
  var base = rules.helperUrl($os.getenv(rules.PORT_ENV));
  if (token === '' || base === '') {
    return { unavailable: true };
  }
  var response;
  try {
    response = $http.send({
      url: base + path,
      method: 'POST',
      body: JSON.stringify(payload),
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token, Connection: 'close' },
      timeout: rules.TIMEOUT_SECONDS
    });
  } catch (err) {
    return { unavailable: true };
  }
  return { statusCode: response.statusCode, json: response.json };
}

// Answer for a helper that cannot be asked or that refused the request.
function helperFailure(e, answer) {
  if (answer.unavailable) {
    return e.json(503, { message: rules.NOT_RUNNING, hint: rules.NOT_RUNNING_HINT });
  }
  var failure = rules.failure(answer.statusCode, answer.json);
  return e.json(failure.status, { message: failure.message, hint: failure.hint });
}

/**
 * GET /api/byl/connections/{id}/mailbox?limit=: the last mails of the inbox (header data only) with
 * the keyword that matches and the state of an entry in the inbox of the owner ('' for none).
 */
function list(e) {
  var record = mailConnection(e);
  var query = e.requestInfo().query || {};
  var limit = rules.parseLimit(query.limit);
  if (limit.error) {
    throw new BadRequestError(limit.error);
  }
  var answer = askHelper('/mailbox/list', { connection: record.id, limit: limit.limit });
  if (answer.unavailable || answer.statusCode !== 200) {
    return helperFailure(e, answer);
  }
  var owner = record.getString('owner');
  var items = rules.listItems(answer.json);
  var result = [];
  for (var i = 0; i < items.length; i++) {
    var item = items[i];
    var existing = inbox.lookup(e.app, owner, item.draft);
    result.push({
      uid: item.uid,
      size: item.size,
      subject: item.subject,
      from: item.from,
      date: item.date,
      keyword: item.keyword,
      state: existing ? existing.state : '',
      message: existing ? existing.message : ''
    });
  }
  return e.json(200, { items: result });
}

/**
 * POST /api/byl/connections/{id}/mailbox/import with { uids }: the helper takes the chosen mails
 * into the inbox (origin "selected", also without keyword). Answers the result per UID.
 */
function importMails(e) {
  var record = mailConnection(e);
  var body = e.requestInfo().body || {};
  var parsed = rules.parseUids(body.uids);
  if (parsed.error) {
    throw new BadRequestError(parsed.error);
  }
  var answer = askHelper('/mailbox/import', { connection: record.id, uids: parsed.uids });
  if (answer.unavailable || answer.statusCode !== 200) {
    return helperFailure(e, answer);
  }
  return e.json(200, { items: rules.importItems(answer.json, parsed.uids) });
}

module.exports = {
  list: list,
  importMails: importMails
};
