// Pure rules of the access data set from the browser (BW-3, ADR-0075): which BYL_* variables the
// page "Kanäle" may set or remove in the Windows user environment, the checks of a value, the
// requests of the routes and the shape of their answers. A value goes only into the user
// environment (ADR-0018), never into a store, a log or an answer: no rule here returns it, its
// length, a part or a hash of it. CommonJS module, ES5 only, no dependencies but secrets.js, which
// the caller passes in (Goja runtime and Vitest load it the same way); the routes live in
// credentials.pb.js with lib/credential-service.js. The same lists and checks stand in
// app/byl-functions.ps1 (Test-BylCredentialName, Test-BylCredentialValue; parity test).
'use strict';

/**
 * Names the system uses for its settings and its behaviour (derived from the code, ADR-0075 §3);
 * never set from the browser, even if a connection names one.
 *   BYL_INGEST_TOKEN          access of the mail helper (ADR-0018 §8), byl-control.ps1 creates it
 *   BYL_HOST_PLATFORM         system of the server (lib/host-platform.js, ADR-0028)
 *   BYL_MAIL_HELPER_PORT      port of the mail helper (lib/mailbox-rules.js, helpers/mail)
 *   BYL_MAIL_INTERVAL_SECONDS interval of the mail helper (helpers/mail/src/config.ts, tests)
 *   BYL_MAIL_TEST_IMAP_PORT   IMAP server of the tests instead of the provider (helpers/mail)
 *   BYL_TELEGRAM_API_BASE     address of the Telegram API (lib/channel-telegram-run.js): a value
 *                             would send every bot token to another server
 *   BYL_APP_URL               address of the app for the landing page (byl-functions.ps1)
 *   BYL_EXIT, BYL_CODE, BYL_DIR, BYL_DIRQ  variables of the .bat files in the folder app
 * and every name with BLOCKED_PREFIXES: the switches of the tests (BYL_TEST_ISOLATED, …).
 */
var BLOCKED = [
  'BYL_INGEST_TOKEN',
  'BYL_HOST_PLATFORM',
  'BYL_MAIL_HELPER_PORT',
  'BYL_MAIL_INTERVAL_SECONDS',
  'BYL_MAIL_TEST_IMAP_PORT',
  'BYL_TELEGRAM_API_BASE',
  'BYL_APP_URL',
  'BYL_EXIT',
  'BYL_CODE',
  'BYL_DIR',
  'BYL_DIRQ'
];
var BLOCKED_PREFIXES = ['BYL_TEST_'];

/**
 * Names the setup of a channel suggests before its connection exists (web/src/lib/domain/
 * connections.ts: DEFAULT_SECRET_NAMES, MAIL_PROVIDER_SECRET_NAMES, DEFAULT_ALLOWLIST_NAME; parity
 * test), each also with the suffix of freeVariableName for a further connection of the kind
 * (BYL_TELEGRAM_TOKEN_2, …).
 */
var SUGGESTED = [
  'BYL_GOOGLE_CALENDAR_URL',
  'BYL_TELEGRAM_TOKEN',
  'BYL_TELEGRAM_ALLOWED_IDS',
  'BYL_WEBDE_PASSWORD',
  'BYL_GMAIL_PASSWORD',
  'BYL_NOTION_TOKEN',
  'BYL_GITHUB_TOKEN'
];
var SUFFIX = /^_(?:[2-9]|[1-9][0-9]{1,2})$/;

// A value: not empty, no control characters (C0 with tab, CR and LF, DEL, C1), at most this many
// characters (UTF-16 code units, as JavaScript and PowerShell count). Never trimmed.
var MAX_VALUE_LENGTH = 4096;
var CONTROL = /[\u0000-\u001f\u007f-\u009f]/;
// Names a status request may add to those of the connections (the suggestion of a setup).
var MAX_EXTRA_NAMES = 20;
// Key in $app.store() of the mark "a change waits for a restart" (time in ms). The store lives in
// the memory of the server: a restart starts without it, so the hint goes by itself (ADR-0075 §5).
var RESTART_NOTICE_KEY = 'byl.credentials.restart-needed';

