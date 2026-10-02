// Pure rules of the folder channel (ADR-0051, plan beobachtete-quellen, package 3): folders on this
// machine are watched read only; their files come into the inbox as references, not as copies. The
// module knows paths and their checks (Windows and Linux), the patterns of exclusions, the settings
// of a connection, the kinds of directory entries, the changes between two scans (new, changed,
// moved, removed), the versions of a file (SHA-256 or size and time), the entries and their status,
// the state of the channel, the summary for the card, the answer of the file route (type,
// disposition) and the streaming helper that hashes large files. CommonJS module, ES5 only, no
// dependencies (Goja runtime and Vitest load it the same way); the time zone comes as parameter.
'use strict';

var TEST_MODE_KEY = 'byl-test-mode';
// Only in the test mode (mark of tests/fixtures/pb_hooks/test-mode.pb.js): smaller limits as JSON,
// so a test reaches them with small files.
var TEST_LIMITS_ENV = 'BYL_TEST_FOLDER_LIMITS';

var LIMITS = Object.freeze({
  // Folders of one connection.
  folders: 10,
  // Minutes between two runs of the cron: default, least and most.
  intervalDefault: 5,
  intervalMin: 1,
  intervalMax: 60,
  // Characters of the path of a folder and of one name in it; source_ref of an entry (folder and
  // file) holds at most refLength.
  pathLength: 400,
  componentLength: 255,
  refLength: 500,
  // File types (extensions) and exclusion patterns of one folder.
  types: 30,
  typeLength: 16,
  exclude: 30,
  excludeLength: 200,
  // Watched files per folder; more are counted and named, not watched.
  files: 2000,
  // Directory entries a run reads per folder at most (files, folders and excluded ones).
  entries: 20000,
  // Time of one run of a connection; the rest follows with the next run.
  runMs: 30000,
  // SHA-256 up to this size; larger files are compared by size and time only.
  hashBytes: 200 * 1024 * 1024,
  // Up to this size the server hashes a file itself (verified lossless, about four times the size
  // in memory for a moment); above it the streaming helper of the system does (constant memory).
  memoryHashBytes: 16 * 1024 * 1024,
  // Bytes and files hashed per run; the rest waits for the next run.
  hashBudgetBytes: 2 * 1024 * 1024 * 1024,
  hashFiles: 200,
  // Files per call of the streaming helper under Windows.
  helperBatch: 50,
  // New entries per run of a connection; further new files follow with the next run.
  newPerRun: 100,
  // Files of one request of "Vorhandene Dateien übernehmen".
  adoptBatch: 50
});

// Exclusions of a new folder (spec, package 3).
var DEFAULT_EXCLUDE = ['*.tmp', '~$*', '.git/**', 'node_modules/**', 'Thumbs.db', 'desktop.ini'];

var MESSAGES = {
  validation_folder_settings: 'Unbekannte Einstellung des Ordner-Kanals.',
  validation_folder_interval: 'Prüfen alle 1 bis 60 Minuten.',
  validation_folder_max: 'Höchstens 10 Ordner je Verbindung.',
  validation_folder_path:
    'Bitte den vollständigen Pfad eines Ordners angeben, etwa „C:\\Daten\\Projekte“, „\\\\NAS\\Freigabe“ oder unter Linux „/home/anna/Projekte“; ohne „..“ und ohne Zeichen wie * ? " < > |.',
  validation_folder_root: 'Bitte einen Ordner wählen, nicht ein ganzes Laufwerk.',
  validation_folder_duplicate: 'Dieser Ordner ist schon eingetragen.',
  validation_folder_types: 'Dateitypen als Liste von höchstens 30 Endungen ohne Punkt, etwa „pdf“ oder „docx“.',
  validation_folder_exclude:
    'Ausschlüsse als Liste von höchstens 30 Mustern, je bis 200 Zeichen, etwa „*.tmp“ oder „.git/**“; ohne „..“, ohne „\\“ und ohne [ ] { } !.',
  validation_folder_target: 'Zielprojekt als ID eines Projekts oder leer.',
  validation_folder_missing: 'Diesen Ordner gibt es nicht, oder er ist gerade nicht erreichbar.',
  validation_folder_unreadable: 'Die App darf diesen Ordner nicht lesen.',
  validation_folder_link: 'Der Pfad führt über eine Verknüpfung (Symlink oder Junction). Bitte den Zielordner direkt angeben.',
  validation_folder_alias:
    'Bitte den Pfad so angeben, wie ihn der Explorer zeigt: ohne Kurznamen mit „~“ und ohne Punkt oder Leerzeichen am Ende eines Namens.',
  validation_folder_app: 'Den Ordner der App selbst (app, pb_data) beobachtet die App nicht.'
};

// Refusals of the file route (lib/folder-service.js): status and German text per reason.
var FILE_REFUSALS = {
  unknown: { status: 404, message: 'Diesen Eintrag gibt es nicht, oder er ist kein Eintrag aus einem Ordner.' },
  folder: { status: 403, message: 'Die Datei liegt nicht in einem beobachteten Ordner (mehr). Die App öffnet nur Dateien der eingetragenen Ordner.' },
  path: { status: 400, message: 'Der Pfad der Datei ist ungültig. Die App öffnet ihn nicht.' },
  link: { status: 403, message: 'Die Datei liegt hinter einer Verknüpfung (Symlink oder Junction). Die App öffnet nur Dateien direkt im Ordner.' },
  missing: { status: 404, message: 'Die Datei ist nicht mehr vorhanden.' },
  unreadable: { status: 409, message: 'Die Datei lässt sich gerade nicht lesen (keine Berechtigung oder von einem anderen Programm gesperrt).' },
  auth: { status: 401, message: 'Bitte anmelden. Der Link zur Datei gilt nur kurz; „Ansehen“ in der App holt einen neuen.' }
};

