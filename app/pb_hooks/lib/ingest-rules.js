// Pure rules of the ingest interface of the mail helper (ADR-0016 section 5, ADR-0018 section 8;
// E4 plan package 22): the token check in constant time, the drafts the helper sends and the
// status it reports. CommonJS module, ES5 only, no dependencies but keywords.js and
// connection-rules.js, which the caller passes in (Goja runtime and Vitest load it the same way).
'use strict';

// Variable with the token that byl-control.ps1 creates (ADR-0018 section 8).
var TOKEN_ENV = 'BYL_INGEST_TOKEN';

// auto: found by the regular fetch, only with a keyword; selected: chosen by the user in the
// mailbox selection (ADR-0016 section 6), also without one.
var ORIGINS = ['auto', 'selected'];

// Keys of source_meta a mail may bring (inbox-mail.ts, mailToDraft); the route adds the keyword.
var META_KEYS = ['from', 'to', 'cc', 'attachments', 'html_only'];

// A mail over 10 MB comes without its file (ADR-0031 section 4): source_meta.original_omitted
// names the reason, original_size the size of the mail in bytes. Checked, not copied blindly.
var OMITTED_REASONS = ['too_large'];
var MAX_SAFE_SIZE = 9007199254740991;

var ID = /^[a-z0-9]{15}$/;
// Cursor of a mailbox: UIDVALIDITY:UID (ADR-0016 section 5), both unsigned 32-bit numbers.
var CURSOR = /^\d{1,10}:\d{1,10}$/;

var LIMITS = {
  title: 1000,
  body: 100000,
  sourceRef: 500,
  sourceDate: 40,
  text: 1000,
  // match_texts: further texts of a mail for the keyword check only (headers, HTML part), as
  // keywords.js searches them (MAIL_EXTRA_TEXTS_MAX, MAIL_TEXT_MAX_CHARS).
  matchTexts: 12,
  matchText: 100000
};

var UNMATCHED_MESSAGE = 'Kein Stichwort erkannt – nicht gespeichert.';

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && Object.prototype.toString.call(value) === '[object Object]';
}

function isString(value, max) {
  return typeof value === 'string' && value.length <= max;
}

/** The token of an Authorization header "Bearer <token>", or '' without one. */
function bearerToken(header) {
  var match = /^Bearer\s+(\S+)\s*$/i.exec(typeof header === 'string' ? header : '');
  return match ? match[1] : '';
}

/**
 * Whether `given` equals `expected`, in time that depends only on the length of `given` (no early
 * exit at the first difference). An empty `expected` never matches.
 */
function tokenMatches(expected, given) {
  var a = typeof expected === 'string' ? expected : '';
  var b = typeof given === 'string' ? given : '';
  if (a === '') {
    return false;
  }
  var difference = a.length ^ b.length;
  for (var i = 0; i < b.length; i++) {
    difference |= a.charCodeAt(i % a.length) ^ b.charCodeAt(i);
  }
  return difference === 0 && b.length > 0;
}

/**
 * Checks a draft of the helper (JSON object). Returns { draft } with the connection, the origin and
 * the fields of inbox_items, or { error } with a German message. The channel and kind are always
 * "mail"; only META_KEYS of source_meta are kept.
 */
