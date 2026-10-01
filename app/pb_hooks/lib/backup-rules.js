// Pure rules of the backups (ADR-0046): names of the backups, the generations kept (GFS), the
// settings of byl-config.json, when a backup and a copy into the target folder are due, and the
// warnings of the page "Einstellungen → Sicherung". CommonJS module, ES5 only, no dependencies
// (Goja runtime and Vitest load it the same way); the effects live in lib/backup-service.js.
// The limits and defaults of the generations are the same in byl-functions.ps1 ($BylBackupKeep).
'use strict';

var MINUTE_MS = 60 * 1000;
var HOUR_MS = 60 * MINUTE_MS;
var DAY_MS = 24 * HOUR_MS;

// Local backups of the app in pb_data/backups and their sealed copies in the target folder, with
// the time of the backup in UTC. Other ZIP files there (manual backups of the admin UI, the former
// automatic ones of PocketBase) are listed, but never removed.
var LOCAL_PATTERN = /^byl-(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})\.zip$/;
var SEALED_PATTERN = /^byl-(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})\.tar\.age$/;

var KEEP = {
  daily: { fallback: 7, min: 1, max: 30 },
  weekly: { fallback: 4, min: 0, max: 12 },
  monthly: { fallback: 6, min: 0, max: 24 }
};
var KEEP_NAMES = ['daily', 'weekly', 'monthly'];
var TARGET_MAX_LENGTH = 240;

// The cron of the backups looks every five minutes whether something is due (lib/backup-service).
var TICK_MS = 5 * MINUTE_MS;
// A backup a day: due when the newest one is a day old (one tick earlier, so the time of day does
// not drift by a tick each day).
var BACKUP_EVERY_MS = DAY_MS;
// The page warns when the newest backup, or the newest copy in the target folder, is older.
var STALE_MS = 36 * HOUR_MS;
// A copy into the target folder that failed is tried again after this long (or with a new backup).
var EXPORT_RETRY_MS = 15 * MINUTE_MS;
// The cron checks the newest backup once a week (ADR-0046 §6).
var VERIFY_EVERY_MS = 7 * DAY_MS;
// Reasons of byl-control.ps1 backup-verify.
var VERIFY_REASONS = [
  'name',
  'missing',
  'unreachable',
  'no-passphrase',
  'passphrase',
  'format',
  'damaged',
  'zip',
  'no-db',
  'integrity',
  'files',
  'start',
  'space',
  'helper',
  'failed'
];
var LOCAL_ANY_PATTERN = /^[A-Za-z0-9@._-]{1,200}\.zip$/;

var TARGET_PROBLEMS = ['format', 'too-long', 'inside-app', 'missing', 'not-writable', 'space'];
var PASSPHRASE_STATES = ['set', 'missing', 'unreadable', 'unavailable'];
// Reasons of byl-control.ps1 backup-export; the first ones are states, the others failures.
var EXPORT_REASONS = [
  'no-target',
  'unreachable',
  'no-passphrase',
  'passphrase-unreadable',
  'space',
  'name',
  'missing',
  'helper',
  'not-writable',
  'failed'
];
var EXPORT_FAILURES = ['name', 'missing', 'helper', 'not-writable', 'failed'];

function pad(value, length) {
  var text = String(value);
  while (text.length < length) {
    text = '0' + text;
  }
  return text;
}

function isWhole(value) {
  return typeof value === 'number' && isFinite(value) && Math.floor(value) === value;
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !(value instanceof Array);
}

/** Name of a backup made at `nowMs`: byl-YYYYMMDD-HHMMSS.zip in UTC. */
function backupName(nowMs) {
  var date = new Date(nowMs);
  return (
    'byl-' +
    pad(date.getUTCFullYear(), 4) +
    pad(date.getUTCMonth() + 1, 2) +
    pad(date.getUTCDate(), 2) +
    '-' +
    pad(date.getUTCHours(), 2) +
    pad(date.getUTCMinutes(), 2) +
    pad(date.getUTCSeconds(), 2) +
    '.zip'
  );
}

