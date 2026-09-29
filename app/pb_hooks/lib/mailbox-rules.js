// Pure rules of the mailbox selection (ADR-0016 section 6; E4 plan package 23): limits of the
// requests, the address of the mail helper and the answers of the helper as the web app gets them.
// Since testing feedback package A (item 4) also "Jetzt abrufen" of a mailbox (/poll of the helper)
// and the probe whether the helper runs (/health).
// CommonJS module, ES5 only, no dependencies (Goja runtime and Vitest).
'use strict';

var LIST_DEFAULT = 50;
var LIST_MAX = 200;
var IMPORT_MAX = 50;
var DEFAULT_PORT = 8091;
var PORT_ENV = 'BYL_MAIL_HELPER_PORT';
// Seconds for one request to the helper: it logs in to the mailbox and reads up to 200 headers or
// 50 mails (ADR-0016 section 6).
var TIMEOUT_SECONDS = 60;
// "Jetzt abrufen" checks up to 100 mails; the probe touches no mailbox and must answer at once.
var RUN_TIMEOUT_SECONDS = 90;
var HEALTH_TIMEOUT_SECONDS = 3;
var RUN_TIMED_OUT =
  'Der Abruf dauert länger als 90 Sekunden. Er läuft im Mail-Hilfsprozess weiter; das Ergebnis steht danach an der Karte („Aktualisieren“).';
// A helper before 0.5.0 answers the new paths with 404 "Nicht gefunden." (unknown path).
var OUTDATED =
  'Der laufende Mail-Hilfsprozess ist älter als diese App und kann noch nicht sofort abrufen. Bitte neu-starten.bat ausführen; bis dahin ruft er weiter alle 5 Minuten ab.';
var UNKNOWN_PATH = 'Nicht gefunden.';

var NOT_RUNNING = 'Der Mail-Hilfsprozess läuft nicht (byl-mail.exe fehlt oder ist beendet).';
var NOT_RUNNING_HINT =
  'Mit einer eingeschalteten Postfach-Verbindung startet start.bat bzw. neu-starten.bat ihn mit.';
var TOKEN_REFUSED = 'Der Mail-Hilfsprozess kennt den Zugang der App nicht (BYL_INGEST_TOKEN). Bitte neu-starten.bat ausführen.';
var DISABLED = 'Die Verbindung ist ausgeschaltet.';

var TEXT_MAX = 2000;

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && Object.prototype.toString.call(value) === '[object Object]';
}

function isArray(value) {
  return Object.prototype.toString.call(value) === '[object Array]';
}

function text(value, max) {
  return typeof value === 'string' ? value.slice(0, max || TEXT_MAX) : '';
}

function isUid(value) {
  return typeof value === 'number' && value % 1 === 0 && value >= 1 && value <= 4294967295;
}

/** Limit of the list from the query string: 1 to 200, 50 without one. { limit } or { error }. */
function parseLimit(value) {
  var raw = value === undefined || value === null ? '' : String(value);
  if (raw === '') {
    return { limit: LIST_DEFAULT };
  }
  if (!/^\d{1,3}$/.test(raw) || Number(raw) < 1 || Number(raw) > LIST_MAX) {
    return { error: 'Anzahl muss zwischen 1 und ' + LIST_MAX + ' liegen.' };
  }
  return { limit: Number(raw) };
}

/** UIDs of an import: 1 to 50 distinct UIDs. { uids } or { error }. */
function parseUids(value) {
  if (!isArray(value) || value.length === 0 || value.length > IMPORT_MAX) {
    return { error: 'Bitte 1 bis ' + IMPORT_MAX + ' Mails auswählen.' };
  }
  var uids = [];
  for (var i = 0; i < value.length; i++) {
    if (!isUid(value[i])) {
      return { error: 'Keine gültige Auswahl.' };
    }
    if (uids.indexOf(value[i]) === -1) {
      uids.push(value[i]);
    }
  }
  return { uids: uids };
}

/** Address of the helper on 127.0.0.1 (port from BYL_MAIL_HELPER_PORT, else 8091), '' if invalid. */
function helperUrl(portValue) {
  var raw = portValue === undefined || portValue === null ? '' : String(portValue).replace(/^\s+|\s+$/g, '');
  if (raw === '') {
    return 'http://127.0.0.1:' + DEFAULT_PORT;
  }
  if (!/^\d{1,5}$/.test(raw) || Number(raw) < 1 || Number(raw) > 65535) {
    return '';
  }
  return 'http://127.0.0.1:' + Number(raw);
}

/**
 * The mails of a list answer of the helper, checked field by field; invalid entries are left out.
 * Each has uid, size, subject, from, date, keyword and the draft fields for the duplicate key.
 */