function parseDraft(value) {
  if (!isPlainObject(value)) {
    return { error: 'Kein gültiger Entwurf.' };
  }
  if (typeof value.connection !== 'string' || !ID.test(value.connection)) {
    return { error: 'Verbindung fehlt.' };
  }
  if (ORIGINS.indexOf(value.origin) === -1) {
    return { error: 'Herkunft muss auto oder selected sein.' };
  }
  if (!isString(value.title, LIMITS.title) || value.title.replace(/\s+/g, '') === '') {
    return { error: 'Betreff fehlt oder ist zu lang.' };
  }
  var fields = { body: LIMITS.body, source_ref: LIMITS.sourceRef, source_date: LIMITS.sourceDate };
  for (var field in fields) {
    if (value[field] !== undefined && value[field] !== null && !isString(value[field], fields[field])) {
      return { error: 'Feld ' + field + ' ist ungültig.' };
    }
  }
  if (value.source_meta !== undefined && value.source_meta !== null && !isPlainObject(value.source_meta)) {
    return { error: 'Feld source_meta ist ungültig.' };
  }
  var matchTexts = [];
  if (value.match_texts !== undefined && value.match_texts !== null) {
    var texts = value.match_texts;
    if (Object.prototype.toString.call(texts) !== '[object Array]' || texts.length > LIMITS.matchTexts) {
      return { error: 'Feld match_texts ist ungültig.' };
    }
    for (var t = 0; t < texts.length; t++) {
      if (!isString(texts[t], LIMITS.matchText)) {
        return { error: 'Feld match_texts ist ungültig.' };
      }
      matchTexts.push(texts[t]);
    }
  }
  var meta = {};
  var given = value.source_meta || {};
  for (var i = 0; i < META_KEYS.length; i++) {
    var key = META_KEYS[i];
    if (Object.prototype.hasOwnProperty.call(given, key)) {
      meta[key] = given[key];
    }
  }
  if (Object.prototype.hasOwnProperty.call(given, 'original_omitted')) {
    var size = given.original_size;
    if (
      OMITTED_REASONS.indexOf(given.original_omitted) === -1 ||
      typeof size !== 'number' ||
      !(size >= 0 && size <= MAX_SAFE_SIZE) ||
      Math.floor(size) !== size
    ) {
      return { error: 'Feld source_meta ist ungültig.' };
    }
    meta.original_omitted = given.original_omitted;
    meta.original_size = size;
  }
  return {
    draft: {
      connection: value.connection,
      origin: value.origin,
      channel: 'mail',
      kind: 'mail',
      title: value.title,
      body: value.body || '',
      source_url: '',
      source_ref: value.source_ref || '',
      source_date: value.source_date || '',
      meta: meta,
      match_texts: matchTexts
    }
  };
}

/**
 * The keyword of a mail connection that matches the draft (subject, sender from source_meta.from,
 * with match_body also the whole text and the match_texts of the helper: headers and HTML part;
 * ADR-0020 and addenda). A helper before 0.6.0 sends no match_texts; its mails are checked as
 * before. { accepted, keyword }: "auto" needs a keyword, "selected" does not; the keyword is kept
 * in both cases.
 */
function keywordDecision(origin, settings, draft, keywords, connectionRules) {
  var list = connectionRules.keywordsOf(settings, keywords);
  var mail = connectionRules.mailSettingsOf(settings);
  var from = draft.meta && typeof draft.meta.from === 'string' ? draft.meta.from : '';
  var keyword = keywords.matchKeyword(
    list,
    keywords.mailTexts(draft.title, draft.body, mail.matchBody, from, draft.match_texts)
  );
  return { accepted: origin === 'selected' || keyword !== '', keyword: keyword };
}

// State of the full scan of an inbox (connections.scan; ADR-0020, addendum 3), as byl-mail.exe
// 0.7.0 reports it (helpers/mail/src/scan-state.ts). match_body_before is the mark of the migration
// 1790201700 and never comes from the helper.
var SCAN_STATES = ['running', 'paused', 'done', 'cancelled', 'error'];
var SCAN_SIGNATURE = /^[0-9a-f]{16}$/;
var SCAN_UID_VALIDITY = /^\d{1,10}$/;
var UID_MAX = 4294967295;
var COUNT_MAX = 100000000;

function isCount(value, max) {
  return typeof value === 'number' && value % 1 === 0 && value >= 0 && value <= max;
}

/**
 * Checks the scan state of a status report. Returns { scan } with exactly the known keys, or
 * { error } with a German message.
 */
function parseScan(value) {
  var invalid = { error: 'Feld scan ist ungültig.' };
  if (!isPlainObject(value)) {
    return invalid;
  }
  if (typeof value.signature !== 'string' || !SCAN_SIGNATURE.test(value.signature)) {
    return invalid;
  }
  if (SCAN_STATES.indexOf(value.state) === -1) {
    return invalid;
  }
  if (typeof value.uid_validity !== 'string' || !SCAN_UID_VALIDITY.test(value.uid_validity)) {
    return invalid;
  }
  if (!isCount(value.until, UID_MAX) || !isCount(value.below, UID_MAX + 1)) {
    return invalid;
  }
  if (!isCount(value.done, COUNT_MAX) || !isCount(value.total, COUNT_MAX) || !isCount(value.created, COUNT_MAX)) {
    return invalid;
  }
  if (value.fallback !== undefined && typeof value.fallback !== 'boolean') {
    return invalid;
  }
  return {
    scan: {
      signature: value.signature,
      state: value.state,
      uid_validity: value.uid_validity,
      until: value.until,
      below: value.below,
      done: value.done,
      total: value.total,
      created: value.created,
      fallback: value.fallback === true
    }
  };
}