/** Name of the sealed copy of the local backup `name` (byl-<stamp>.tar.age), '' for any other name. */
function sealedName(name) {
  return isLocalName(name) ? String(name).slice(0, -4) + '.tar.age' : '';
}

/** Time (ms, UTC) in the name of a backup or a sealed copy; null for any other name. */
function timeOfName(name) {
  var match = LOCAL_PATTERN.exec(String(name)) || SEALED_PATTERN.exec(String(name));
  if (match === null) {
    return null;
  }
  var parts = [];
  for (var i = 1; i <= 6; i++) {
    parts.push(Number(match[i]));
  }
  var ms = Date.UTC(parts[0], parts[1] - 1, parts[2], parts[3], parts[4], parts[5]);
  var check = new Date(ms);
  if (check.getUTCMonth() !== parts[1] - 1 || check.getUTCDate() !== parts[2] || check.getUTCHours() !== parts[3]) {
    return null;
  }
  return ms;
}

function isLocalName(name) {
  return LOCAL_PATTERN.test(String(name)) && timeOfName(name) !== null;
}

function isSealedName(name) {
  return SEALED_PATTERN.test(String(name)) && timeOfName(name) !== null;
}

/** ISO week of a calendar date `YYYY-MM-DD`, e.g. "2026-W40" (weeks start on Monday). */
function isoWeek(date) {
  var ms = Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10)));
  var weekday = (new Date(ms).getUTCDay() + 6) % 7;
  var thursday = ms + (3 - weekday) * DAY_MS;
  var year = new Date(thursday).getUTCFullYear();
  var week = Math.floor((thursday - Date.UTC(year, 0, 1)) / DAY_MS / 7) + 1;
  return year + '-W' + pad(week, 2);
}

/**
 * The generations kept (grandfather, father, son): of `entries` ({ name, time, day } with the
 * Berlin calendar day of the backup) the newest of each of the last `keep.daily` days that have a
 * backup, of each of the last `keep.weekly` weeks and of each of the last `keep.monthly` months;
 * the newest backup always stays. Returns the names to keep and to remove, newest first.
 */
function retention(entries, keep) {
  var sorted = (entries || []).slice().sort(function (a, b) {
    return b.time - a.time || (a.name < b.name ? 1 : a.name > b.name ? -1 : 0);
  });
  var kept = {};
  function pick(keyOf, count) {
    var seen = {};
    var taken = 0;
    for (var i = 0; i < sorted.length && taken < count; i++) {
      var key = keyOf(sorted[i].day);
      if (Object.prototype.hasOwnProperty.call(seen, key)) {
        continue;
      }
      seen[key] = true;
      kept[sorted[i].name] = true;
      taken++;
    }
  }
  pick(function (day) {
    return day;
  }, keep.daily);
  pick(isoWeek, keep.weekly);
  pick(function (day) {
    return day.slice(0, 7);
  }, keep.monthly);
  if (sorted.length > 0) {
    kept[sorted[0].name] = true;
  }
  var result = { keep: [], remove: [] };
  for (var j = 0; j < sorted.length; j++) {
    (kept[sorted[j].name] ? result.keep : result.remove).push(sorted[j].name);
  }
  return result;
}

function keepValue(value, name) {
  var limit = KEEP[name];
  return isWhole(value) && value >= limit.min && value <= limit.max ? value : limit.fallback;
}

/**
 * The backup settings of the text of byl-config.json (same rules as ConvertFrom-BylBackupConfig):
 * target folder (null without one), generations (defaults outside the limits) and whether the
 * access data go along (on unless switched off).
 */
