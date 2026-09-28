// Pure rules of the own inbox with access keys (ADR-0038; plan eigener-eingang-whatsapp-web,
// EI-1): the shape of a key, its name, the payload of POST /api/byl/inbox/ingest, the keyword
// decision, the rate limit per key and which browser origins may call. CommonJS module, ES5 only,
// no dependencies: keywords.js is passed in by the caller (Goja runtime and Vitest load it the
// same way).
'use strict';

// A key is "byl_" and 40 random characters of the alphabet (about 238 bits). Only its SHA-256
// is stored; the first 8 characters ("byl_" and 4 random ones) tell keys apart in the list.
var TOKEN_PREFIX = 'byl_';
var TOKEN_RANDOM_LENGTH = 40;
var TOKEN_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
var TOKEN_PATTERN = /^byl_[A-Za-z0-9]{40}$/;
var HINT_LENGTH = 8;

var NAME_MAX_LENGTH = 60;
var MAX_KEYS_PER_USER = 20;

// Channels a key may fill and how an entry comes in: "manual" (chosen by the user, always taken)
// or "auto" (found automatically, only with a keyword of the channel).
var CHANNELS = ['api', 'whatsapp-web'];
var MODES = ['manual', 'auto'];
// Kind of the entry per channel (symbol and presets only, ADR-0012).
var KINDS = { api: 'todo', 'whatsapp-web': 'message' };

var LIMITS = {
  title: 1000,
  text: 100000,
  url: 2000,
  sender: 200,
  chat: 200,
  externalId: 200,
  sentAt: 40
};

// Requests per key and minute; more are refused with 429 until the minute is over.
var RATE_WINDOW_MS = 60000;
var RATE_MAX = 60;
// "zuletzt benutzt" is written at most once a minute per key.
var LAST_USED_INTERVAL_MS = 60000;

var MESSAGES = {
  name: 'Bitte einen Namen mit 1 bis 60 Zeichen eingeben.',
  tooMany: 'Höchstens 20 Zugangsschlüssel. Widerrufe zuerst einen alten.',
  payload: 'Kein gültiger Eintrag (JSON-Objekt erwartet).',
  channel: 'channel muss api oder whatsapp-web sein.',
  mode: 'mode muss manual oder auto sein.',
  text: 'text fehlt oder ist länger als 100.000 Zeichen.',
  title: 'title ist ungültig oder länger als 1.000 Zeichen.',
  url: 'url muss eine http- oder https-Adresse mit höchstens 2.000 Zeichen sein.',
  sender: 'sender ist ungültig oder länger als 200 Zeichen.',
  chat: 'chat ist ungültig oder länger als 200 Zeichen.',
  sentAt: 'sent_at muss ein Zeitpunkt nach ISO 8601 mit Zeitzone sein, z. B. 2026-09-28T14:30:00+02:00.',
  externalId: 'external_id fehlt oder ist länger als 200 Zeichen (ohne Zeilenumbruch).',
  filtered: 'Kein Stichwort erkannt – nicht gespeichert.',
  rate: 'Zu viele Anfragen mit diesem Zugangsschlüssel. Bitte in einer Minute erneut versuchen.',
  origin: 'Anfragen aus Webseiten sind nicht erlaubt.',
  token: 'Zugangsschlüssel fehlt, ist ungültig oder wurde widerrufen.'
};

// ISO 8601 with a time zone: date, "T", hours and minutes, optional seconds and fraction.
var ISO_WITH_ZONE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,9})?)?(Z|[+-]\d{2}:\d{2})$/;
// Control characters except tab, line feed and carriage return.
var CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;
// Chrome and Edge give every extension an ID of 32 letters a to p.
var EXTENSION_ORIGIN = /^chrome-extension:\/\/[a-p]{32}$/;

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && Object.prototype.toString.call(value) === '[object Object]';
}

function isBlank(value) {
  return value.replace(/\s+/g, '') === '';
}

function has(value, key) {
  return Object.prototype.hasOwnProperty.call(value, key) && value[key] !== undefined && value[key] !== null;
}

