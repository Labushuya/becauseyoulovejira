// Pure rules of the error log of the server (FP-2, ADR-0077): what an entry of problem_events may
// hold, how a text is cleaned, when two failures are the same entry, who sees which area and which
// failures of a request count as unexpected. lib/problem-service.js writes the entries; nothing
// else does. CommonJS module, ES5 only, no dependencies (Goja runtime and Vitest load it the same
// way).
//
// Privacy (ADR-0077 §4): an entry never holds a body, a header, a cookie, a token, a password, access
// data or the content of a message or a mail. Every text passes cleanMessage, the context keeps only
// the keys of CONTEXT_KEYS with values of a fixed shape.
'use strict';

// Limits (ADR-0077 §3): an entry goes 30 days after its last occurrence, at most 5000 stay (the
// oldest by last occurrence go first), a message keeps 300 characters, a code 60, a route 200.
var RETENTION_DAYS = 30;
var MAX_ROWS = 5000;
var MESSAGE_MAX = 300;
var CODE_MAX = 60;
var ROUTE_MAX = 200;
var DAY_MS = 24 * 60 * 60 * 1000;

// The header of an answer with an unexpected failure that names its entry (the SPA takes it as
// Server-ID).
var HEADER = 'X-Byl-Problem';
// The code of a failure of the app that PocketBase answers with 400 (ADR-0077 §2); only it keeps the
// status 400 in its context.
var UNEXPECTED_400 = 'http_400_unexpected';

/** Where a failure came from: a request (API and hooks), a channel in the background, another job. */
var SOURCES = ['request', 'channel', 'job'];
/** Who sees an entry: only its owner, the members of its household, the administrator of the app. */
var AREAS = ['private', 'household', 'system'];
/** The only keys of the context; each value has a fixed shape (contextOf). */
var CONTEXT_KEYS = ['connection', 'channel', 'rule', 'job', 'method', 'route', 'status'];
var CHANNELS = ['calendar', 'telegram', 'mail', 'notion', 'github', 'folder'];
var METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];
// Answers the app writes or throws on purpose with this status: 502 (another service or the control
// script answered badly) and 503 ("after the next restart"). They are no unexpected failure.
var DELIBERATE_STATUSES = [502, 503];

var REDACTED = '[entfernt]';
var EMAIL_MARK = '[E-Mail]';
var ID_PATTERN = /^[a-z0-9]{15}$/;
var JOB_PATTERN = /^[a-z][a-z0-9-]{0,39}$/;
var CODE_PATTERN = /[^A-Za-z0-9_.:-]+/g;

// --- Cleaning ------------------------------------------------------------------------------------