function settingsOf(text) {
  var settings = {
    target: null,
    daily: KEEP.daily.fallback,
    weekly: KEEP.weekly.fallback,
    monthly: KEEP.monthly.fallback,
    credentials: true
  };
  var value = null;
  try {
    value = JSON.parse(String(text || ''));
  } catch (err) {
    return settings;
  }
  if (!isRecord(value) || !isRecord(value.backup)) {
    return settings;
  }
  var backup = value.backup;
  if (typeof backup.target === 'string' && backup.target.replace(/^\s+|\s+$/g, '') !== '') {
    settings.target = backup.target.replace(/^\s+|\s+$/g, '');
  }
  for (var i = 0; i < KEEP_NAMES.length; i++) {
    settings[KEEP_NAMES[i]] = keepValue(backup[KEEP_NAMES[i]], KEEP_NAMES[i]);
  }
  if (typeof backup.credentials === 'boolean') {
    settings.credentials = backup.credentials;
  }
  return settings;
}

/**
 * The body of "Einstellungen speichern": { target, daily, weekly, monthly, credentials }. Returns
 * { value } for the control script, or { problem } ('target' for a target that is no text or too
 * long, 'keep' for generations outside the limits, 'credentials'). The control script checks the
 * folder itself (format, place, existence, write access, space).
 */
function settingsInput(body) {
  if (!isRecord(body)) {
    return { problem: 'target' };
  }
  var target = body.target === undefined || body.target === null ? '' : body.target;
  if (typeof target !== 'string' || target.length > TARGET_MAX_LENGTH) {
    return { problem: 'target' };
  }
  var value = { target: target.replace(/^\s+|\s+$/g, '') };
  for (var i = 0; i < KEEP_NAMES.length; i++) {
    var name = KEEP_NAMES[i];
    var limit = KEEP[name];
    if (!isWhole(body[name]) || body[name] < limit.min || body[name] > limit.max) {
      return { problem: 'keep' };
    }
    value[name] = body[name];
  }
  if (typeof body.credentials !== 'boolean') {
    return { problem: 'credentials' };
  }
  value.credentials = body.credentials;
  return { value: value };
}

/**
 * The newest of `entries` ({ name, time }, newest first) that is not in the future of `now`; null
 * without one. A backup from a clock that ran ahead must not stop the daily backups, nor make one
 * at every run.
 */
function newestUntil(entries, now) {
  for (var i = 0; i < (entries || []).length; i++) {
    if (entries[i].time <= now + TICK_MS) {
      return entries[i];
    }
  }
  return null;
}

/**
 * What the cron of the backups does now: `backup` (the newest local backup `newestLocal` (ms or
 * null, see newestUntil) is due), `export` (the name of the newest local backup when its sealed
 * copy is missing in the target folder and a copy may be tried: none was tried since that backup,
 * or the last try is EXPORT_RETRY_MS ago).
 *   state: { newestLocal, newestLocalName, targetConfigured, sealedNames (names in the target, or
 *            null when it is not reachable), lastExportAttempt (ms or null) }
 */
function plan(state, now) {
  var result = { backup: false, export: '' };
  var newest = isWhole(state.newestLocal) ? state.newestLocal : null;
  result.backup = newest === null || now - newest >= BACKUP_EVERY_MS - TICK_MS;
  if (!state.targetConfigured || newest === null || !state.newestLocalName) {
    return result;
  }
  var sealed = sealedName(state.newestLocalName);
  var present = state.sealedNames instanceof Array && state.sealedNames.indexOf(sealed) !== -1;
  var attempt = isWhole(state.lastExportAttempt) ? state.lastExportAttempt : null;
  if (!present && (attempt === null || attempt < newest || now - attempt >= EXPORT_RETRY_MS || now < attempt)) {
    result.export = state.newestLocalName;
  }
  return result;
}

/**
 * Whether the weekly check is due (`lastVerify`: ms of the last check or null) and which backup it
 * takes: the newest sealed copy in the target if there is one (it proves the decryption as well),
 * else the newest local backup; { due, source, name }.
 */
function planVerify(lastVerify, newestLocalName, newestSealedName, now) {
  var none = { due: false, source: '', name: '' };
  if (isWhole(lastVerify) && now >= lastVerify && now - lastVerify < VERIFY_EVERY_MS) {
    return none;
  }
  if (newestSealedName) {
    return { due: true, source: 'target', name: newestSealedName };
  }
  if (newestLocalName) {
    return { due: true, source: 'local', name: newestLocalName };
  }
  return none;
}

