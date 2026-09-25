// Pure rules of the mailbox selection (ADR-0016 section 6; E4 plan package 23): limits of the
// requests, the address of the mail helper and the answers of the helper as the web app gets them.
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

var NOT_RUNNING = 'Der Mail-Hilfsprozess läuft nicht (byl-mail.exe fehlt oder ist beendet).';
var NOT_RUNNING_HINT =
  'Mit einer eingeschalteten Postfach-Verbindung startet start.bat ihn mit; sonst stop.bat und dann start.bat ausführen.';
var TOKEN_REFUSED = 'Der Mail-Hilfsprozess kennt den Zugang der App nicht (BYL_INGEST_TOKEN). Bitte stop.bat und dann start.bat ausführen.';
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

module.exports = {
  LIST_DEFAULT: LIST_DEFAULT,
  LIST_MAX: LIST_MAX,
  IMPORT_MAX: IMPORT_MAX,
  DEFAULT_PORT: DEFAULT_PORT,
  PORT_ENV: PORT_ENV,
  TIMEOUT_SECONDS: TIMEOUT_SECONDS,
  NOT_RUNNING: NOT_RUNNING,
  NOT_RUNNING_HINT: NOT_RUNNING_HINT,
  DISABLED: DISABLED,
  parseLimit: parseLimit,
  parseUids: parseUids,
  helperUrl: helperUrl,
  listItems: listItems,
  importItems: importItems,
  failure: failure
};
