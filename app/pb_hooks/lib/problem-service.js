// The error log of the server (FP-2, ADR-0077): the only place that writes problem_events. The rules
// (cleaning, the same failure, areas, limits) live in lib/problem-rules.js.
//
// - record(app, input): one entry per failure; the same failure again (same fingerprint) only
//   counts up and moves its last occurrence, in one statement (UPSERT on the unique fingerprint), so
//   a channel that fails every minute stays one row. A new row prunes the log (30 days, 5000 rows).
// - Never throws and never disturbs the request or job it records: a failure of the log itself only
//   goes to the log of PocketBase, never into the log again (no recursion). The statement is plain
//   SQL outside of any transaction of the caller, so no record hook and no realtime event fires.
// - Before the migration 1790205100 nothing is written.
//
// CommonJS module, ES5 only, Goja runtime only ($security, DynamicModel).
'use strict';

var rules = require(__hooks + '/lib/problem-rules.js');

var COLLECTION = 'problem_events';
var AREA = 'byl-problems';
var ID_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';
var ID_LENGTH = 15;

// One row per fingerprint; the same failure counts on it and keeps the newest message and context.
var UPSERT_SQL =
  'INSERT INTO problem_events (id, source, area, owner, household, code, message, context, fingerprint, count, first_at, last_at) ' +
  'VALUES ({:id}, {:source}, {:area}, {:owner}, {:household}, {:code}, {:message}, {:context}, {:fingerprint}, 1, {:at}, {:at}) ' +
  'ON CONFLICT(fingerprint) DO UPDATE SET count = count + 1, last_at = MAX(last_at, excluded.last_at), ' +
  'message = excluded.message, context = excluded.context RETURNING id, count';

function hasLog(app) {
  try {
    app.findCollectionByNameOrId(COLLECTION);
    return true;
  } catch (err) {
    return false;
  }
}

function warn(app, message, err) {
  try {
    app.logger().warn(AREA + ': ' + message, 'error', rules.cleanMessage(rules.errorText(err)));
  } catch (ignored) {
    // Not even the log of PocketBase: the failure stays where it was.
  }
}

/** Removes entries whose last occurrence is older than 30 days and beyond the newest 5000. */
function prune(app, now) {
  if (!hasLog(app)) {
    return;
  }
  var cutoff = rules.pocketBaseTime(now - rules.RETENTION_DAYS * rules.DAY_MS);
  app.db().newQuery('DELETE FROM problem_events WHERE last_at < {:cutoff}').bind({ cutoff: cutoff }).execute();
  app
    .db()
    .newQuery(
      'DELETE FROM problem_events WHERE id IN (SELECT id FROM problem_events ORDER BY last_at DESC, id DESC LIMIT -1 OFFSET {:max})'
    )
    .bind({ max: rules.MAX_ROWS })
    .execute();
}

/**
 * Keeps one failure: `input` with source, area, owner (private only), household (household only),
 * code, message and context (lib/problem-rules.js, eventOf). Returns the ID of its entry, or '' when
 * nothing was kept (before the migration, an invalid input, a failure of the log). Never throws.
 */
function record(app, input) {
  try {
    if (!hasLog(app)) {
      return '';
    }
    var now = Date.now();
    var event = rules.eventOf(input, now);
    if (event === null) {
      return '';
    }
    var result = new DynamicModel({ id: '', count: 0 });
    app
      .db()
      .newQuery(UPSERT_SQL)
      .bind({
        id: $security.randomStringWithAlphabet(ID_LENGTH, ID_ALPHABET),
        source: event.source,
        area: event.area,
        owner: event.owner,
        household: event.household,
        code: event.code,
        message: event.message,
        context: JSON.stringify(event.context),
        fingerprint: $security.sha256(rules.fingerprintSource(event)),
        at: event.at
      })
      .one(result);
    if (Number(result.count) === 1) {
      prune(app, now);
    }
    return String(result.id);
  } catch (err) {
    warn(app, 'Fehler nicht protokolliert', err);
    return '';
  }
}