/** German texts of the problems of a request; each names at most the variable, never a value. */
var MESSAGES = {
  invalid: 'Die Anfrage ist unvollständig.',
  name: 'Nur BYL_ mit Großbuchstaben, Ziffern und _ (höchstens 64 Zeichen).',
  blocked: 'Diese Variable steuert die App selbst und lässt sich hier nicht setzen.',
  unknown: 'Diese Variable nennt kein Kanal dieser App.',
  empty: 'Bitte einen Wert eingeben. Zum Leeren dient „Entfernen“.',
  control: 'Der Wert enthält Steuerzeichen (etwa einen Zeilenumbruch); bitte ohne sie einfügen.',
  long: 'Der Wert ist zu lang (höchstens ' + MAX_VALUE_LENGTH + ' Zeichen).',
  write: 'Windows hat die Variable nicht gespeichert.'
};
var PROBLEMS = ['invalid', 'name', 'blocked', 'unknown', 'empty', 'control', 'long', 'write'];

function isRecord(value) {
  return value !== null && typeof value === 'object' && !(value instanceof Array);
}

function startsWith(text, prefix) {
  return text.slice(0, prefix.length) === prefix;
}

/** Whether `name` belongs to the system (BLOCKED, BLOCKED_PREFIXES). */
function isBlocked(name) {
  if (typeof name !== 'string') {
    return false;
  }
  if (BLOCKED.indexOf(name) !== -1) {
    return true;
  }
  for (var i = 0; i < BLOCKED_PREFIXES.length; i++) {
    if (startsWith(name, BLOCKED_PREFIXES[i])) {
      return true;
    }
  }
  return false;
}

/** Whether `name` is a suggestion of a setup, also with the suffix _2 to _999. */
function isSuggested(name) {
  if (typeof name !== 'string') {
    return false;
  }
  for (var i = 0; i < SUGGESTED.length; i++) {
    var base = SUGGESTED[i];
    if (name === base || (startsWith(name, base) && SUFFIX.test(name.slice(base.length)))) {
      return true;
    }
  }
  return false;
}

/**
 * Why `name` may not be set or removed here, '' if it may: 'name' (not the pattern of ADR-0018),
 * 'blocked' (a name of the system), 'unknown' (no connection of this instance names it and no
 * setup suggests it). `referenced` are the names the connections of this instance read.
 */
function nameProblem(name, referenced, secrets) {
  if (!secrets.isValidName(name)) {
    return 'name';
  }
  if (isBlocked(name)) {
    return 'blocked';
  }
  var list = referenced instanceof Array ? referenced : [];
  return list.indexOf(name) !== -1 || isSuggested(name) ? '' : 'unknown';
}

/** Why `value` may not be set, '' if it may: 'invalid', 'empty' (also only white space), 'control', 'long'. */
function valueProblem(value) {
  if (typeof value !== 'string') {
    return 'invalid';
  }
  if (value.replace(/^\s+|\s+$/g, '') === '') {
    return 'empty';
  }
  if (CONTROL.test(value)) {
    return 'control';
  }
  return value.length > MAX_VALUE_LENGTH ? 'long' : '';
}

/**
 * The body of POST /api/byl/credentials/set: { name, value } with both checked, or { problem }.
 * Nothing else of the body is read.
 */
function setInput(body, referenced, secrets) {
  if (!isRecord(body) || typeof body.name !== 'string') {
    return { problem: 'invalid' };
  }
  var problem = nameProblem(body.name, referenced, secrets) || valueProblem(body.value);
  return problem !== '' ? { problem: problem, name: secrets.isValidName(body.name) ? body.name : '' } : { name: body.name, value: body.value };
}

/** The body of POST /api/byl/credentials/remove: { name } checked, or { problem }. */
function removeInput(body, referenced, secrets) {
  if (!isRecord(body) || typeof body.name !== 'string') {
    return { problem: 'invalid' };
  }
  var problem = nameProblem(body.name, referenced, secrets);
  return problem !== '' ? { problem: problem, name: secrets.isValidName(body.name) ? body.name : '' } : { name: body.name };
}

/**
 * The names of the status: every name of the connections (`referenced`) and the further names of
 * the query (`names=A,B`, at most MAX_EXTRA_NAMES) that a setup may set, sorted, without duplicates.
 * Each with `blocked` when it belongs to the system (then its state is not read).
 */