/**
 * The scan state to store: the reported one, keeping the mark of the migration (match_body was
 * switched on by 1790201700, so its down migration can switch it off again).
 */
function mergeScan(stored, reported) {
  var next = {};
  for (var key in reported) {
    if (Object.prototype.hasOwnProperty.call(reported, key)) {
      next[key] = reported[key];
    }
  }
  if (isPlainObject(stored) && stored.match_body_before === false) {
    next.match_body_before = false;
  }
  return next;
}

/**
 * The stored scan state after "Abbrechen" while the helper runs no scan of the connection (it
 * was restarted, or it does not run): a running, paused or failed scan becomes cancelled; null
 * when there is nothing to cancel.
 */
function cancelledScan(stored) {
  if (!isPlainObject(stored) || ['running', 'paused', 'error'].indexOf(stored.state) === -1) {
    return null;
  }
  // A copy with every key, the mark of the migration included.
  var next = mergeScan(null, stored);
  next.state = 'cancelled';
  return next;
}

/**
 * Checks the status report of the helper: { error, hint, cursor, scan } (strings; cursor and scan
 * optional). Returns { status } with error and hint cut to 1 000 characters, cursor and scan or
 * undefined, or { error } with a German message.
 */
function parseStatus(value) {
  if (!isPlainObject(value)) {
    return { error: 'Kein gültiger Status.' };
  }
  var status = { error: '', hint: undefined, cursor: undefined, scan: undefined };
  if (value.scan !== undefined && value.scan !== null) {
    var scan = parseScan(value.scan);
    if (scan.error) {
      return { error: scan.error };
    }
    status.scan = scan.scan;
  }
  if (value.error !== undefined && value.error !== null) {
    if (typeof value.error !== 'string') {
      return { error: 'Feld error ist ungültig.' };
    }
    status.error = value.error.slice(0, LIMITS.text);
  }
  if (value.hint !== undefined && value.hint !== null) {
    if (typeof value.hint !== 'string') {
      return { error: 'Feld hint ist ungültig.' };
    }
    status.hint = value.hint.slice(0, LIMITS.text);
  }
  if (value.cursor !== undefined && value.cursor !== null) {
    if (typeof value.cursor !== 'string' || (value.cursor !== '' && !CURSOR.test(value.cursor))) {
      return { error: 'Cursor muss UIDVALIDITY:UID sein.' };
    }
    status.cursor = value.cursor;
  }
  return { status: status };
}

/**
 * What the helper learns about a mail connection: no owner, no secret, only the name of its
 * variable (ADR-0018). `record` holds the plain values of the connection.
 */
function connectionView(record, keywords, connectionRules) {
  var mail = connectionRules.mailSettingsOf(record.settings);
  return {
    id: record.id,
    label: record.label,
    provider: mail.provider,
    user: mail.user,
    secret_env: record.secret_env,
    keywords: connectionRules.keywordsOf(record.settings, keywords),
    match_body: mail.matchBody,
    cursor: record.cursor,
    scan: isPlainObject(record.scan) && record.scan.signature !== undefined ? parseScan(record.scan).scan || null : null
  };
}

module.exports = {
  TOKEN_ENV: TOKEN_ENV,
  ORIGINS: ORIGINS,
  META_KEYS: META_KEYS,
  CURSOR: CURSOR,
  UNMATCHED_MESSAGE: UNMATCHED_MESSAGE,
  bearerToken: bearerToken,
  tokenMatches: tokenMatches,
  parseDraft: parseDraft,
  keywordDecision: keywordDecision,
  SCAN_STATES: SCAN_STATES,
  parseStatus: parseStatus,
  parseScan: parseScan,
  mergeScan: mergeScan,
  cancelledScan: cancelledScan,
  connectionView: connectionView
};