/** Whether `value` looks like a key (prefix, length, alphabet); says nothing about its validity. */
function isTokenShape(value) {
  return typeof value === 'string' && TOKEN_PATTERN.test(value);
}

/** The visible start of a key in the list ("byl_AbCd"). */
function hintOf(token) {
  return String(token).slice(0, HINT_LENGTH);
}

/** The trimmed name of a new key, or { error }. */
function parseName(value) {
  var name = typeof value === 'string' ? value.replace(/\s+/g, ' ').replace(/^ | $/g, '') : '';
  if (name === '' || name.length > NAME_MAX_LENGTH || CONTROL.test(name)) {
    return { error: MESSAGES.name };
  }
  return { name: name };
}

/**
 * Whether a request with this Origin header may use a key: scripts send none, the browser
 * extension sends chrome-extension://<ID>. Web pages (http, https, "null") may not, so a key that
 * leaked into a page cannot be used from the browser of the user.
 */
function originAllowed(origin) {
  var value = typeof origin === 'string' ? origin : '';
  return value === '' || EXTENSION_ORIGIN.test(value);
}

/** The time of an ISO 8601 value with zone in the PocketBase format (UTC), or ''. */
function pocketBaseDate(value) {
  var match = ISO_WITH_ZONE.exec(value);
  if (!match) {
    return '';
  }
  var month = Number(match[2]);
  var day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31 || Number(match[4]) > 23 || Number(match[5]) > 59) {
    return '';
  }
  if (match[6] !== undefined && Number(match[6]) > 59) {
    return '';
  }
  // No 31 April or 29 February outside leap years (Date.parse would roll them over).
  if (new Date(Date.UTC(Number(match[1]), month - 1, day)).getUTCDate() !== day) {
    return '';
  }
  var time = Date.parse(value);
  if (isNaN(time)) {
    return '';
  }
  return new Date(time).toISOString().replace('T', ' ');
}

/** Title of an entry without one: the first non-empty line of the text. */
function titleOf(text) {
  var lines = text.split(/\r\n|\r|\n/);
  for (var i = 0; i < lines.length; i++) {
    if (!isBlank(lines[i])) {
      return lines[i];
    }
  }
  return text;
}

function optionalString(value, key, max) {
  if (!has(value, key)) {
    return { value: '' };
  }
  if (typeof value[key] !== 'string' || value[key].length > max) {
    return { error: true };
  }
  return { value: value[key] };
}

/**
 * Checks the payload of POST /api/byl/inbox/ingest. Returns { draft } with the fields of
 * inbox_items and the mode, or { error } with a German message. Unknown keys are ignored.
 */
function parsePayload(value) {
  if (!isPlainObject(value)) {
    return { error: MESSAGES.payload };
  }
  var channel = has(value, 'channel') ? value.channel : 'api';
  if (CHANNELS.indexOf(channel) === -1) {
    return { error: MESSAGES.channel };
  }
  if (MODES.indexOf(value.mode) === -1) {
    return { error: MESSAGES.mode };
  }
  if (typeof value.text !== 'string' || isBlank(value.text) || value.text.length > LIMITS.text) {
    return { error: MESSAGES.text };
  }
  var title = optionalString(value, 'title', LIMITS.title);
  if (title.error || CONTROL.test(title.value)) {
    return { error: MESSAGES.title };
  }
  var url = optionalString(value, 'url', LIMITS.url);
  if (url.error || (url.value !== '' && !/^https?:\/\/[^\s]+$/i.test(url.value))) {
    return { error: MESSAGES.url };
  }
  var sender = optionalString(value, 'sender', LIMITS.sender);
  if (sender.error || CONTROL.test(sender.value)) {
    return { error: MESSAGES.sender };
  }
  var chat = optionalString(value, 'chat', LIMITS.chat);
  if (chat.error || CONTROL.test(chat.value)) {
    return { error: MESSAGES.chat };
  }
  var sentAt = optionalString(value, 'sent_at', LIMITS.sentAt);
  var sourceDate = sentAt.error || sentAt.value === '' ? '' : pocketBaseDate(sentAt.value);
  if (sentAt.error || (sentAt.value !== '' && sourceDate === '')) {
    return { error: MESSAGES.sentAt };
  }
  var id = value.external_id;
  if (typeof id !== 'string' || isBlank(id) || id.length > LIMITS.externalId || /[\r\n]/.test(id) || CONTROL.test(id)) {
    return { error: MESSAGES.externalId };
  }
  var meta = {};
  if (!isBlank(sender.value)) {
    meta.sender = sender.value;
  }
  if (!isBlank(chat.value)) {
    meta.chat = chat.value;
  }
  return {
    draft: {
      channel: channel,
      mode: value.mode,
      kind: KINDS[channel],
      title: isBlank(title.value) ? titleOf(value.text) : title.value,
      body: value.text,
      source_url: url.value,
      source_ref: id,
      source_date: sourceDate,
      meta: meta
    }
  };
}