var JWT = /\beyJ[\w-]+\.[\w-]+\.[\w-]+/g;
var SCHEME_VALUE = /\b(Bearer|Basic|Token)\s+[^\s"',;]+/gi;
var AUTH_HEADER = /\b(authorization|proxy-authorization|x-api-key|api-key)\s*:\s*(?:(?:Bearer|Basic|Token)\s+)?[^\s"',;]+/gi;
var COOKIE_HEADER = /\b(cookie|set-cookie)\s*[:=][^\n]*/gi;
// name=value with a name that holds a secret, also inside a longer name (bot_token=, X-Api-Key=).
var SECRET_ASSIGNMENT =
  /\b([\w-]*(?:token|secret|passwor[dt]|passphrase|pass|pwd|api[_-]?key|apikey|access[_-]?key|auth|key|code|sig|signature|session|credentials?))\s*=\s*("[^"]*"|'[^']*'|[^\s&"',;]+)/gi;
// "password": "x" and password: x for the names that are always a secret.
var SECRET_JSON =
  /("[\w-]*(?:token|secret|passwor[dt]|passphrase|api[_-]?key|apikey|access[_-]?key|credentials?)"\s*:\s*)("[^"]*"|[^\s,}]+)/gi;
var SECRET_LABEL = /\b((?:token|secret|passwor[dt]|passphrase|api[_-]?key|apikey|access[_-]?key|credentials?))\s*:\s*([^\s"',;]+)/gi;
// A query after a URL or a path: `…/x?token=1` keeps `…/x`. Unlike the SPA (domain/problems.ts) it
// goes on over quotes up to the next white space, so a quoted value in a query goes with it.
var QUERY_AFTER_PATH = /((?:[a-z][a-z\d+.-]*:\/\/|\/)[^\s?#"'<>]*)\?[^\s#<>]*/gi;
var URL_USERINFO = /\b([a-z][a-z\d+.-]*:\/\/)[^\s\/?#@"'<>]*@/gi;
var EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;
// Tokens of the services of the app wherever they stand (lib/secrets.js has the same shapes).
var TELEGRAM_TOKEN = /\b\d{5,}:[A-Za-z0-9_-]{30,}/g;
var NOTION_TOKEN = /\b(?:ntn|secret)_[A-Za-z0-9]{30,}/g;
var GITHUB_TOKEN = /\b(?:github_pat_[A-Za-z0-9_]{20,}|gh[pousr]_[A-Za-z0-9]{20,})/g;
var INBOX_KEY = /\bbyl_[A-Za-z0-9]{20,}/g;
// Anything else that looks like a key: 40 and more characters of letters, digits, _, + and -, or 32
// and more of them with letters and digits mixed (a hex or Base64 key; an ID of PocketBase has 15, a
// word no digit).
var LONG_TOKEN = /\b[A-Za-z0-9_+-]{40,}={0,2}/g;
var MIXED_TOKEN = /\b(?=[A-Za-z0-9_+-]*[0-9])(?=[A-Za-z0-9_+-]*[A-Za-z])[A-Za-z0-9_+-]{32,}={0,2}/g;
// Paths of this computer: only the name of the file stays (no user name of Windows).
var WINDOWS_PATH = /(?:\b[A-Za-z]:|\\\\[^\\\s"'<>]+)[\\\/][^\s"'<>]*/g;
var UNIX_HOME_PATH = /(?:^|[\s(])\/(?:home|Users|root|tmp|private|var|mnt|media|opt|srv)\/[^\s"'<>)]*/g;
// Quoted parts often hold content (a title, a line of a calendar): they become "…" and „…“, and the
// same for single quotes (only after the start, white space or an opening sign, so the apostrophe of
// "geht's" stays, and one before a letter belongs to the word inside), guillemets (\u00BB…\u00AB)
// and low single quotes (\u201A…\u2018).
var DOUBLE_QUOTED = /"[^"\n]*"/g;
var GERMAN_QUOTED = /„[^“\n]*“/g;
var SINGLE_QUOTED = /(^|[\s(\[{:=,;])'(?:[^'\n]|'(?=[A-Za-z\u00C0-\u024F])){1,300}'/g;
var GUILLEMETS = /\u00BB[^\u00AB\n]*\u00AB/g;
var LOW_SINGLE_QUOTED = /\u201A[^\u2018\n]*\u2018/g;

function text(value) {
  return value === undefined || value === null ? '' : String(value);
}

function shorten(value, max) {
  return value.length > max ? value.slice(0, max - 1) + '…' : value;
}

function lastSegment(path) {
  var parts = path.split(/[\\\/]/);
  for (var i = parts.length - 1; i >= 0; i--) {
    if (parts[i] !== '') {
      return parts[i];
    }
  }
  return '';
}

/**
 * A text for an entry: only its first line, without "GoError: ", tokens, bearer and basic values,
 * secrets in `name=value` and in JSON, cookies, the query after a URL or a path, the user of a URL,
 * e-mail addresses, the paths of this computer (only the file name stays) and quoted content;
 * white space collapsed, at most `max` characters (MESSAGE_MAX).
 */
function cleanMessage(value, max) {
  var limit = typeof max === 'number' && max > 0 ? max : MESSAGE_MAX;
  var line = text(value).split(/\r?\n/)[0].replace(/^\s*GoError:\s*/, '');
  var clean = line
    .replace(JWT, REDACTED)
    .replace(COOKIE_HEADER, '$1: ' + REDACTED)
    .replace(AUTH_HEADER, '$1: ' + REDACTED)
    .replace(SCHEME_VALUE, '$1 ' + REDACTED)
    .replace(SECRET_JSON, '$1"' + REDACTED + '"')
    .replace(SECRET_ASSIGNMENT, '$1=' + REDACTED)
    .replace(SECRET_LABEL, '$1: ' + REDACTED)
    .replace(QUERY_AFTER_PATH, '$1')
    .replace(URL_USERINFO, '$1')
    .replace(EMAIL, EMAIL_MARK)
    .replace(TELEGRAM_TOKEN, REDACTED)
    .replace(NOTION_TOKEN, REDACTED)
    .replace(GITHUB_TOKEN, REDACTED)
    .replace(INBOX_KEY, REDACTED)
    .replace(LONG_TOKEN, REDACTED)
    .replace(MIXED_TOKEN, REDACTED)
    .replace(WINDOWS_PATH, function (path) {
      return '…\\' + lastSegment(path);
    })
    .replace(UNIX_HOME_PATH, function (path) {
      var lead = /^[\s(]/.test(path) ? path.charAt(0) : '';
      return lead + '…/' + lastSegment(path);
    })
    .replace(DOUBLE_QUOTED, '"…"')
    .replace(GERMAN_QUOTED, '„…“')
    .replace(SINGLE_QUOTED, "$1'…'")
    .replace(GUILLEMETS, '\u00BB…\u00AB')
    .replace(LOW_SINGLE_QUOTED, '\u201A…\u2018')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^\s+|\s+$/g, '');
  return shorten(clean, limit);
}

/** A code of the server: letters, digits and `_.:-`, at most CODE_MAX characters. */
function cleanCode(value) {
  return shorten(text(value).replace(CODE_PATTERN, '_').replace(/^_+|_+$/g, ''), CODE_MAX);
}

// --- Routes and the context ----------------------------------------------------------------------

// A file of a record: /api/files/<collection>/<record>/<file name>; the name is content.
var FILES_ROUTE = /^\/api\/files\/[^\/]+\/[^\/]+\/./;

/**
 * Path of a request without origin, query and hash, at most ROUTE_MAX characters; under /api/files/
 * the file name (also percent-encoded) is `*`.
 */
function routeOf(path) {
  var rest = text(path).replace(/^\s+|\s+$/g, '');
  var origin = /^[a-z][a-z\d+.-]*:\/\/[^\/?#]*/i.exec(rest);
  if (origin !== null) {
    rest = rest.slice(origin[0].length);
  }
  var cut = rest.search(/[?#]/);
  if (cut !== -1) {
    rest = rest.slice(0, cut);
  }
  rest = rest.replace(/[^A-Za-z0-9\/._~%{}*-]/g, '_');
  if (rest.charAt(0) !== '/') {
    rest = '/' + rest;
  }
  if (FILES_ROUTE.test(rest)) {
    // '', 'api', 'files', collection, record: everything after them is the name of the file.
    rest = rest.split('/').slice(0, 5).join('/') + '/*';
  }
  return rest.length > ROUTE_MAX ? rest.slice(0, ROUTE_MAX) : rest;
}

/** Whether a segment is an ID of PocketBase (15 characters a-z0-9 with a digit) or a number. */
function isIdLike(segment) {
  return (ID_PATTERN.test(segment) && /\d/.test(segment)) || /^\d+$/.test(segment);
}

/** The route with every ID and number as `*`, so the same failure on two tickets is one entry. */
function routePattern(route) {
  var parts = text(route).split('/');
  for (var i = 0; i < parts.length; i++) {
    if (isIdLike(parts[i])) {
      parts[i] = '*';
    }
  }
  return parts.join('/');
}

/**
 * The context of an entry with only the keys of CONTEXT_KEYS: `connection` and `rule` as IDs,
 * `channel` a kind of connection, `job` a short name, `method` an HTTP method, `route` a path
 * without query (routeOf), `status` a status from 500 to 599, or 400 for the code `code` of
 * UNEXPECTED_400 only. Everything else is dropped.
 */
function contextOf(input, code) {
  var source = input !== null && typeof input === 'object' ? input : {};
  var context = {};
  if (ID_PATTERN.test(text(source.connection))) {
    context.connection = text(source.connection);
  }
  if (CHANNELS.indexOf(text(source.channel)) !== -1) {
    context.channel = text(source.channel);
  }
  if (ID_PATTERN.test(text(source.rule))) {
    context.rule = text(source.rule);
  }
  if (JOB_PATTERN.test(text(source.job))) {
    context.job = text(source.job);
  }
  var method = text(source.method).toUpperCase();
  if (METHODS.indexOf(method) !== -1) {
    context.method = method;
  }
  if (text(source.route) !== '') {
    context.route = routeOf(source.route);
  }
  var status = Number(source.status);
  if ((Math.floor(status) === status && status >= 500 && status <= 599) || (status === 400 && cleanCode(code) === UNEXPECTED_400)) {
    context.status = status;
  }
  return context;
}

// --- The same failure ----------------------------------------------------------------------------

var ISO_TIME = /\b\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?/g;
var DATE = /\b\d{4}-\d{2}-\d{2}\b|\b\d{1,2}\.\d{1,2}\.\d{2,4}\b/g;
var CLOCK = /\b\d{1,2}:\d{2}(?::\d{2}(?:\.\d+)?)?\b/g;
var UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
var HEX = /\b(?=[0-9a-f]*\d)[0-9a-f]{8,}\b/gi;
var POCKETBASE_ID = /\b(?=[a-z0-9]*\d)(?=[a-z0-9]*[a-z])[a-z0-9]{15}\b/g;
var NUMBER = /\d+/g;

/**
 * A message with times, dates, IDs, hex values and numbers neutralised: two failures that differ
 * only in these are the same.
 */
function normalizeMessage(value) {
  return text(value)
    .replace(ISO_TIME, '{zeit}')
    .replace(DATE, '{datum}')
    .replace(CLOCK, '{zeit}')
    .replace(UUID, '{id}')
    .replace(POCKETBASE_ID, '{id}')
    .replace(HEX, '{id}')
    .replace(NUMBER, '#');
}

/**
 * What makes two failures one entry: source, area, owner and household, code, the normalised
 * message and the keys of the context (the route with `*` for IDs). The service takes its SHA-256.
 */
function fingerprintSource(event) {
  var context = event.context || {};
  return JSON.stringify([
    text(event.source),
    text(event.area),
    text(event.owner),
    text(event.household),
    text(event.code),
    normalizeMessage(event.message),
    text(context.connection),
    text(context.channel),
    text(context.rule),
    text(context.job),
    text(context.method),
    context.route === undefined ? '' : routePattern(context.route),
    context.status === undefined ? '' : String(context.status)
  ]);
}

/**
 * An entry as it is stored, or null when it is none: source and area of the lists, the owner only
 * in the private area, the household only in its area, the cleaned code, message and context, and
 * the time `at` in the form of PocketBase.
 */
function eventOf(input, now) {
  var source = input !== null && typeof input === 'object' ? input : {};
  if (SOURCES.indexOf(text(source.source)) === -1 || AREAS.indexOf(text(source.area)) === -1) {
    return null;
  }
  var area = text(source.area);
  var owner = area === 'private' ? text(source.owner) : '';
  var household = area === 'household' ? text(source.household) : '';
  if ((area === 'private' && !ID_PATTERN.test(owner)) || (area === 'household' && !ID_PATTERN.test(household))) {
    return null;
  }
  return {
    source: text(source.source),
    area: area,
    owner: owner,
    household: household,
    code: cleanCode(source.code),
    message: cleanMessage(source.message),
    context: contextOf(source.context, source.code),
    at: pocketBaseTime(now)
  };
}

/** The area of a record with owner and household: the household if it has one, else private. */
function areaOf(owner, household) {
  if (text(household) !== '') {
    return { area: 'household', owner: '', household: text(household) };
  }
  return { area: 'private', owner: text(owner), household: '' };
}

// --- Failures of a request -----------------------------------------------------------------------

/** The objects that may carry status and message: the thrown value and the error it wraps. */
function holdersOf(err) {
  var list = [];
  if (err !== null && typeof err === 'object') {
    list.push(err);
    if (err.value !== null && typeof err.value === 'object') {
      list.push(err.value);
    }
  }
  return list;
}

// What PocketBase 0.40.4 answers with 404 instead of 400 (ToApiError: sql.ErrNoRows, fs.ErrNotExist).
var NOT_FOUND = /no rows in result set|file does not exist|no such file or directory|cannot find the (?:file|path) specified/i;
// A request the client cancelled (context.Canceled of Go).
var CANCELLED = /\bcontext canceled\b/;
// A body that is too large or cannot be read: the JSON of PocketBase 0.40.4 fails with "jsontext: …"
// or "json: …", a form with "multipart"/"mime: …"/an escape of the URL.
var UNREADABLE_BODY = /^(?:jsontext|json|mime): |multipart|request body too large|entity too large|invalid URL escape|invalid semicolon separator/i;
// The record API answers a failed save of create and update with these messages (apis/record_crud.go of
// PocketBase 0.40.4); the check of its create rule uses the first one too, with "create rule …" or
// "dummy DBExport …" behind it.
var RECORD_SAVE = /^Failed to (?:create|update) record\.$/;
var RULE_CHECK = /^(?:create rule|dummy DBExport)/;

/** The ApiError of a thrown value, also wrapped in a GoError (`value`), or null. */
function apiErrorOf(err) {
  var holders = holdersOf(err);
  for (var i = 0; i < holders.length; i++) {
    if (typeof holders[i].status === 'number') {
      return holders[i];
    }
  }
  return null;
}

/** The error of Go behind a thrown value (`value` of a GoError), or null for a value of JavaScript. */
function goErrorOf(err) {
  return err !== null && typeof err === 'object' && err.value !== null && typeof err.value === 'object' ? err.value : null;
}

/** Whether the data of an ApiError holds field errors; when in doubt yes. */
function hasFieldErrors(data) {
  try {
    return data !== null && typeof data === 'object' && Object.keys(data).length > 0;
  } catch (err) {
    return true;
  }
}

/**
 * Whether a refused save of the record API (400 "Failed to create record." or "Failed to update
 * record." without field errors) failed in the app: an error of a model hook or of the database behind
 * it. Not the check of the create rule, no ApiError behind it, nothing missing, no cancelled request.
 */
function isFailedSave(apiError) {
  if (apiError.status !== 400 || !RECORD_SAVE.test(text(apiError.message)) || hasFieldErrors(apiError.data)) {
    return false;
  }
  try {
    var raw = typeof apiError.rawData === 'function' ? apiError.rawData() : null;
    if (raw === null || raw === undefined || (typeof raw === 'object' && typeof raw.status === 'number')) {
      return false;
    }
    var rawText = text(raw);
    return rawText !== '' && rawText !== '<nil>' && !RULE_CHECK.test(rawText) && !NOT_FOUND.test(rawText) && !CANCELLED.test(rawText);
  } catch (err) {
    return false;
  }
}

/** Whether a request that ended with `status` failed unexpectedly: 5xx except the deliberate ones. */
function isUnexpectedStatus(status) {
  return typeof status === 'number' && status >= 500 && status <= 599 && DELIBERATE_STATUSES.indexOf(status) === -1;
}

/**
 * How the error log takes a failed request (ADR-0077 §2), from what PocketBase 0.40.4 answers (ToApiError
 * of its router): `{ code, status }` of its entry, or null when the failure is expected.
 * - An ApiError (also in a GoError) with 500 to 599 except the deliberate 502 and 503: `http_<status>`.
 * - A thrown value without the status of an ApiError, which PocketBase answers with 400 ("Something went
 *   wrong …"): an Error, TypeError or RangeError of a hook, a failure() of a client, an error of Go from
 *   save() or the database ("database is locked"): UNEXPECTED_400. Not an error of Go that is a
 *   validation (`isValidation(goError)`: PocketBase answers it with field errors), a missing record or
 *   file (404), a cancelled request or a body that is too large or cannot be read.
 * - An ApiError 400 of the record API whose save failed (isFailedSave), e.g. an Error of a model hook
 *   behind "Failed to create record.": UNEXPECTED_400.
 * Any other ApiError (4xx, the deliberate 502 and 503) is expected.
 */
function requestFailureOf(err, isValidation) {
  var apiError = apiErrorOf(err);
  if (apiError !== null) {
    if (isUnexpectedStatus(apiError.status)) {
      return { code: 'http_' + apiError.status, status: apiError.status };
    }
    return isFailedSave(apiError) ? { code: UNEXPECTED_400, status: 400 } : null;
  }
  var goError = goErrorOf(err);
  if (goError !== null) {
    var message = errorText(err);
    if (NOT_FOUND.test(message) || CANCELLED.test(message) || UNREADABLE_BODY.test(message) || isValidation(goError)) {
      return null;
    }
  }
  return { code: UNEXPECTED_400, status: 400 };
}

/** The text of a thrown error: its message and, for an ApiError of PocketBase, the error behind it. */
function errorText(err) {
  if (err === null || err === undefined) {
    return '';
  }
  if (typeof err !== 'object') {
    return text(err);
  }
  var main = typeof err.message === 'string' && err.message !== '' ? err.message : text(err);
  var holders = holdersOf(err);
  for (var i = 0; i < holders.length; i++) {
    if (typeof holders[i].rawData !== 'function') {
      continue;
    }
    try {
      var raw = holders[i].rawData();
      var rawText = raw === null || raw === undefined ? '' : text(raw);
      if (rawText !== '' && rawText !== '<nil>' && main.indexOf(rawText) === -1) {
        return main + ': ' + rawText;
      }
    } catch (ignored) {
      // Without the error behind it the message alone stays.
    }
  }
  return main;
}

/** Time in the form of PocketBase, `YYYY-MM-DD HH:MM:SS.mmmZ`. */
function pocketBaseTime(ms) {
  return new Date(ms).toISOString().replace('T', ' ');
}

module.exports = {
  RETENTION_DAYS: RETENTION_DAYS,
  MAX_ROWS: MAX_ROWS,
  MESSAGE_MAX: MESSAGE_MAX,
  CODE_MAX: CODE_MAX,
  ROUTE_MAX: ROUTE_MAX,
  DAY_MS: DAY_MS,
  HEADER: HEADER,
  UNEXPECTED_400: UNEXPECTED_400,
  SOURCES: SOURCES,
  AREAS: AREAS,
  CONTEXT_KEYS: CONTEXT_KEYS,
  DELIBERATE_STATUSES: DELIBERATE_STATUSES,
  REDACTED: REDACTED,
  EMAIL_MARK: EMAIL_MARK,
  cleanMessage: cleanMessage,
  cleanCode: cleanCode,
  routeOf: routeOf,
  routePattern: routePattern,
  contextOf: contextOf,
  normalizeMessage: normalizeMessage,
  fingerprintSource: fingerprintSource,
  eventOf: eventOf,
  areaOf: areaOf,
  isUnexpectedStatus: isUnexpectedStatus,
  requestFailureOf: requestFailureOf,
  errorText: errorText,
  pocketBaseTime: pocketBaseTime
};