var RECORD_ID = /^[a-z0-9]{15}$/;
var SHA256 = /^[0-9a-f]{64}$/;
var TYPE = /^[a-z0-9][a-z0-9_+-]{0,15}$/;
var WINDOWS_RESERVED = /^(con|prn|aux|nul|com[0-9\u00b9\u00b2\u00b3]|lpt[0-9\u00b9\u00b2\u00b3]|conin\$|conout\$)(\..*)?$/i;
var WINDOWS_BAD = /[<>:"|?*\u0000-\u001f\\\/]/;
var CONTROL = /[\u0000-\u001f\u007f]/;

// Bits of Go's fs.FileMode as numbers (type bits of a directory entry).
var MODE = {
  dir: 0x80000000,
  symlink: 0x08000000,
  device: 0x04000000,
  namedPipe: 0x02000000,
  socket: 0x01000000,
  charDevice: 0x00200000,
  irregular: 0x00080000
};
// File attributes of Windows (Win32 FILE_ATTRIBUTE_*), read from the entry where available.
var ATTRIBUTE = {
  directory: 0x10,
  reparse: 0x400,
  offline: 0x1000,
  recallOnOpen: 0x40000,
  recallOnDataAccess: 0x400000
};

function text(value) {
  return value === undefined || value === null ? '' : String(value);
}

function trim(value) {
  return text(value).replace(/^\s+|\s+$/g, '');
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && Object.prototype.toString.call(value) === '[object Object]';
}

function isArray(value) {
  return Object.prototype.toString.call(value) === '[object Array]';
}

function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object, key);
}

function keysOf(object) {
  var keys = [];
  for (var key in object) {
    if (hasOwn(object, key)) {
      keys.push(key);
    }
  }
  return keys;
}

function failure(code) {
  return { field: 'settings', code: code, message: MESSAGES[code] };
}

/** 'windows' for a server under Windows, else 'posix'; from a join of the server (`$filepath.join('a', 'b')`). */
function platformOf(joined) {
  return text(joined).indexOf('\\') !== -1 ? 'windows' : 'posix';
}

function separator(platform) {
  return platform === 'windows' ? '\\' : '/';
}

/**
 * Whether one name of a Windows path is valid: no reserved device name, no trailing dot or space.
 * "__proto__" is left out on every platform: the channel keeps files by name in plain objects.
 */
function isWindowsName(name) {
  return (
    name !== '' &&
    name !== '.' &&
    name !== '..' &&
    name !== '__proto__' &&
    name.length <= LIMITS.componentLength &&
    !WINDOWS_BAD.test(name) &&
    !/[. ]$/.test(name) &&
    !WINDOWS_RESERVED.test(name)
  );
}

/** Whether one name of a Linux path is valid: not empty, not "." or "..", no control characters. */
function isPosixName(name) {
  return (
    name !== '' &&
    name !== '.' &&
    name !== '..' &&
    name !== '__proto__' &&
    name.length <= LIMITS.componentLength &&
    name.indexOf('/') === -1 &&
    !CONTROL.test(name)
  );
}

function isName(name, platform) {
  return platform === 'windows' ? isWindowsName(name) : isPosixName(name);
}

/**
 * The path of a folder as the user entered it: { path, key } in its stored form, or { code }.
 * Windows: "X:\…" or "\\server\share\…" (also with "/"), no device paths ("\\?\", "\\.\"), no
 * relative or drive-relative paths, no "." or "..", no reserved names, no trailing dot or space,
 * no drive root. Linux: "/…" without "." and "..", not "/". The stored path has no separator at
 * its end and a capital drive letter; `key` compares paths (lower case under Windows).
 */