/**
 * An unexpected failure of a request (`failure` of rules.requestFailureOf: code and status): private
 * for a signed-in account (only it sees the entry, ADR-0077 §5), for everything else (no account, a
 * superuser, the mail helper) the area of the administrator. Method, route without query and status;
 * never a body, a header or a token.
 */
function recordRequest(e, err, failure) {
  var owner = '';
  try {
    if (e.auth && !e.hasSuperuserAuth()) {
      owner = String(e.auth.id);
    }
  } catch (ignored) {
    owner = '';
  }
  var path = '';
  var method = '';
  try {
    path = String(e.request.url.path || '');
    method = String(e.request.method || '');
  } catch (ignored) {
    path = '';
  }
  return record(e.app, {
    source: 'request',
    area: owner === '' ? 'system' : 'private',
    owner: owner,
    code: failure.code,
    message: rules.errorText(err),
    context: { method: method, route: path, status: failure.status }
  });
}

/**
 * Whether PocketBase answers the error of Go `value` with field errors, i.e. a validation (ToApiError
 * of 0.40.4 takes them from it the same way). When in doubt yes: no entry.
 */
function isValidation(value) {
  try {
    var data = new ApiError(400, '', value).data;
    return data !== null && data !== undefined && Object.keys(data).length > 0;
  } catch (err) {
    return true;
  }
}

/**
 * A failed request (the wrapper of every request in static-cache.pb.js calls it in its catch and then
 * throws `err` on unchanged, so status and body of the answer stay those of PocketBase): an unexpected
 * failure (rules.requestFailureOf) gets an entry, and its answer the header X-Byl-Problem with the ID
 * of the entry. Refusals, validations, the deliberate 502 and 503 and answers written by a route are no
 * entry. Never throws.
 */
function onRequestError(e, err) {
  try {
    var failure = rules.requestFailureOf(err, isValidation);
    if (failure === null) {
      return;
    }
    var id = recordRequest(e, err, failure);
    if (id !== '' && !e.written()) {
      e.response.header().set(rules.HEADER, id);
    }
  } catch (ignored) {
    // The log must never change the answer of the request.
  }
}

/**
 * A failed run of a channel, where its card gets its last error (lib/channel-runner.js and the
 * status of the mail helper, lib/ingest-service.js): the area of the connection, its ID and kind.
 * `error` is the text the card shows, cleaned once more here.
 */
function recordChannel(app, connection, error) {
  try {
    var area = rules.areaOf(connection.getString('owner'), connection.getString('household'));
    return record(app, {
      source: 'channel',
      area: area.area,
      owner: area.owner,
      household: area.household,
      code: 'channel_error',
      message: error,
      context: { connection: connection.id, channel: connection.getString('type') }
    });
  } catch (err) {
    warn(app, 'Fehler eines Kanals nicht protokolliert', err);
    return '';
  }
}

/**
 * A rule whose ticket could not be made (lib/recurrence-service.js): the area of the rule and its ID.
 * Nothing when the rule is gone.
 */
function recordRule(app, ruleId, err) {
  try {
    var rule = app.findRecordById('recurrence_rules', ruleId);
    var area = rules.areaOf(rule.getString('owner'), rule.getString('household'));
    return record(app, {
      source: 'job',
      area: area.area,
      owner: area.owner,
      household: area.household,
      code: 'recurrence_failed',
      message: rules.errorText(err),
      context: { rule: rule.id, job: 'recurrence' }
    });
  } catch (failure) {
    warn(app, 'Fehler einer Wiederholung nicht protokolliert', failure);
    return '';
  }
}

/** A job of the server that failed as a whole (a cron or the start): the area of the administrator. */
function recordJob(app, job, err) {
  return record(app, {
    source: 'job',
    area: 'system',
    code: String(job) + '_failed',
    message: rules.errorText(err),
    context: { job: job }
  });
}

module.exports = {
  COLLECTION: COLLECTION,
  UPSERT_SQL: UPSERT_SQL,
  prune: prune,
  record: record,
  recordRequest: recordRequest,
  onRequestError: onRequestError,
  recordChannel: recordChannel,
  recordRule: recordRule,
  recordJob: recordJob
};