function listItems(json) {
  var items = isPlainObject(json) && isArray(json.items) ? json.items : [];
  var result = [];
  for (var i = 0; i < items.length && result.length < LIST_MAX; i++) {
    var item = items[i];
    if (!isPlainObject(item) || !isUid(item.uid)) {
      continue;
    }
    var from = isPlainObject(item.sourceMeta) ? text(item.sourceMeta.from) : '';
    result.push({
      uid: item.uid,
      size: typeof item.size === 'number' && item.size >= 0 ? item.size : 0,
      subject: text(item.subject, 1000),
      from: text(item.from),
      date: text(item.date, 40),
      keyword: text(item.keyword, 100),
      draft: {
        channel: 'mail',
        kind: 'mail',
        title: text(item.title, 1000),
        body: '',
        source_url: '',
        source_ref: text(item.sourceRef, 500),
        source_date: text(item.sourceDate, 40),
        meta: from === '' ? {} : { from: from }
      }
    });
  }
  return result;
}

var IMPORT_STATUSES = ['created', 'duplicate', 'failed'];

/** Results of an import answer: { uid, status, message } for the requested UIDs only. */
function importItems(json, uids) {
  var items = isPlainObject(json) && isArray(json.items) ? json.items : [];
  var result = [];
  for (var i = 0; i < items.length; i++) {
    var item = items[i];
    if (!isPlainObject(item) || !isUid(item.uid) || uids.indexOf(item.uid) === -1) {
      continue;
    }
    result.push({
      uid: item.uid,
      status: IMPORT_STATUSES.indexOf(item.status) === -1 ? 'failed' : item.status,
      message: text(item.message, 500)
    });
  }
  return result;
}

/**
 * What the route answers for a response of the helper that is not 200: { status, message, hint }.
 * 401 means the helper has another token; 400 and 404 pass on their message; everything else
 * (502 for the mailbox) is an error of the mailbox with the hint of the helper.
 */
function failure(statusCode, json) {
  var body = isPlainObject(json) ? json : {};
  if (statusCode === 401) {
    return { status: 503, message: TOKEN_REFUSED, hint: '' };
  }
  var message = text(body.message, 1000) || 'Der Mail-Hilfsprozess antwortet mit HTTP ' + statusCode + '.';
  if (statusCode === 400 || statusCode === 404) {
    return { status: statusCode, message: message, hint: '' };
  }
  return { status: 502, message: message, hint: text(body.hint, 1000) };
}

function count(value) {
  return typeof value === 'number' && value % 1 === 0 && value >= 0 ? value : 0;
}

var SECRET_NAME = /^BYL_[A-Z0-9_]{1,60}$/;

/**
 * Result of "Jetzt abrufen" of a mailbox in the shape of channel-runner.runConnection, from the
 * answer of askHelper: { unavailable, timedOut } or { statusCode, json } of POST /poll. Status
 * "unavailable" means the helper does not run (a neutral hint, no error of the mailbox).
 */
function runResult(answer) {
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
  if (!isPlainObject(answer) || answer.unavailable) {
    var timedOut = isPlainObject(answer) && answer.timedOut === true;
    result.status = timedOut ? 'error' : 'unavailable';
    result.error = timedOut ? RUN_TIMED_OUT : NOT_RUNNING + ' ' + NOT_RUNNING_HINT;
    return result;
  }
  var body = isPlainObject(answer.json) ? answer.json : {};
  if (answer.statusCode === 409) {
    result.status = 'running';
    return result;
  }
  if (answer.statusCode === 404 && body.message === UNKNOWN_PATH) {
    result.status = 'error';
    result.error = OUTDATED;
    return result;
  }
  if (answer.statusCode === 404) {
    result.status = 'disabled';
    return result;
  }
  if (answer.statusCode === 401) {
    result.status = 'error';
    result.error = TOKEN_REFUSED;
    return result;
  }
  if (answer.statusCode !== 200) {
    result.status = 'error';
    result.error = text(body.message, 1000) || 'Der Mail-Hilfsprozess antwortet mit HTTP ' + answer.statusCode + '.';
    return result;
  }
  result.created = count(body.created);
  result.duplicates = count(body.duplicates);
  result.skipped = count(body.skipped);
  result.failed = count(body.failed);
  result.unmatched = count(body.unmatched);
  if (body.status === 'ok') {
    return result;
  }
  if (body.status === 'running') {
    result.status = 'running';
  } else if (body.status === 'gone') {
    result.status = 'disabled';
  } else if (body.status === 'missing') {
    result.status = 'missing';
    var names = isArray(body.missing) ? body.missing : [];
    for (var i = 0; i < names.length; i++) {
      if (typeof names[i] === 'string' && SECRET_NAME.test(names[i])) {
        result.missing.push(names[i]);
      }
    }
  } else {
    result.status = 'error';
    result.error = text(body.error, 1000) || 'Der Abruf ist fehlgeschlagen.';
  }
  return result;
}

