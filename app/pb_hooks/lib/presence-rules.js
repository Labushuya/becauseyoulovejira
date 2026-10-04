// Pure rules of the presence and attention routes (ADR-0035 section 4; plan start-fenster, SF-1):
// who may ask, which reasons and nonces are valid, when an entry expires and how often a message may
// go out. CommonJS module, ES5 only, no dependencies (Goja runtime and Vitest load it the same way).
'use strict';

// Realtime topic the app tabs subscribe to (ADR-0007: same SSE connection as the other stores).
var TOPIC = 'byl/attention';

// Why a message goes out: start.bat found an open tab, the landing page (file://) found one, or
// stop.bat ends the app.
var REASONS = ['start', 'datei', 'stop'];

// $security.randomString(24): letters and digits only, so a nonce can go into a URL unescaped.
var NONCE_LENGTH = 24;
var NONCE = /^[A-Za-z0-9]{24}$/;

// Entries older than this are removed by every call (the state lives in memory only).
var ENTRY_TTL_MS = 60000;
// At most one message per this gap, otherwise 429.
var MIN_GAP_MS = 2000;

// Keys in $app.store(); the prefix keeps them apart from PocketBase's own entries.
var ENTRY_PREFIX = 'byl.attention.';
var LANDING_KEY = 'byl.landing-seen-at';
var LAST_SENT_KEY = 'byl.attention-last-at';

function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * Who sends a request, from its headers:
 *   'control' - no Origin and no Sec-Fetch-Site or Sec-Fetch-Mode: a script such as byl-control.ps1
 *               (every current browser sends the Sec-Fetch headers, also for navigations),
 *   'file'    - Origin "null": the landing page opened per file:// (also sandboxed frames; see the
 *               security section of ADR-0035),
 *   'browser' - anything else, e.g. a web page or the app itself.
 */
function requestKind(origin, secFetchSite, secFetchMode) {
  var from = text(origin);
  if (from === '' && text(secFetchSite) === '' && text(secFetchMode) === '') {
    return 'control';
  }
  if (from === 'null') {
    return 'file';
  }
  return 'browser';
}

/** Whether the direct peer is this machine (the routes are for local scripts and pages only). */
function isLoopback(ip) {
  var value = text(ip).toLowerCase();
  return (
    /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(value) ||
    value === '::1' ||
    value === '0000:0000:0000:0000:0000:0000:0000:0001' ||
    /^::ffff:127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(value)
  );
}

/** Whether `kind` may use `route` ('presence' only for scripts, 'attention' also for file://). */
function allows(route, kind) {
  if (route === 'presence') {
    return kind === 'control';
  }
  if (route === 'attention') {
    return kind === 'control' || kind === 'file';
  }
  return false;
}

function isReason(value) {
  return typeof value === 'string' && REASONS.indexOf(value) !== -1;
}

function isNonce(value) {
  return typeof value === 'string' && NONCE.test(value);
}

function isTime(value) {
  return typeof value === 'number' && isFinite(value);
}

/** Whether an entry created at `createdAt` is gone at `now` (a clock that went back expires it). */
function isExpired(createdAt, now) {
  if (!isTime(createdAt) || !isTime(now)) {
    return true;
  }
  return now - createdAt > ENTRY_TTL_MS || now < createdAt;
}

/** Whether a message may go out at `now` after the last one at `lastAt` (none: yes). */
function mayNotify(lastAt, now) {
  if (!isTime(lastAt)) {
    return true;
  }
  return now - lastAt >= MIN_GAP_MS || now < lastAt;
}

/** Milliseconds since the landing page reported, or null without a report within the TTL. */
function landingAgo(seenAt, now) {
  if (isExpired(seenAt, now)) {
    return null;
  }
  return now - seenAt;
}

/**
 * Text for the store: creation time, whether a tab confirmed, and the accounts whose tabs got the
 * message (since E7-1, ADR-0056 §6: only they may confirm it).
 */
function serializeEntry(createdAt, acked, users) {
  return JSON.stringify({ createdAt: createdAt, acked: acked === true, users: accountList(users) });
}

/** The distinct account IDs of `users` (strings only). */
function accountList(users) {
  var list = [];
  var values = Object.prototype.toString.call(users) === '[object Array]' ? users : [];
  for (var i = 0; i < values.length; i++) {
    if (typeof values[i] === 'string' && values[i] !== '' && list.indexOf(values[i]) === -1) {
      list.push(values[i]);
    }
  }
  return list;
}

/** Whether the account `userId` may confirm the message of `entry`: one of its tabs got it. */
function mayAck(entry, userId) {
  return entry !== null && typeof userId === 'string' && userId !== '' && entry.users.indexOf(userId) !== -1;
}

/** The entry of the store, or null for anything that is not one. */
function parseEntry(raw) {
  if (typeof raw !== 'string') {
    return null;
  }
  var value;
  try {
    value = JSON.parse(raw);
  } catch (err) {
    return null;
  }
  if (value === null || typeof value !== 'object' || !isTime(value.createdAt)) {
    return null;
  }
  return { createdAt: value.createdAt, acked: value.acked === true, users: accountList(value.users) };
}

/** Data of the realtime message: only the nonce and the reason, nothing about accounts or data. */
function messageData(nonce, reason) {
  return JSON.stringify({ nonce: nonce, reason: reason });
}

module.exports = {
  TOPIC: TOPIC,
  REASONS: REASONS,
  NONCE_LENGTH: NONCE_LENGTH,
  ENTRY_TTL_MS: ENTRY_TTL_MS,
  MIN_GAP_MS: MIN_GAP_MS,
  ENTRY_PREFIX: ENTRY_PREFIX,
  LANDING_KEY: LANDING_KEY,
  LAST_SENT_KEY: LAST_SENT_KEY,
  requestKind: requestKind,
  isLoopback: isLoopback,
  allows: allows,
  isReason: isReason,
  isNonce: isNonce,
  isExpired: isExpired,
  mayNotify: mayNotify,
  landingAgo: landingAgo,
  serializeEntry: serializeEntry,
  parseEntry: parseEntry,
  mayAck: mayAck,
  messageData: messageData
};
