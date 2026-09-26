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

var ID = /^[a-z0-9]{15}$/;
// Cursor of a mailbox: UIDVALIDITY:UID (ADR-0016 section 5), both unsigned 32-bit numbers.
var CURSOR = /^\d{1,10}:\d{1,10}$/;

var LIMITS = {
  title: 1000,
  body: 100000,
  sourceRef: 500,
  sourceDate: 40,
  text: 1000
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
  var meta = {};
  var given = value.source_meta || {};
  for (var i = 0; i < META_KEYS.length; i++) {
    var key = META_KEYS[i];
    if (Object.prototype.hasOwnProperty.call(given, key)) {
      meta[key] = given[key];
    }
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
      meta: meta
    }
  };
}

/**
 * The keyword of a mail connection that matches the draft (subject, sender from source_meta.from,
 * with match_body also the first 500 characters of the text; ADR-0020 and addendum).
 * { accepted, keyword }: "auto" needs a keyword, "selected" does not; the keyword is kept in both
 * cases.
 */
function keywordDecision(origin, settings, draft, keywords, connectionRules) {
  var list = connectionRules.keywordsOf(settings, keywords);
  var mail = connectionRules.mailSettingsOf(settings);
  var from = draft.meta && typeof draft.meta.from === 'string' ? draft.meta.from : '';
  var keyword = keywords.matchKeyword(list, keywords.mailTexts(draft.title, draft.body, mail.matchBody, from));
  return { accepted: origin === 'selected' || keyword !== '', keyword: keyword };
}

/**
 * Checks the status report of the helper: { error, hint, cursor } (strings; cursor optional).
 * Returns { status } with error and hint cut to 1 000 characters and cursor or undefined, or
 * { error } with a German message.
 */
function parseStatus(value) {
  if (!isPlainObject(value)) {
    return { error: 'Kein gültiger Status.' };
  }
  var status = { error: '', hint: undefined, cursor: undefined };
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
    cursor: record.cursor
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
  parseStatus: parseStatus,
  connectionView: connectionView
};