/**
 * Whether the mail helper runs, for the card of a mailbox: { state, version, message }. state
 * "running", "stopped" (nothing answers), "refused" (it runs with another token) or "outdated"
 * (it runs, but is older than 0.5.0 and knows no probe).
 */
function helperStatus(answer) {
  if (!isPlainObject(answer) || answer.unavailable) {
    return { state: 'stopped', version: '', message: NOT_RUNNING };
  }
  if (answer.statusCode === 401) {
    return { state: 'refused', version: '', message: TOKEN_REFUSED };
  }
  var body = isPlainObject(answer.json) ? answer.json : {};
  if (answer.statusCode === 404 && body.message === UNKNOWN_PATH) {
    return { state: 'outdated', version: '', message: OUTDATED };
  }
  if (answer.statusCode !== 200 || body.ok !== true) {
    return { state: 'stopped', version: '', message: 'Der Mail-Hilfsprozess antwortet mit HTTP ' + answer.statusCode + '.' };
  }
  return { state: 'running', version: text(body.version, 40), message: '' };
}

// "Posteingang neu durchsuchen" and "Abbrechen" (ADR-0020, addendum 3): the helper answers at
// once and scans in the background.
var SCAN_TIMEOUT_SECONDS = 10;
var SCAN_ACTIONS = ['start', 'cancel'];
var SCAN_RUNNING = 'Der Hilfsprozess ruft gerade ab. Bitte gleich noch einmal versuchen.';
var SCAN_OUTDATED =
  'Der laufende Mail-Hilfsprozess ist älter als diese App und kann den Posteingang noch nicht neu durchsuchen. Bitte neu-starten.bat ausführen.';

/** The action of a scan request: { action } or { error }. */
function parseScanAction(value) {
  if (SCAN_ACTIONS.indexOf(value) === -1) {
    return { error: 'action muss start oder cancel sein.' };
  }
  return { action: value };
}

/**
 * Result of POST /scan of the helper for the web app: { status, message } with status "started",
 * "running" (another fetch holds the helper), "cancelling", "idle" (no scan runs there),
 * "unavailable" (the helper does not run), "disabled" or "error" with the message.
 */
function scanResult(answer) {
  if (!isPlainObject(answer) || answer.unavailable) {
    return { status: 'unavailable', message: NOT_RUNNING + ' ' + NOT_RUNNING_HINT };
  }
  var body = isPlainObject(answer.json) ? answer.json : {};
  if (answer.statusCode === 202 && body.status === 'started') {
    return { status: 'started', message: '' };
  }
  if (answer.statusCode === 409) {
    return { status: 'running', message: SCAN_RUNNING };
  }
  if (answer.statusCode === 200 && (body.status === 'cancelling' || body.status === 'idle')) {
    return { status: body.status, message: '' };
  }
  if (answer.statusCode === 404 && body.message === UNKNOWN_PATH) {
    return { status: 'error', message: SCAN_OUTDATED };
  }
  if (answer.statusCode === 404) {
    return { status: 'disabled', message: DISABLED };
  }
  if (answer.statusCode === 401) {
    return { status: 'error', message: TOKEN_REFUSED };
  }
  return {
    status: 'error',
    message: text(body.message, 1000) || 'Der Mail-Hilfsprozess antwortet mit HTTP ' + answer.statusCode + '.'
  };
}

module.exports = {
  SCAN_TIMEOUT_SECONDS: SCAN_TIMEOUT_SECONDS,
  SCAN_RUNNING: SCAN_RUNNING,
  SCAN_OUTDATED: SCAN_OUTDATED,
  parseScanAction: parseScanAction,
  scanResult: scanResult,
  LIST_DEFAULT: LIST_DEFAULT,
  LIST_MAX: LIST_MAX,
  IMPORT_MAX: IMPORT_MAX,
  DEFAULT_PORT: DEFAULT_PORT,
  PORT_ENV: PORT_ENV,
  TIMEOUT_SECONDS: TIMEOUT_SECONDS,
  RUN_TIMEOUT_SECONDS: RUN_TIMEOUT_SECONDS,
  HEALTH_TIMEOUT_SECONDS: HEALTH_TIMEOUT_SECONDS,
  RUN_TIMED_OUT: RUN_TIMED_OUT,
  OUTDATED: OUTDATED,
  TOKEN_REFUSED: TOKEN_REFUSED,
  NOT_RUNNING: NOT_RUNNING,
  NOT_RUNNING_HINT: NOT_RUNNING_HINT,
  DISABLED: DISABLED,
  parseLimit: parseLimit,
  parseUids: parseUids,
  helperUrl: helperUrl,
  listItems: listItems,
  importItems: importItems,
  failure: failure,
  runResult: runResult,
  helperStatus: helperStatus
};