/**
 * The keyword of the channel that matches title or text of the draft (users.import_keywords,
 * ADR-0020, the same matching as every channel). { accepted, keyword }: "auto" needs a keyword,
 * "manual" does not; the keyword is kept in both cases.
 */
function keywordDecision(settings, draft, keywords) {
  var list = keywords.importSettingsOf(settings, draft.channel).keywords;
  var keyword = keywords.matchKeyword(list, [draft.title, draft.body]);
  return { accepted: draft.mode === 'manual' || keyword !== '', keyword: keyword };
}

/**
 * Rate limit of one key: `entry` is the stored { start, count } of its window (or anything
 * else), `now` the time in ms. Returns { allowed, entry, retryAfter } with the entry to store and
 * the seconds until the window ends when refused.
 */
function rateDecision(entry, now) {
  var valid =
    isPlainObject(entry) && typeof entry.start === 'number' && typeof entry.count === 'number' &&
    entry.start <= now && now - entry.start < RATE_WINDOW_MS;
  if (!valid) {
    return { allowed: true, entry: { start: now, count: 1 }, retryAfter: 0 };
  }
  if (entry.count >= RATE_MAX) {
    return { allowed: false, entry: entry, retryAfter: Math.ceil((entry.start + RATE_WINDOW_MS - now) / 1000) };
  }
  return { allowed: true, entry: { start: entry.start, count: entry.count + 1 }, retryAfter: 0 };
}

/** Whether "zuletzt benutzt" (ms since epoch, NaN for never) is old enough to be written again. */
function lastUsedDue(lastUsed, now) {
  return isNaN(lastUsed) || now - lastUsed >= LAST_USED_INTERVAL_MS || lastUsed > now;
}

/** Number of keywords per channel of the own inbox, for "Verbindung testen". */
function keywordCounts(settings, keywords) {
  var counts = {};
  for (var i = 0; i < CHANNELS.length; i++) {
    counts[CHANNELS[i]] = keywords.importSettingsOf(settings, CHANNELS[i]).keywords.length;
  }
  return counts;
}

module.exports = {
  TOKEN_PREFIX: TOKEN_PREFIX,
  TOKEN_RANDOM_LENGTH: TOKEN_RANDOM_LENGTH,
  TOKEN_ALPHABET: TOKEN_ALPHABET,
  HINT_LENGTH: HINT_LENGTH,
  NAME_MAX_LENGTH: NAME_MAX_LENGTH,
  MAX_KEYS_PER_USER: MAX_KEYS_PER_USER,
  CHANNELS: CHANNELS,
  MODES: MODES,
  LIMITS: LIMITS,
  RATE_WINDOW_MS: RATE_WINDOW_MS,
  RATE_MAX: RATE_MAX,
  MESSAGES: MESSAGES,
  isTokenShape: isTokenShape,
  hintOf: hintOf,
  parseName: parseName,
  originAllowed: originAllowed,
  pocketBaseDate: pocketBaseDate,
  parsePayload: parsePayload,
  keywordDecision: keywordDecision,
  rateDecision: rateDecision,
  lastUsedDue: lastUsedDue,
  keywordCounts: keywordCounts
};
