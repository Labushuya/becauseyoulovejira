// Runs the channels that fetch in the server (ADR-0016 section 2; E4 plan packages 15 and 17):
// by cron for every switched-on connection of a kind, or once through "Jetzt abrufen". Common to
// all kinds: access data from BYL_* variables read at the moment of the run (ADR-0018), a run
// lock per connection over `running_since` (stale after 10 minutes), a timeout for every request
// well below the interval, a size limit, and errors that are cleaned before they are stored or
// logged and never thrown, so one connection cannot stop the others. Without its variables a
// connection does nothing and logs that once per start of the server.
// CommonJS module, ES5 only, Goja runtime only.
'use strict';

var secrets = require(__hooks + '/lib/secrets.js');
var berlin = require(__hooks + '/lib/berlin-time.js');
var rules = require(__hooks + '/lib/connection-rules.js');

var COLLECTION = 'connections';
var LOCK_MS = 10 * 60 * 1000;
// Seconds per request of the calendar (every 15 minutes); Telegram (every minute) uses 20.
var HTTP_TIMEOUT_SECONDS = 30;
var MAX_BODY_BYTES = 20 * 1024 * 1024;
// New entries per run and connection; the rest follows with the next run.
var MAX_NEW_PER_RUN = 500;

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

function msOf(stored) {
  var value = String(stored || '');
  return value === '' ? NaN : Date.parse(value.replace(' ', 'T'));
}

// True while another run holds the lock (set less than LOCK_MS ago).
function isLocked(runningSince, now) {
  var since = msOf(runningSince);
  return !isNaN(since) && since > now - LOCK_MS;
}

// Channel modules by kind; each has run(app, record, values) -> outcome.
function channelOf(type) {
  if (type === 'calendar') {
    return require(__hooks + '/lib/channel-calendar-run.js');
  }
  if (type === 'telegram') {
    return require(__hooks + '/lib/channel-telegram-run.js');
  }
  return null;
}

// Logs a message once per start of the server (the store lives as long as the process).
function logOnce(app, key, message) {
  var store = app.store();
  if (store.has(key)) {
    return;
  }
  store.set(key, true);
  app.logger().info(message);
}

function values(record) {
  var names = rules.variableNames(record.getString('type'), record.getString('secret_env'), jsonOf(record, 'settings'));
  var getenv = function (name) {
    return $os.getenv(name);
  };
  var result = { secret: secrets.read(names.secret, getenv), allowlist: '', missing: [] };
  if (result.secret === '') {
    result.missing.push(names.secret);
  }
  if (record.getString('type') === 'telegram') {
    result.allowlist = secrets.read(names.allowlist, getenv);
    if (result.allowlist === '') {
      result.missing.push(names.allowlist);
    }
  }
  return result;
}

function lock(app, id, now) {
  var acquired = false;
  app.runInTransaction(function (txApp) {
    var record = txApp.findRecordById(COLLECTION, id);
    if (isLocked(record.getString('running_since'), now)) {
      return;
    }
    record.set('running_since', berlin.toPocketBaseDate(now));
    txApp.save(record);
    acquired = true;
  });
  return acquired;
}

// Stores the result of a run and frees the lock. `outcome.cursor`/`outcome.hint` only when set.
function finish(app, id, outcome, error) {
  var record = app.findRecordById(COLLECTION, id);
  var stamp = berlin.toPocketBaseDate(Date.now());
  record.set('running_since', '');
  record.set('last_run_at', stamp);
  record.set('last_error', error);
  if (error === '') {
    record.set('last_ok_at', stamp);
  }
  if (outcome.cursor !== undefined) {
    record.set('cursor', String(outcome.cursor));
  }
  if (outcome.hint !== undefined) {
    record.set('last_hint', outcome.hint);
  }
  app.save(record);
}

function label(record) {
  return '"' + record.getString('label') + '" (' + record.id + ')';
}

/**
 * Runs one connection. Returns { status, created, duplicates, updated, skipped, failed, unmatched,
 * error, missing }; `unmatched` counts what no keyword matched and what was therefore not saved
 * (ADR-0020):
 * status "ok", "error", "running" (another run holds the lock), "missing" (variables not set),
 * "disabled" or "unsupported". `error` is cleaned; `missing` lists names of variables only.
 */
function runConnection(app, record) {
  var result = {
    status: 'ok',
    created: 0,
    duplicates: 0,
    updated: 0,
    skipped: 0,
    failed: 0,
    unmatched: 0,
    error: '',
    missing: []
  };
  var type = record.getString('type');
  var channel = channelOf(type);
  if (!channel) {
    result.status = 'unsupported';
    return result;
  }
  if (!record.getBool('enabled')) {
    result.status = 'disabled';
    return result;
  }
  var access = values(record);
  if (access.missing.length > 0) {
    result.status = 'missing';
    result.missing = access.missing;
    logOnce(
      app,
      'byl-missing:' + record.id + ':' + access.missing.join(','),
      'byl-' + type + ': Verbindung ' + label(record) + ' ruft nichts ab, solange ' + access.missing.join(' und ') +
        ' fehlt (Variable anlegen, dann neu-starten.bat).'
    );
    return result;
  }
  var now = Date.now();
  if (!lock(app, record.id, now)) {
    result.status = 'running';
    return result;
  }
  var hidden = [access.secret, access.allowlist];
  var outcome;
  try {
    outcome = channel.run(app, record, access) || {};
  } catch (err) {
    outcome = { error: String(err && err.message ? err.message : err) };
  }
  var error = outcome.error ? secrets.redact(outcome.error, hidden) : '';
  try {
    finish(app, record.id, outcome, error);
  } catch (err) {
    app.logger().warn('byl-' + type + ': Verbindung ' + label(record) + ': ' + secrets.redact(String(err), hidden));
  }
  if (error !== '') {
    app.logger().warn('byl-' + type + ': Verbindung ' + label(record) + ': ' + error);
  }
  result.status = error === '' ? 'ok' : 'error';
  result.error = error;
  result.created = outcome.created || 0;
  result.duplicates = outcome.duplicates || 0;
  result.updated = outcome.updated || 0;
  result.skipped = outcome.skipped || 0;
  result.failed = outcome.failed || 0;
  result.unmatched = outcome.unmatched || 0;
  return result;
}

/**
 * Cron: every switched-on connection of `type`, one after the other. Before the migration of the
 * connections, or without any, nothing happens. Never throws.
 */
function runAll(app, type) {
  var found;
  try {
    found = app.findRecordsByFilter(COLLECTION, 'type = {:type} && enabled = true', 'created', 0, 0, { type: type });
  } catch (err) {
    return;
  }
  for (var i = 0; i < found.length; i++) {
    try {
      runConnection(app, found[i]);
    } catch (err) {
      app.logger().warn('byl-' + type + ': ' + secrets.redact(String(err), []));
    }
  }
}

module.exports = {
  LOCK_MS: LOCK_MS,
  HTTP_TIMEOUT_SECONDS: HTTP_TIMEOUT_SECONDS,
  MAX_BODY_BYTES: MAX_BODY_BYTES,
  MAX_NEW_PER_RUN: MAX_NEW_PER_RUN,
  isLocked: isLocked,
  runConnection: runConnection,
  runAll: runAll
};