/**
 * The body of "Prüfen": { source ('local' | 'target'), name, passphrase? }. Returns { value } for the
 * control script or { problem } ('name', 'passphrase').
 */
function verifyInput(body) {
  if (!isRecord(body)) {
    return { problem: 'name' };
  }
  var name = typeof body.name === 'string' ? body.name : '';
  var ok = body.source === 'local' ? LOCAL_ANY_PATTERN.test(name) : body.source === 'target' && isSealedName(name);
  if (!ok) {
    return { problem: 'name' };
  }
  var value = { source: body.source, name: name };
  if (body.passphrase !== undefined && body.passphrase !== null && body.passphrase !== '') {
    if (typeof body.passphrase !== 'string' || body.passphrase.length > 1024) {
      return { problem: 'passphrase' };
    }
    value.passphrase = body.passphrase;
  }
  return { value: value };
}

function countsOf(raw) {
  if (!isRecord(raw)) {
    return null;
  }
  var counts = {};
  for (var key in raw) {
    if (Object.prototype.hasOwnProperty.call(raw, key) && /^[A-Za-z0-9_]{1,100}$/.test(key) && isWhole(raw[key]) && raw[key] >= 0) {
      counts[key] = raw[key];
    }
  }
  return counts;
}

function filesOf(raw) {
  if (!isRecord(raw)) {
    return null;
  }
  var examples = [];
  var listed = raw.examples instanceof Array ? raw.examples : [];
  for (var i = 0; i < listed.length && i < 10; i++) {
    if (typeof listed[i] === 'string' && /^[A-Za-z0-9_]{1,100}\/[A-Za-z0-9_]{1,64}$/.test(listed[i])) {
      examples.push(listed[i]);
    }
  }
  return {
    expected: isWhole(raw.expected) && raw.expected >= 0 ? raw.expected : 0,
    missing: isWhole(raw.missing) && raw.missing >= 0 ? raw.missing : 0,
    examples: examples
  };
}

/** The answer of backup-verify in the shape of the route and the state file, or null. */
function verifyView(raw) {
  if (!isRecord(raw) || typeof raw.ok !== 'boolean') {
    return null;
  }
  var names = [];
  var listed = raw.variables instanceof Array ? raw.variables : [];
  for (var i = 0; i < listed.length; i++) {
    if (typeof listed[i] === 'string' && /^BYL_[A-Z0-9_]{1,60}$/.test(listed[i])) {
      names.push(listed[i]);
    }
  }
  return {
    ok: raw.ok,
    reason: raw.ok ? '' : VERIFY_REASONS.indexOf(raw.reason) !== -1 ? raw.reason : 'failed',
    encrypted: raw.encrypted === true,
    createdUtc: typeof raw.createdUtc === 'string' && raw.createdUtc !== '' ? raw.createdUtc : null,
    variables: names,
    counts: countsOf(raw.counts),
    files: filesOf(raw.files)
  };
}

/** When the next backup is due (ms): a day after the newest one, now without any. */
function nextBackupAt(newestLocal, now) {
  return isWhole(newestLocal) ? Math.max(now, newestLocal + BACKUP_EVERY_MS) : now;
}

/**
 * The warnings of the page and the attention of the app (ADR-0035, only real ones):
 *   stale            the newest local backup is older than STALE_MS,
 *   backup-failed    the last backup failed (error),
 *   target-lag       a target is set, but its newest copy is more than STALE_MS behind the newest
 *                    backup, or there is none and the copies fail for longer than STALE_MS (with
 *                    the reason of the last try),
 *   export-failed    the last copy failed for another reason than the state of the target (error),
 *   no-passphrase    a target is set, but there is no passphrase it could use,
 *   verify-failed    the last check of a backup failed (error, with its reason).
 *   facts: { now, newestLocal, newestSealed (time of the newest copy in the target, also from the
 *            last export while the target is not reachable; ms or null), target (configured),
 *            passphrase, backupError ({ at } or null), exportProblem ({ reason, since } or null),
 *            verify ({ at, ok, reason } or null) }
 * Every warning: { code, tone ('warning' | 'error'), since (ms or null), reason }.
 */