function parseFolderPath(input, platform) {
  var raw = text(input);
  if (raw === '' || trim(raw) !== raw || raw.length > LIMITS.pathLength) {
    return { code: 'validation_folder_path' };
  }
  if (platform === 'windows') {
    var value = raw.replace(/\//g, '\\');
    if (/^\\\\[?.]\\/.test(value)) {
      return { code: 'validation_folder_path' };
    }
    var prefix;
    var rest;
    var unc = false;
    var drive = /^([A-Za-z]):\\(.*)$/.exec(value);
    if (drive) {
      prefix = drive[1].toUpperCase() + ':';
      rest = drive[2];
    } else {
      var share = /^\\\\([^\\]+)\\([^\\]+)(?:\\(.*))?$/.exec(value);
      if (!share || !isWindowsName(share[1]) || !isWindowsName(share[2])) {
        return { code: 'validation_folder_path' };
      }
      prefix = '\\\\' + share[1] + '\\' + share[2];
      rest = share[3] || '';
      unc = true;
    }
    rest = rest.replace(/\\+$/, '');
    var parts = rest === '' ? [] : rest.split('\\');
    for (var i = 0; i < parts.length; i++) {
      if (!isWindowsName(parts[i])) {
        return { code: 'validation_folder_path' };
      }
    }
    if (!unc && parts.length === 0) {
      return { code: 'validation_folder_root' };
    }
    var path = prefix + (parts.length > 0 ? '\\' + parts.join('\\') : '');
    return { path: path, key: path.toLowerCase() };
  }
  if (raw.charAt(0) !== '/') {
    return { code: 'validation_folder_path' };
  }
  var trimmed = raw.replace(/\/+$/, '');
  if (trimmed === '') {
    return { code: 'validation_folder_root' };
  }
  var names = trimmed.slice(1).split('/');
  for (var j = 0; j < names.length; j++) {
    if (!isPosixName(names[j])) {
      return { code: 'validation_folder_path' };
    }
  }
  return { path: trimmed, key: trimmed };
}

/** The key of any absolute path of this platform (what parseFolderPath gives as `key`). */
function pathKey(path, platform) {
  return platform === 'windows' ? text(path).toLowerCase() : text(path);
}

/**
 * A stored folder path in parts: { prefix, names } with prefix "C:" or "\\server\share" under
 * Windows and "" under Linux (the root "/" before the names).
 */
function splitFolderPath(path, platform) {
  var value = text(path);
  if (platform === 'windows') {
    var share = /^(\\\\[^\\]+\\[^\\]+)(?:\\(.*))?$/.exec(value);
    if (share) {
      return { prefix: share[1], names: share[2] ? share[2].split('\\') : [], unc: true };
    }
    var drive = /^([A-Za-z]:)(?:\\(.*))?$/.exec(value);
    return { prefix: drive ? drive[1] : value, names: drive && drive[2] ? drive[2].split('\\') : [], unc: false };
  }
  return { prefix: '', names: value.replace(/^\/+/, '') === '' ? [] : value.replace(/^\/+/, '').split('/'), unc: false };
}

/** The path of the volume root of a split path ("C:\", "\\server\share", "/"). */
function rootOf(split, platform) {
  if (platform !== 'windows') {
    return '/';
  }
  return split.unc ? split.prefix : split.prefix + '\\';
}

/** A path below a folder: `rel` with "/" between its names, joined with the separator of the platform. */
function joinPath(folder, rel, platform) {
  var tail = platform === 'windows' ? text(rel).replace(/\//g, '\\') : text(rel);
  if (tail === '') {
    return text(folder);
  }
  var base = text(folder);
  return base.charAt(base.length - 1) === separator(platform) ? base + tail : base + separator(platform) + tail;
}

/** The path of `abs` below `folder` with "/" between its names, or null when it lies elsewhere. */
function relativeOf(folder, abs, platform) {
  var sep = separator(platform);
  var prefix = text(folder) + sep;
  var value = text(abs);
  if (value.length <= prefix.length || pathKey(value.slice(0, prefix.length), platform) !== pathKey(prefix, platform)) {
    return null;
  }
  var rest = value.slice(prefix.length);
  return platform === 'windows' ? rest.replace(/\\/g, '/') : rest;
}

/**
 * Whether a path below a folder ("/" between names) is valid on this platform: no empty name, no
 * "." or "..", no absolute path, no drive, no stream (":"), no reserved or trailing-dot names under
 * Windows, at most the length of a reference.
 */
function isRelative(rel, platform) {
  var value = text(rel);
  if (value === '' || value.length > LIMITS.refLength || value.charAt(0) === '/') {
    return false;
  }
  var names = value.split('/');
  for (var i = 0; i < names.length; i++) {
    if (!isName(names[i], platform)) {
      return false;
    }
  }
  return true;
}

/** The last name of a path with "/" or the separator of the platform. */
function nameOf(path) {
  var value = text(path);
  var cut = Math.max(value.lastIndexOf('/'), value.lastIndexOf('\\'));
  return cut === -1 ? value : value.slice(cut + 1);
}

/** The extension of a name in lower case without its dot; '' without one (also ".gitignore"). */
function extensionOf(name) {
  var value = text(name);
  var dot = value.lastIndexOf('.');
  if (dot <= 0 || dot === value.length - 1) {
    return '';
  }
  return value.slice(dot + 1).toLowerCase();
}

// ---------------------------------------------------------------------------------------------
// Patterns of the exclusions.

/**
 * Whether an exclusion pattern is valid: "*" stands for any characters within a name, "?" for one
 * character, "**" as a whole segment for any number of folders. A pattern matches in every
 * subfolder; with "/" at its start only from the watched folder on. No "\", "..", "." segments,
 * empty segments or [ ] { } !.
 */
function isPattern(value) {
  if (typeof value !== 'string' || value.length === 0 || value.length > LIMITS.excludeLength) {
    return false;
  }
  if (trim(value) !== value || /[\u0000-\u001f\u007f\\\[\]{}!]/.test(value)) {
    return false;
  }
  var body = value.charAt(0) === '/' ? value.slice(1) : value;
  var segments = body.split('/');
  for (var i = 0; i < segments.length; i++) {
    var segment = segments[i];
    if (segment === '' || segment === '.' || segment === '..') {
      return false;
    }
    if (segment.indexOf('**') !== -1 && segment !== '**') {
      return false;
    }
  }
  return true;
}

function excludeViolation(list) {
  if (!isArray(list) || list.length > LIMITS.exclude) {
    return 'validation_folder_exclude';
  }
  var seen = {};
  for (var i = 0; i < list.length; i++) {
    if (!isPattern(list[i])) {
      return 'validation_folder_exclude';
    }
    var key = list[i].toLowerCase();
    if (hasOwn(seen, key)) {
      return 'validation_folder_exclude';
    }
    seen[key] = true;
  }
  return '';
}

function escapeRegExp(value) {
  return value.replace(/[.+^${}()|[\]\\\/]/g, '\\$&');
}

function segmentsSource(segments) {
  var source = '';
  for (var i = 0; i < segments.length; i++) {
    var segment = segments[i];
    var last = i === segments.length - 1;
    if (segment === '**') {
      source += last ? '.*' : '(?:[^/]+/)*';
      continue;
    }
    var part = '';
    for (var c = 0; c < segment.length; c++) {
      var ch = segment.charAt(c);
      if (ch === '*') {
        part += '[^/]*';
      } else if (ch === '?') {
        part += '[^/]';
      } else {
        part += escapeRegExp(ch);
      }
    }
    source += part + (last ? '' : '/');
  }
  return source;
}

/** The regular expression of one pattern (case-insensitive under Windows). */
function patternRegExp(pattern, platform) {
  var anchored = pattern.charAt(0) === '/';
  var body = anchored ? pattern.slice(1) : pattern;
  return new RegExp('^' + (anchored ? '' : '(?:[^/]+/)*') + segmentsSource(body.split('/')) + '$', platform === 'windows' ? 'i' : '');
}

/**
 * Matcher of a list of exclusion patterns: `dir(rel)` whether a folder is left out with everything
 * below it (the pattern matches the folder, or it is "folder/**"), `file(rel)` whether a file is
 * left out (the pattern matches it or one of its folders).
 */
function excludeMatcher(patterns, platform) {
  var whole = [];
  var below = [];
  var list = isArray(patterns) ? patterns : [];
  for (var i = 0; i < list.length; i++) {
    if (!isPattern(list[i])) {
      continue;
    }
    whole.push(patternRegExp(list[i], platform));
    if (/\/\*\*$/.test(list[i]) && list[i] !== '/**') {
      below.push(patternRegExp(list[i].slice(0, -3), platform));
    }
  }
  function matches(path, expressions) {
    for (var e = 0; e < expressions.length; e++) {
      if (expressions[e].test(path)) {
        return true;
      }
    }
    return false;
  }
  function dir(rel) {
    return matches(rel, whole) || matches(rel, below);
  }
  return {
    dir: dir,
    file: function (rel) {
      if (matches(rel, whole)) {
        return true;
      }
      var names = text(rel).split('/');
      for (var n = 1; n < names.length; n++) {
        if (dir(names.slice(0, n).join('/'))) {
          return true;
        }
      }
      return false;
    }
  };
}

function typesViolation(list) {
  if (!isArray(list) || list.length > LIMITS.types) {
    return 'validation_folder_types';
  }
  var seen = {};
  for (var i = 0; i < list.length; i++) {
    if (typeof list[i] !== 'string' || !TYPE.test(list[i]) || hasOwn(seen, list[i])) {
      return 'validation_folder_types';
    }
    seen[list[i]] = true;
  }
  return '';
}

/**
 * Whether a file below a folder is watched by its configuration (`config` from settingsOf):
 * subfolders, file types and exclusions (`matcher` from excludeMatcher of its patterns).
 */
function isWatched(rel, config, matcher) {
  if (!config.subfolders && text(rel).indexOf('/') !== -1) {
    return false;
  }
  if (config.types.length > 0 && config.types.indexOf(extensionOf(nameOf(rel))) === -1) {
    return false;
  }
  return !matcher.file(rel);
}

// ---------------------------------------------------------------------------------------------
// Settings of a connection.

var FOLDER_KEYS = ['path', 'subfolders', 'types', 'exclude', 'target', 'report_changes'];

/**
 * Violation of `settings` of a folder connection (the hook passes the parsed JSON): '' or
 * { field, code, message }. Allowed: `interval` (whole minutes, 1 to 60) and `folders`, a list of
 * at most 10 objects { path, subfolders, types, exclude, target, report_changes }, each folder once.
 */
function settingsViolation(settings, platform) {
  var value = settings === null || settings === undefined || settings === '' ? {} : settings;
  if (!isPlainObject(value)) {
    return failure('validation_folder_settings');
  }
  var keys = keysOf(value);
  for (var i = 0; i < keys.length; i++) {
    if (keys[i] !== 'interval' && keys[i] !== 'folders') {
      return failure('validation_folder_settings');
    }
  }
  if (value.interval !== undefined) {
    var interval = value.interval;
    if (typeof interval !== 'number' || interval % 1 !== 0 || interval < LIMITS.intervalMin || interval > LIMITS.intervalMax) {
      return failure('validation_folder_interval');
    }
  }
  if (value.folders === undefined) {
    return '';
  }
  if (!isArray(value.folders)) {
    return failure('validation_folder_settings');
  }
  if (value.folders.length > LIMITS.folders) {
    return failure('validation_folder_max');
  }
  var seen = {};
  for (var f = 0; f < value.folders.length; f++) {
    var folder = value.folders[f];
    if (!isPlainObject(folder)) {
      return failure('validation_folder_settings');
    }
    var folderKeys = keysOf(folder);
    for (var k = 0; k < folderKeys.length; k++) {
      if (FOLDER_KEYS.indexOf(folderKeys[k]) === -1) {
        return failure('validation_folder_settings');
      }
    }
    var parsed = parseFolderPath(folder.path, platform);
    if (parsed.code) {
      return failure(parsed.code);
    }
    if (parsed.path !== folder.path) {
      return failure('validation_folder_path');
    }
    if (hasOwn(seen, parsed.key)) {
      return failure('validation_folder_duplicate');
    }
    seen[parsed.key] = true;
    if (
      (folder.subfolders !== undefined && typeof folder.subfolders !== 'boolean') ||
      (folder.report_changes !== undefined && typeof folder.report_changes !== 'boolean')
    ) {
      return failure('validation_folder_settings');
    }
    if (folder.types !== undefined && typesViolation(folder.types) !== '') {
      return failure('validation_folder_types');
    }
    if (folder.exclude !== undefined && excludeViolation(folder.exclude) !== '') {
      return failure('validation_folder_exclude');
    }
    if (folder.target !== undefined && folder.target !== '' && !(typeof folder.target === 'string' && RECORD_ID.test(folder.target))) {
      return failure('validation_folder_target');
    }
  }
  return '';
}

/**
 * The settings as the channel reads them: { interval, folders: [{ path, key, name, subfolders,
 * types, exclude, target, reportChanges }] } with the defaults for missing values (subfolders and
 * "Änderungen melden" on, the default exclusions); invalid folders are left out (the hook refuses
 * them on save, so this only matters for repaired records).
 */
function settingsOf(settings, platform) {
  var value = isPlainObject(settings) ? settings : {};
  var interval = value.interval;
  var result = {
    interval:
      typeof interval === 'number' && interval % 1 === 0 && interval >= LIMITS.intervalMin && interval <= LIMITS.intervalMax
        ? interval
        : LIMITS.intervalDefault,
    folders: []
  };
  var list = isArray(value.folders) ? value.folders : [];
  var seen = {};
  for (var i = 0; i < list.length && result.folders.length < LIMITS.folders; i++) {
    var folder = list[i];
    if (!isPlainObject(folder)) {
      continue;
    }
    var parsed = parseFolderPath(folder.path, platform);
    if (parsed.code || hasOwn(seen, parsed.key)) {
      continue;
    }
    seen[parsed.key] = true;
    result.folders.push({
      path: parsed.path,
      key: parsed.key,
      name: nameOf(parsed.path),
      subfolders: folder.subfolders !== false,
      types: folder.types !== undefined && typesViolation(folder.types) === '' ? folder.types.slice() : [],
      exclude: folder.exclude !== undefined && excludeViolation(folder.exclude) === '' ? folder.exclude.slice() : DEFAULT_EXCLUDE.slice(),
      target: typeof folder.target === 'string' && RECORD_ID.test(folder.target) ? folder.target : '',
      reportChanges: folder.report_changes !== false
    });
  }
  return result;
}

/** Folders of `after` that `before` does not have (by key): their paths are checked on the disk. */
function addedFolders(before, after, platform) {
  var old = {};
  var previous = settingsOf(before, platform).folders;
  for (var i = 0; i < previous.length; i++) {
    old[previous[i].key] = true;
  }
  var added = [];
  var next = settingsOf(after, platform).folders;
  for (var j = 0; j < next.length; j++) {
    if (!hasOwn(old, next[j].key)) {
      added.push(next[j]);
    }
  }
  return added;
}

/** Folders whose target project differs between two values of settings (a new target is checked). */
function changedTargets(before, after, platform) {
  var old = {};
  var previous = settingsOf(before, platform).folders;
  for (var i = 0; i < previous.length; i++) {
    old[previous[i].key] = previous[i].target;
  }
  var changed = [];
  var next = settingsOf(after, platform).folders;
  for (var j = 0; j < next.length; j++) {
    var was = hasOwn(old, next[j].key) ? old[next[j].key] : '';
    if (next[j].target !== '' && next[j].target !== was) {
      changed.push(next[j]);
    }
  }
  return changed;
}

function msOf(value) {
  if (typeof value === 'number') {
    return value;
  }
  var raw = text(value);
  return raw === '' ? NaN : Date.parse(raw.replace(' ', 'T'));
}

/**
 * Whether the cron runs a connection now: once `interval` minutes passed since its last run. The
 * cron ticks at full minutes and a run takes a moment, so up to half a minute early counts as due.
 */
function isDue(lastRunAt, interval, now) {
  var last = msOf(lastRunAt);
  if (isNaN(last)) {
    return true;
  }
  return now - last >= interval * 60 * 1000 - 30 * 1000;
}

/** The limits of a run: LIMITS, in the test mode with the smaller values of `value` (JSON). */
function limitsOf(testMode, value) {
  var result = {};
  var keys = keysOf(LIMITS);
  for (var i = 0; i < keys.length; i++) {
    result[keys[i]] = LIMITS[keys[i]];
  }
  if (testMode !== true || trim(value) === '') {
    return result;
  }
  var parsed;
  try {
    parsed = JSON.parse(value);
  } catch (err) {
    return result;
  }
  if (!isPlainObject(parsed)) {
    return result;
  }
  for (var j = 0; j < keys.length; j++) {
    var given = parsed[keys[j]];
    if (typeof given === 'number' && given >= 0 && given <= LIMITS[keys[j]] && given % 1 === 0) {
      result[keys[j]] = given;
    }
  }
  return result;
}

// ---------------------------------------------------------------------------------------------
// Directory entries and changes.

/**
 * The kind of a directory entry from its type bits (Go's fs.FileMode, `entry.type()`) and, under
 * Windows, its file attributes: 'dir' (a real folder, also one of a cloud storage), 'file' (a
 * regular file, also a placeholder of a cloud storage), 'link' (symlink, junction or mount point:
 * never followed) or 'special' (pipe, socket, device: left out).
 */
function entryKind(typeBits, attributes) {
  var bits = Number(typeBits) >>> 0;
  var attrs = Number(attributes) >>> 0;
  if ((bits & MODE.symlink) !== 0) {
    return 'link';
  }
  if ((bits & (MODE.namedPipe | MODE.socket | MODE.device | MODE.charDevice)) !== 0) {
    return 'special';
  }
  if ((bits & MODE.dir) !== 0) {
    return 'dir';
  }
  // A junction or mount point: Go hides the folder bit of such name surrogates (Go 1.23 and later),
  // Windows still names it a directory and a reparse point.
  if ((attrs & ATTRIBUTE.reparse) !== 0 && (attrs & ATTRIBUTE.directory) !== 0) {
    return 'link';
  }
  return 'file';
}

/** Whether a file is only a placeholder whose content a cloud storage would download on reading. */
function isOffline(attributes) {
  var attrs = Number(attributes) >>> 0;
  return (attrs & (ATTRIBUTE.offline | ATTRIBUTE.recallOnOpen | ATTRIBUTE.recallOnDataAccess)) !== 0;
}

/**
 * Compares the stored files of a folder ({ rel: [size, mtime, sha] }) with a scan
 * ({ rel: { size, mtime } }): { unchanged, suspect (size or time differ), added, missing } as lists
 * of paths in the order of the scan resp. the store.
 */
function scanDiff(previous, scanned) {
  var result = { unchanged: [], suspect: [], added: [], missing: [] };
  var known = isPlainObject(previous) ? previous : {};
  var seen = isPlainObject(scanned) ? scanned : {};
  var scannedKeys = keysOf(seen);
  for (var i = 0; i < scannedKeys.length; i++) {
    var rel = scannedKeys[i];
    var record = known[rel];
    if (!isArray(record)) {
      result.added.push(rel);
    } else if (record[0] === seen[rel].size && record[1] === seen[rel].mtime) {
      result.unchanged.push(rel);
    } else {
      result.suspect.push(rel);
    }
  }
  var knownKeys = keysOf(known);
  for (var k = 0; k < knownKeys.length; k++) {
    if (!hasOwn(seen, knownKeys[k])) {
      result.missing.push(knownKeys[k]);
    }
  }
  return result;
}

/** The version of a file: "sha256:<hex>" with a hash, else "size:<bytes>:<ms>". */
function versionOf(file) {
  if (SHA256.test(text(file.sha))) {
    return 'sha256:' + file.sha;
  }
  return 'size:' + Number(file.size) + ':' + Number(file.mtime);
}

/**
 * Whether a removed and a new file are the same content: equal hashes when both have one, else
 * equal size and time of change (a rename or move on the same drive keeps the time).
 */
function sameFile(a, b) {
  if (SHA256.test(text(a.sha)) && SHA256.test(text(b.sha))) {
    return a.sha === b.sha;
  }
  return a.size === b.size && a.mtime === b.mtime;
}

/**
 * Moves and renames within one run (ADR-0051 §4): a removed file and a new one are the same file
 * when their hashes are equal; without a hash on one side (state of the first run, or a file above
 * the limit of hashing), when size and time of change are equal. Only one-to-one matches count; an
 * ambiguous pair stays removed and new. `removed` and `added` are lists of
 * { folder, rel, size, mtime, sha }. Returns { moves: [{ from, to }], removed, added } with the
 * rest of both lists.
 */
function matchMoves(removed, added) {
  var takenAdded = {};
  var takenRemoved = {};
  var moves = [];
  for (var r = 0; r < removed.length; r++) {
    var forward = [];
    for (var a = 0; a < added.length; a++) {
      if (sameFile(removed[r], added[a])) {
        forward.push(a);
      }
    }
    if (forward.length !== 1) {
      continue;
    }
    var target = added[forward[0]];
    var backward = 0;
    for (var b = 0; b < removed.length; b++) {
      if (sameFile(removed[b], target)) {
        backward += 1;
      }
    }
    if (backward !== 1 || hasOwn(takenAdded, forward[0])) {
      continue;
    }
    takenAdded[forward[0]] = true;
    takenRemoved[r] = true;
    moves.push({ from: removed[r], to: target });
  }
  var restRemoved = [];
  for (var i = 0; i < removed.length; i++) {
    if (!hasOwn(takenRemoved, i)) {
      restRemoved.push(removed[i]);
    }
  }
  var restAdded = [];
  for (var j = 0; j < added.length; j++) {
    if (!hasOwn(takenAdded, j)) {
      restAdded.push(added[j]);
    }
  }
  return { moves: moves, removed: restRemoved, added: restAdded };
}

/**
 * Status of an entry of a file (ADR-0050 §5, ADR-0051 §5) from its version and the file now:
 * `current` { version, at } for a present file, null when it is gone. 'current' while the entry is
 * its current version, 'changed' with the time of the last change, 'gone' since the file vanished.
 * `previous` is the stored status; `at` the time of this observation (ISO).
 */
function fileWatch(itemVersion, current, at, previous) {
  if (current === null) {
    var since = previous && previous.state === 'gone' && previous.since ? previous.since : at;
    return { kind: 'file', state: 'gone', since: since };
  }
  if (itemVersion === current.version) {
    return { kind: 'file', state: 'current' };
  }
  return { kind: 'file', state: 'changed', since: current.at || at };
}

/**
 * Status of an entry whose file moved or was renamed: 'moved' with the new path below its folder
 * (`to`), the name of that folder and whether the content differs from the entry (`changed`).
 */
function movedWatch(itemVersion, currentVersion, to, folderName, at) {
  return { kind: 'file', state: 'moved', since: at, to: to, folder: folderName, changed: itemVersion !== currentVersion };
}

/** Whether two values of the status are the same (JSON of plain values). */
function sameWatch(a, b) {
  return JSON.stringify(a || null) === JSON.stringify(b || null);
}

// ---------------------------------------------------------------------------------------------
// Entries.

function pad(value) {
  return value < 10 ? '0' + value : String(value);
}

/** "02.10.2026, 14:05" in Berlin time for an instant (ms, ISO or PocketBase format); '' for none. */
function berlinText(value, berlin) {
  var ms = msOf(value);
  if (isNaN(ms)) {
    return '';
  }
  var local = new Date(ms + berlin.berlinOffsetHours(ms) * 3600 * 1000);
  return (
    pad(local.getUTCDate()) +
    '.' +
    pad(local.getUTCMonth() + 1) +
    '.' +
    local.getUTCFullYear() +
    ', ' +
    pad(local.getUTCHours()) +
    ':' +
    pad(local.getUTCMinutes())
  );
}

/** A text inside a line of Markdown: one line, without the signs Markdown would read. */
function inline(value, max) {
  var line = trim(text(value).replace(/\s+/g, ' '));
  if (max && line.length > max) {
    line = line.slice(0, max - 1) + '…';
  }
  return line.replace(/([\\`*_\[\]<>#|~!()])/g, '\\$1');
}

/** Thousands with a dot ("1.234.567"). */
function grouped(value) {
  var digits = String(Math.round(Number(value) || 0));
  var out = '';
  while (digits.length > 3) {
    out = '.' + digits.slice(-3) + out;
    digits = digits.slice(0, -3);
  }
  return digits + out;
}

/** "1,2 MB (1.234.567 Byte)", "512 Byte". */
function sizeText(bytes) {
  var value = Number(bytes) || 0;
  if (value < 1024) {
    return grouped(value) + ' Byte';
  }
  var units = ['KB', 'MB', 'GB', 'TB'];
  var size = value / 1024;
  var unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }
  var shown = size >= 100 ? String(Math.round(size)) : (Math.round(size * 10) / 10).toFixed(1).replace('.', ',');
  return shown + ' ' + units[unit] + ' (' + grouped(value) + ' Byte)';
}

var TYPE_NAMES = {
  pdf: 'PDF-Dokument',
  doc: 'Word-Dokument',
  docx: 'Word-Dokument',
  odt: 'Textdokument',
  rtf: 'Textdokument',
  xls: 'Excel-Tabelle',
  xlsx: 'Excel-Tabelle',
  ods: 'Tabelle',
  csv: 'CSV-Tabelle',
  ppt: 'PowerPoint-Präsentation',
  pptx: 'PowerPoint-Präsentation',
  odp: 'Präsentation',
  txt: 'Textdatei',
  md: 'Markdown',
  png: 'Bild',
  jpg: 'Bild',
  jpeg: 'Bild',
  gif: 'Bild',
  webp: 'Bild',
  bmp: 'Bild',
  svg: 'Vektorgrafik',
  zip: 'ZIP-Archiv',
  eml: 'Mail',
  msg: 'Mail'
};

/** "PDF-Dokument (.pdf)", "Datei (.xyz)", "Datei ohne Endung". */
function typeText(name) {
  var ext = extensionOf(name);
  if (ext === '') {
    return 'Datei ohne Endung';
  }
  return (hasOwn(TYPE_NAMES, ext) ? TYPE_NAMES[ext] : 'Datei') + ' (.' + ext + ')';
}

var ACTION_TITLES = { added: 'Neue Datei', changed: 'Datei geändert', existing: 'Datei' };
var ACTION_LINES = {
  added: 'Neue Datei im beobachteten Ordner',
  changed: 'Datei im beobachteten Ordner geändert',
  existing: 'Vorhandene Datei im beobachteten Ordner'
};

/**
 * Entry of a file (ADR-0051 §3): a reference with its metadata, never a copy. `input`:
 * { folder: { path, name }, rel, abs, size, mtime (ms), version, action: 'added' | 'changed' |
 *   'existing', detectedAt (ISO), platform }.
 * Returns a draft for inbox-service.ingest with `watch`.
 */
function fileDraft(input, berlin) {
  var name = nameOf(input.rel);
  var action = hasOwn(ACTION_TITLES, input.action) ? input.action : 'added';
  var lines = [];
  lines.push(ACTION_LINES[action] + ' „' + inline(input.folder.name, 200) + '“.');
  lines.push('');
  lines.push('- Datei: ' + inline(name, 300));
  if (text(input.rel).indexOf('/') !== -1) {
    lines.push('- Pfad im Ordner: ' + inline(input.rel, 500));
  }
  lines.push('- Ordner: ' + inline(input.folder.path, 500));
  lines.push('- Größe: ' + sizeText(input.size));
  lines.push('- Geändert: ' + berlinText(input.mtime, berlin));
  lines.push('- Typ: ' + inline(typeText(name), 200));
  lines.push('');
  lines.push('_Verweis, keine Kopie: Die Datei bleibt im Ordner. „Ansehen“ öffnet ihre aktuelle Fassung._');
  return {
    channel: 'folder',
    kind: action === 'changed' ? 'change' : 'file',
    title: ACTION_TITLES[action] + ': ' + name,
    body: lines.join('\n'),
    source_url: '',
    source_ref: text(input.abs),
    source_date: new Date(msOf(input.mtime)).toISOString(),
    meta: {
      folder: {
        root: text(input.folder.path),
        folder: text(input.folder.name),
        path: text(input.rel),
        name: name,
        size: Number(input.size) || 0,
        modified: new Date(msOf(input.mtime)).toISOString(),
        type: extensionOf(name),
        version: text(input.version),
        file_key: pathKey(input.abs, input.platform),
        action: action,
        detected_at: text(input.detectedAt)
      }
    },
    watch: { kind: 'file', state: 'current' }
  };
}

// ---------------------------------------------------------------------------------------------
// State of the channel (connections.watch) and the card.

/**
 * The state in connections.watch, read safely: { folders: { key: { files, ... } } }. A folder state
 * holds `files` ({ rel: [size, mtime, sha] }), `base_at` (first run), `matching` (files seen in the
 * last scan), `more` (more files than watched), `incomplete` (the scan stopped early), `error`,
 * `last_change` ({ path, action, at }) and `checked_at`. Anything broken counts as nothing known
 * yet (the next run takes the base again, without a flood).
 */
function stateOf(value) {
  var parsed = value;
  if (typeof value === 'string') {
    try {
      parsed = value === '' ? null : JSON.parse(value);
    } catch (err) {
      parsed = null;
    }
  }
  var state = { folders: {} };
  if (!isPlainObject(parsed) || !isPlainObject(parsed.folders)) {
    return state;
  }
  var keys = keysOf(parsed.folders);
  for (var i = 0; i < keys.length; i++) {
    var folder = parsed.folders[keys[i]];
    if (isPlainObject(folder)) {
      state.folders[keys[i]] = folder;
    }
  }
  return state;
}

/**
 * JSON with the keys of every object in sorted order: compares a state with the stored one, whose
 * keys PocketBase may have written in another order.
 */
function stableJson(value) {
  if (isArray(value)) {
    var items = [];
    for (var i = 0; i < value.length; i++) {
      items.push(stableJson(value[i]));
    }
    return '[' + items.join(',') + ']';
  }
  if (isPlainObject(value)) {
    var keys = keysOf(value).sort();
    var parts = [];
    for (var k = 0; k < keys.length; k++) {
      if (value[keys[k]] !== undefined) {
        parts.push(JSON.stringify(keys[k]) + ':' + stableJson(value[keys[k]]));
      }
    }
    return '{' + parts.join(',') + '}';
  }
  return value === undefined ? 'null' : JSON.stringify(value);
}

// Problems of one folder in a run, shown in its details (never with Rot unless it is an error of
// the folder itself, ADR-0009).
var FOLDER_PROBLEMS = {
  unreachable: 'Ordner nicht erreichbar: Er fehlt, die App darf ihn nicht lesen, oder das Laufwerk ist getrennt. Die bisherigen Dateien bleiben, bis er wieder erreichbar ist.',
  app: 'Den Ordner der App selbst (app, pb_data) beobachtet die App nicht.'
};

/**
 * The hint of a run (ADR-0051 §4), neutral: '' when all is well. `input`: { folders (count),
 * errors (folders not reachable), pending (folders the time did not reach), deferred (files left
 * for the next run), more (folders with more files than watched), limit (files per folder) }.
 */
function runHint(input) {
  if (input.folders === 0) {
    return 'Noch kein Ordner eingetragen.';
  }
  var parts = [];
  if (input.errors > 0) {
    parts.push((input.errors === 1 ? '1 Ordner ist' : input.errors + ' Ordner sind') + ' nicht erreichbar; der Grund steht in den Details.');
  }
  if (input.pending > 0) {
    parts.push('Nicht alle Ordner geschafft; der Rest folgt beim nächsten Lauf.');
  } else if (input.deferred > 0) {
    parts.push('Weitere Dateien folgen beim nächsten Lauf.');
  }
  if (input.more > 0) {
    parts.push(
      (input.more === 1 ? '1 Ordner hat' : input.more + ' Ordner haben') +
        ' mehr Dateien, als die App beobachtet (höchstens ' +
        grouped(input.limit) +
        ' je Ordner); Einzelheiten in den Details.'
    );
  }
  return parts.join(' ');
}

/**
 * The details of one folder for its card (ADR-0051 §7), from its settings and stored state:
 * { path, key, name, subfolders, types, exclude, target, reportChanges, files, matching, more,
 *   incomplete, pending, lastChange, baseAt, error }. `pending` says that the last run did not get
 * to the folder (time); otherwise the last run of the connection is the last check of the folder.
 * The state changes only with the files, so a run without a change writes nothing.
 */
function folderSummary(config, state) {
  var stored = isPlainObject(state) ? state : {};
  return {
    path: config.path,
    key: config.key,
    name: config.name,
    subfolders: config.subfolders,
    types: config.types,
    exclude: config.exclude,
    target: config.target,
    reportChanges: config.reportChanges,
    files: isPlainObject(stored.files) ? keysOf(stored.files).length : 0,
    matching: typeof stored.matching === 'number' ? stored.matching : null,
    more: stored.more === true,
    incomplete: stored.incomplete === true,
    pending: stored.pending === true,
    lastChange: isPlainObject(stored.last_change) ? stored.last_change : null,
    baseAt: text(stored.base_at),
    error: text(stored.error)
  };
}

// ---------------------------------------------------------------------------------------------
// The file route.

var INLINE_TYPES = {
  pdf: 'application/pdf',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
  avif: 'image/avif'
};
// Shown as plain text: the browser never renders them as a page (no script, no style).
var TEXT_TYPES = ['txt', 'md', 'markdown', 'csv', 'tsv', 'log', 'json', 'xml', 'yaml', 'yml', 'ini', 'cfg', 'conf', 'toml'];
// For text and images: no script, no plugin, no request elsewhere, a page of its own origin.
var SANDBOX_POLICY = "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox";

/**
 * How the file route answers for a file name (ADR-0051 §6): { type, inline, policy }. PDF and
 * images inline with their type, text inline as text/plain; everything else (HTML, SVG, scripts,
 * office files, archives) as a download of application/octet-stream, so nothing of a foreign folder
 * runs as a page of the app. `policy` is the Content-Security-Policy ('' for PDF, whose viewer a
 * sandbox breaks).
 */
function contentOf(name) {
  var ext = extensionOf(name);
  if (hasOwn(INLINE_TYPES, ext)) {
    return { type: INLINE_TYPES[ext], inline: true, policy: ext === 'pdf' ? '' : SANDBOX_POLICY };
  }
  if (TEXT_TYPES.indexOf(ext) !== -1) {
    return { type: 'text/plain; charset=utf-8', inline: true, policy: SANDBOX_POLICY };
  }
  return { type: 'application/octet-stream', inline: false, policy: SANDBOX_POLICY };
}

/** Percent-encoding of UTF-8 for filename* (RFC 5987), ES5 without encodeURIComponent quirks. */
function rfc5987(value) {
  return encodeURIComponent(value).replace(/['()*]/g, function (c) {
    return '%' + c.charCodeAt(0).toString(16).toUpperCase();
  });
}

/** Content-Disposition with an ASCII name and the full name as filename* (RFC 6266). */
function contentDisposition(name, inline) {
  var full = text(name).replace(/[\u0000-\u001f\u007f]/g, '');
  var ascii = full.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  if (ascii === '' || ascii === '.' || ascii === '..') {
    ascii = 'datei';
  }
  return (inline ? 'inline' : 'attachment') + '; filename="' + ascii + '"; filename*=UTF-8\'\'' + rfc5987(full === '' ? 'datei' : full);
}

/** Answer of a refused request of the file route: { status, body: { status, message, reason } }. */
function fileRefusal(reason) {
  var entry = hasOwn(FILE_REFUSALS, reason) ? FILE_REFUSALS[reason] : FILE_REFUSALS.unknown;
  return { status: entry.status, body: { status: entry.status, message: entry.message, reason: hasOwn(FILE_REFUSALS, reason) ? reason : 'unknown' } };
}

// ---------------------------------------------------------------------------------------------
// The streaming helper (ADR-0051 §4): under Windows one Windows PowerShell per batch reads paths as
// JSON from standard input and writes one SHA-256 per line ("-" when a file cannot be read). It
// opens every file shared for reading, writing and deleting, so it never blocks a program that
// saves or deletes the file meanwhile (certutil does). Under Linux sha256sum per file.

var HASH_SCRIPT = [
  "$ErrorActionPreference = 'Stop'",
  '$paths = [Console]::In.ReadToEnd() | ConvertFrom-Json',
  '$sha = [System.Security.Cryptography.SHA256]::Create()',
  'foreach ($p in $paths) {',
  '  try {',
  "    $s = [System.IO.File]::Open($p, 'Open', 'Read', 'ReadWrite, Delete')",
  "    try { $h = [System.BitConverter]::ToString($sha.ComputeHash($s)).Replace('-', '').ToLowerInvariant() } finally { $s.Dispose() }",
  '    [Console]::Out.WriteLine($h)',
  "  } catch { [Console]::Out.WriteLine('-') }",
  '}'
].join('\n');

var BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** Base64 of the UTF-16LE bytes of a text: the value of -EncodedCommand of Windows PowerShell. */
function encodedCommand(script) {
  var bytes = [];
  var value = text(script);
  for (var i = 0; i < value.length; i++) {
    var code = value.charCodeAt(i);
    bytes.push(code & 0xff, code >> 8);
  }
  var out = '';
  for (var b = 0; b < bytes.length; b += 3) {
    var n = (bytes[b] << 16) | ((b + 1 < bytes.length ? bytes[b + 1] : 0) << 8) | (b + 2 < bytes.length ? bytes[b + 2] : 0);
    out += BASE64.charAt((n >> 18) & 63) + BASE64.charAt((n >> 12) & 63);
    out += b + 1 < bytes.length ? BASE64.charAt((n >> 6) & 63) : '=';
    out += b + 2 < bytes.length ? BASE64.charAt(n & 63) : '=';
  }
  return out;
}

/** JSON with every character outside ASCII as \uXXXX: standard input of Windows PowerShell reads any code page the same. */
function asciiJson(value) {
  return JSON.stringify(value).replace(/[\u007f-\uffff]/g, function (c) {
    return '\\u' + ('0000' + c.charCodeAt(0).toString(16)).slice(-4);
  });
}

/** The hashes of the helper in the order of its paths: SHA-256 in lower case or '' per path. */
function parseHashLines(output, count) {
  var lines = text(output).split(/\r?\n/);
  var result = [];
  for (var i = 0; i < count; i++) {
    var line = trim(lines[i]).toLowerCase();
    result.push(SHA256.test(line) ? line : '');
  }
  return result;
}

/** The hash in the output of sha256sum ("<hex> *<name>"), '' without one. */
function parseSha256sum(output) {
  var match = /^\\?([0-9a-fA-F]{64})\s/.exec(text(output));
  return match ? match[1].toLowerCase() : '';
}

module.exports = {
  TEST_MODE_KEY: TEST_MODE_KEY,
  TEST_LIMITS_ENV: TEST_LIMITS_ENV,
  LIMITS: LIMITS,
  DEFAULT_EXCLUDE: DEFAULT_EXCLUDE,
  MESSAGES: MESSAGES,
  FILE_REFUSALS: FILE_REFUSALS,
  FOLDER_PROBLEMS: FOLDER_PROBLEMS,
  MODE: MODE,
  ATTRIBUTE: ATTRIBUTE,
  HASH_SCRIPT: HASH_SCRIPT,
  platformOf: platformOf,
  separator: separator,
  isName: isName,
  parseFolderPath: parseFolderPath,
  pathKey: pathKey,
  splitFolderPath: splitFolderPath,
  rootOf: rootOf,
  joinPath: joinPath,
  relativeOf: relativeOf,
  isRelative: isRelative,
  nameOf: nameOf,
  extensionOf: extensionOf,
  isPattern: isPattern,
  excludeMatcher: excludeMatcher,
  isWatched: isWatched,
  settingsViolation: settingsViolation,
  settingsOf: settingsOf,
  addedFolders: addedFolders,
  changedTargets: changedTargets,
  isDue: isDue,
  limitsOf: limitsOf,
  entryKind: entryKind,
  isOffline: isOffline,
  scanDiff: scanDiff,
  versionOf: versionOf,
  matchMoves: matchMoves,
  fileWatch: fileWatch,
  movedWatch: movedWatch,
  sameWatch: sameWatch,
  berlinText: berlinText,
  grouped: grouped,
  sizeText: sizeText,
  runHint: runHint,
  typeText: typeText,
  fileDraft: fileDraft,
  stateOf: stateOf,
  stableJson: stableJson,
  folderSummary: folderSummary,
  contentOf: contentOf,
  contentDisposition: contentDisposition,
  fileRefusal: fileRefusal,
  encodedCommand: encodedCommand,
  asciiJson: asciiJson,
  parseHashLines: parseHashLines,
  parseSha256sum: parseSha256sum
};