function statusNames(query, referenced, secrets) {
  var names = [];
  var add = function (name) {
    if (secrets.isValidName(name) && names.indexOf(name) === -1) {
      names.push(name);
    }
  };
  var list = referenced instanceof Array ? referenced : [];
  for (var i = 0; i < list.length; i++) {
    add(list[i]);
  }
  var extra = typeof query === 'string' && query !== '' ? query.split(',') : [];
  for (var j = 0; j < extra.length && j < MAX_EXTRA_NAMES; j++) {
    if (nameProblem(extra[j], list, secrets) === '') {
      add(extra[j]);
    }
  }
  names.sort();
  return names;
}

/**
 * The answer of credential-status -Json of the control script ({ ok, variables: [{ name, set }] })
 * for `names`: per name only yes or no (ADR-0018 §4), null for a name the script did not report;
 * null for an answer that is not one.
 */
function statusOf(raw, names) {
  if (!isRecord(raw) || raw.ok !== true || !(raw.variables instanceof Array)) {
    return null;
  }
  var found = {};
  for (var i = 0; i < raw.variables.length; i++) {
    var entry = raw.variables[i];
    if (isRecord(entry) && typeof entry.name === 'string' && typeof entry.set === 'boolean') {
      found[entry.name] = entry.set;
    }
  }
  var result = {};
  for (var j = 0; j < names.length; j++) {
    result[names[j]] = Object.prototype.hasOwnProperty.call(found, names[j]) ? found[names[j]] : null;
  }
  return result;
}

/**
 * The answer of GET /api/byl/credentials: per name whether it is set in the user environment
 * (true, false; null while unknown or for a name of the system), `blocked`, and the names of the
 * connections that use it (`channels`, for the question of "Entfernen"); `restartNeeded` from the
 * mark of the last change. Never a value.
 */
function statusView(names, states, channels, blocked, restartNeeded) {
  var variables = [];
  for (var i = 0; i < names.length; i++) {
    var name = names[i];
    var isSet = states !== null && Object.prototype.hasOwnProperty.call(states, name) ? states[name] : null;
    variables.push({
      name: name,
      set: blocked(name) ? null : typeof isSet === 'boolean' ? isSet : null,
      blocked: blocked(name),
      channels: Object.prototype.hasOwnProperty.call(channels, name) ? channels[name].slice().sort() : []
    });
  }
  return { variables: variables, restartNeeded: restartNeeded === true };
}

/**
 * The answer of credential-set -Json and credential-remove -Json: { ok: true } or { ok: false,
 * problem } with a problem of PROBLEMS ('write' for anything else); null for an answer that is not
 * one. The report of the catalog stays out (the page has its own words).
 */
function scriptAnswer(raw) {
  if (!isRecord(raw) || typeof raw.ok !== 'boolean') {
    return null;
  }
  if (raw.ok) {
    return { ok: true };
  }
  return { ok: false, problem: PROBLEMS.indexOf(raw.problem) !== -1 ? raw.problem : 'write' };
}

/** Whether the stored mark (RESTART_NOTICE_KEY) says that a change waits for a restart. */
function restartNeeded(stored) {
  return typeof stored === 'number' && isFinite(stored) && stored > 0;
}

/** The answer of a refused request: 400 with the problem and its text, the name if it is one. */
function problemView(problem, name) {
  var code = PROBLEMS.indexOf(problem) !== -1 ? problem : 'invalid';
  var body = { status: 400, message: MESSAGES[code], problem: code };
  if (typeof name === 'string' && name !== '') {
    body.name = name;
  }
  return body;
}

module.exports = {
  BLOCKED: BLOCKED,
  BLOCKED_PREFIXES: BLOCKED_PREFIXES,
  SUGGESTED: SUGGESTED,
  MAX_VALUE_LENGTH: MAX_VALUE_LENGTH,
  MAX_EXTRA_NAMES: MAX_EXTRA_NAMES,
  RESTART_NOTICE_KEY: RESTART_NOTICE_KEY,
  MESSAGES: MESSAGES,
  PROBLEMS: PROBLEMS,
  isBlocked: isBlocked,
  isSuggested: isSuggested,
  nameProblem: nameProblem,
  valueProblem: valueProblem,
  setInput: setInput,
  removeInput: removeInput,
  statusNames: statusNames,
  statusOf: statusOf,
  statusView: statusView,
  scriptAnswer: scriptAnswer,
  restartNeeded: restartNeeded,
  problemView: problemView
};