function warnings(facts) {
  var list = [];
  var now = facts.now;
  if (facts.verify && facts.verify.ok === false && isWhole(facts.verify.at)) {
    list.push({ code: 'verify-failed', tone: 'error', since: facts.verify.at, reason: String(facts.verify.reason || '') });
  }
  if (facts.backupError && isWhole(facts.backupError.at) && (!isWhole(facts.newestLocal) || facts.backupError.at > facts.newestLocal)) {
    list.push({ code: 'backup-failed', tone: 'error', since: facts.backupError.at, reason: '' });
  }
  if (isWhole(facts.newestLocal) && now - facts.newestLocal > STALE_MS) {
    list.push({ code: 'stale', tone: 'warning', since: facts.newestLocal, reason: '' });
  }
  if (!facts.target) {
    return list;
  }
  if (facts.passphrase !== 'set') {
    list.push({ code: 'no-passphrase', tone: 'warning', since: null, reason: facts.passphrase });
  }
  var problem = facts.exportProblem;
  var reason = problem && typeof problem.reason === 'string' ? problem.reason : '';
  if (reason !== '' && EXPORT_FAILURES.indexOf(reason) !== -1) {
    list.push({ code: 'export-failed', tone: 'error', since: isWhole(problem.since) ? problem.since : null, reason: reason });
  }
  var sealed = isWhole(facts.newestSealed) ? facts.newestSealed : null;
  var failingSince = problem && isWhole(problem.since) ? problem.since : null;
  var behind = sealed !== null && isWhole(facts.newestLocal) && facts.newestLocal - sealed > STALE_MS;
  var never = sealed === null && failingSince !== null && now - failingSince > STALE_MS;
  if (behind || never) {
    list.push({ code: 'target-lag', tone: 'warning', since: sealed, reason: reason });
  }
  return list;
}

/** Whether a warning is one the app shows when it opens (ADR-0035): not a missing passphrase alone. */
function needsAttention(list) {
  for (var i = 0; i < list.length; i++) {
    if (list[i].code !== 'no-passphrase') {
      return true;
    }
  }
  return false;
}

/** The status file run/sicherung.json as written by the service; unknown parts become null. */
function parseStatus(text) {
  var empty = { backup: null, backupError: null, export: null, exportAttempt: null, exportProblem: null, verify: null };
  var value = null;
  try {
    value = JSON.parse(String(text || ''));
  } catch (err) {
    return empty;
  }
  if (!isRecord(value)) {
    return empty;
  }
  function entry(raw, keys) {
    if (!isRecord(raw) || !isWhole(raw.at)) {
      return null;
    }
    var result = { at: raw.at };
    for (var i = 0; i < keys.length; i++) {
      result[keys[i]] = raw[keys[i]] === undefined ? null : raw[keys[i]];
    }
    return result;
  }
  return {
    backup: entry(value.backup, ['name', 'bytes']),
    backupError: entry(value.backupError, ['message']),
    export: entry(value.export, ['name', 'bytes']),
    exportAttempt: isWhole(value.exportAttempt) ? value.exportAttempt : null,
    exportProblem: entry(value.exportProblem, ['reason', 'since']),
    verify: entry(value.verify, ['name', 'source', 'ok', 'reason', 'counts', 'files'])
  };
}

/** A point in time as ISO 8601 (UTC) for the answers, null for none. */
function iso(ms) {
  return isWhole(ms) ? new Date(ms).toISOString() : null;
}

/**
 * The answer of byl-control.ps1 backup-info in the shape of the route, or null if it is none.
 * Unknown fields are dropped.
 */
function infoView(raw) {
  if (!isRecord(raw) || raw.ok !== true || !isRecord(raw.settings)) {
    return null;
  }
  var target = null;
  if (isRecord(raw.target) && typeof raw.target.path === 'string') {
    target = {
      path: raw.target.path,
      reachable: raw.target.reachable === true,
      problem: TARGET_PROBLEMS.indexOf(raw.target.problem) !== -1 ? raw.target.problem : null,
      freeBytes: isWhole(raw.target.freeBytes) && raw.target.freeBytes >= 0 ? raw.target.freeBytes : null,
      sameDrive: raw.target.sameDrive === true
    };
  }
  var names = [];
  var listed = raw.variables instanceof Array ? raw.variables : [];
  for (var i = 0; i < listed.length; i++) {
    if (typeof listed[i] === 'string' && /^BYL_[A-Z0-9_]{1,60}$/.test(listed[i])) {
      names.push(listed[i]);
    }
  }
  return {
    passphrase: PASSPHRASE_STATES.indexOf(raw.passphrase) !== -1 ? raw.passphrase : 'missing',
    helper: raw.helper === true,
    target: target,
    variables: names
  };
}

/** The answer of backup-configure: { ok, problem, freeBytes, sameDrive }, or null. */
function configureView(raw) {
  if (!isRecord(raw) || typeof raw.ok !== 'boolean') {
    return null;
  }
  var problem = raw.ok ? null : TARGET_PROBLEMS.concat(['keep']).indexOf(raw.problem) !== -1 ? raw.problem : 'format';
  return {
    ok: raw.ok,
    problem: problem,
    freeBytes: isWhole(raw.freeBytes) && raw.freeBytes >= 0 ? raw.freeBytes : null,
    sameDrive: raw.sameDrive === true
  };
}

/** The answer of backup-export: { ok, reason, file, bytes }, or null. */
function exportView(raw) {
  if (!isRecord(raw) || typeof raw.ok !== 'boolean') {
    return null;
  }
  if (!raw.ok) {
    return { ok: false, reason: EXPORT_REASONS.indexOf(raw.reason) !== -1 ? raw.reason : 'failed', file: '', bytes: 0 };
  }
  return {
    ok: true,
    reason: '',
    file: isSealedName(raw.file) ? raw.file : '',
    bytes: isWhole(raw.bytes) && raw.bytes >= 0 ? raw.bytes : 0
  };
}

/** The passphrase of the form: { problem } for a wrong one ('mismatch', 'too-short', 'too-long'), or {}. */
function passphraseInput(body) {
  if (!isRecord(body) || typeof body.passphrase !== 'string' || typeof body.confirmation !== 'string') {
    return { problem: 'too-short' };
  }
  if (body.passphrase !== body.confirmation) {
    return { problem: 'mismatch' };
  }
  if (body.passphrase.length < 12) {
    return { problem: 'too-short' };
  }
  if (body.passphrase.length > 1024) {
    return { problem: 'too-long' };
  }
  return {};
}

module.exports = {
  HOUR_MS: HOUR_MS,
  DAY_MS: DAY_MS,
  KEEP: KEEP,
  TICK_MS: TICK_MS,
  BACKUP_EVERY_MS: BACKUP_EVERY_MS,
  STALE_MS: STALE_MS,
  EXPORT_RETRY_MS: EXPORT_RETRY_MS,
  VERIFY_EVERY_MS: VERIFY_EVERY_MS,
  VERIFY_REASONS: VERIFY_REASONS,
  TARGET_MAX_LENGTH: TARGET_MAX_LENGTH,
  TARGET_PROBLEMS: TARGET_PROBLEMS,
  EXPORT_REASONS: EXPORT_REASONS,
  backupName: backupName,
  sealedName: sealedName,
  timeOfName: timeOfName,
  isLocalName: isLocalName,
  isSealedName: isSealedName,
  isoWeek: isoWeek,
  retention: retention,
  settingsOf: settingsOf,
  settingsInput: settingsInput,
  newestUntil: newestUntil,
  plan: plan,
  nextBackupAt: nextBackupAt,
  planVerify: planVerify,
  verifyInput: verifyInput,
  verifyView: verifyView,
  warnings: warnings,
  needsAttention: needsAttention,
  parseStatus: parseStatus,
  iso: iso,
  infoView: infoView,
  configureView: configureView,
  exportView: exportView,
  passphraseInput: passphraseInput
};
