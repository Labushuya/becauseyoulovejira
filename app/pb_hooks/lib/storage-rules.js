// Storage of the app (ADR-0047 §6 to §9, page "Einstellungen → Speicher", SPE-2). Pure CommonJS
// module, ES5 only, without require; berlin-time.js is passed in where needed, so the Goja runtime
// and Vitest load it the same way. The database and file part is lib/storage-service.js; the SPA
// words the answer (web/src/lib/domain/storage.ts).
'use strict';

// Groups of data.db for the page: tables (and their indexes) by what they hold.
var DB_GROUPS = ['tickets', 'history', 'inbox', 'other'];
var TABLE_GROUPS = {
  tickets: 'tickets',
  comments: 'tickets',
  ticket_reads: 'tickets',
  ticket_pins: 'tickets',
  ticket_counters: 'tickets',
  dependencies: 'tickets',
  ticket_history: 'history',
  inbox_items: 'inbox'
};

// Where an original file of the inbox belongs (the only file field, inbox_items.original).
var FILE_CATEGORIES = ['new', 'open', 'done', 'discarded', 'trash', 'other'];

// How many files "Größte Einträge" lists.
var LARGEST_MAX = 20;

// Groups of "Liegengebliebenes aufräumen": program files the build renamed while they ran
// (byl-mail.exe.old-<time>, byl-backup.exe.old-<time>), safety copies of the data folder past their
// time, and the automatic backups PocketBase made before ADR-0046 (only on explicit request).
var LEFTOVER_GROUPS = ['programs', 'safety', 'pocketbase'];
var OLD_PROGRAM_PATTERN = /^(byl-mail|byl-backup)\.exe\.old-\d{14}$/;
var AUTO_BACKUP_PATTERN = /^@auto_pb_backup_[^/\\]*\.zip$/;
// Safety copies of the manual restore of ADR-0003 (pb_data.vor-restore-<Datum>); those of the app
// (pb_data.vor-wiederherstellung-<UTC>) are recognised by lib/backup-rules.js.
var OLD_RESTORE_PATTERN = /^pb_data\.vor-restore-[^/\\]+$/;

// The actions of the page.
var ACTIONS = ['vacuum', 'leftovers', 'discarded'];

function text(value) {
  return value === undefined || value === null ? '' : String(value);
}

/** The group of a table of data.db: tickets, history, inbox or other. */
function groupOfTable(table) {
  return Object.prototype.hasOwnProperty.call(TABLE_GROUPS, table) ? TABLE_GROUPS[table] : 'other';
}

/**
 * Bytes of data.db per group from the pages of dbstat: `rows` [{ table, bytes }], `table` the
 * table a page (also of an index) belongs to. Every group is there, 0 when empty.
 */
function databaseGroups(rows) {
  var groups = {};
  for (var g = 0; g < DB_GROUPS.length; g++) {
    groups[DB_GROUPS[g]] = 0;
  }
  for (var i = 0; i < (rows || []).length; i++) {
    groups[groupOfTable(text(rows[i].table))] += Number(rows[i].bytes) || 0;
  }
  return groups;
}

/** Whether `PRAGMA compile_options` names the table dbstat (SQLITE_ENABLE_DBSTAT_VTAB). */
function hasDbstat(options) {
  for (var i = 0; i < (options || []).length; i++) {
    if (text(options[i]).toUpperCase() === 'ENABLE_DBSTAT_VTAB') {
      return true;
    }
  }
  return false;
}

/**
 * Where an original file belongs: `item` { state, ticket } with `ticket` null (none or gone) or
 * { status, trashed }. A new entry, one at an open or a done ticket, a discarded one, one bound to a
 * ticket in the trash (discarded with it), or something else.
 */
function fileCategory(item) {
  var state = text(item && item.state);
  if (state === 'new') {
    return 'new';
  }
  if (state === 'discarded') {
    return 'discarded';
  }
  var ticket = item ? item.ticket : null;
  if (state !== 'converted' || !ticket) {
    return 'other';
  }
  if (ticket.trashed) {
    return 'trash';
  }
  return text(ticket.status) === 'done' ? 'done' : 'open';
}

/**
 * The parts of a key of the file storage "<collection>/<record>/<file>" (thumbs one level deeper),
 * or null for anything else.
 */
function fileKeyParts(key) {
  var parts = text(key).split('/');
  if (parts.length < 3 || parts[0] === '' || parts[1] === '' || parts[parts.length - 1] === '') {
    return null;
  }
  return { collection: parts[0], record: parts[1] };
}

function isOldProgram(name) {
  return OLD_PROGRAM_PATTERN.test(text(name));
}

function isAutoBackup(name) {
  return AUTO_BACKUP_PATTERN.test(text(name));
}

function isOldRestoreCopy(name) {
  return OLD_RESTORE_PATTERN.test(text(name));
}

/**
 * { count, bytes, oldest, newest } of a list [{ bytes, time }] (`time` in ms, oldest and newest as
 * ISO text, null without entries or times).
 */
function summarize(list) {
  var result = { count: 0, bytes: 0, oldest: null, newest: null };
  var oldest = null;
  var newest = null;
  for (var i = 0; i < (list || []).length; i++) {
    result.count += 1;
    result.bytes += Number(list[i].bytes) || 0;
    var time = Number(list[i].time);
    if (isFinite(time) && list[i].time !== null && list[i].time !== undefined) {
      oldest = oldest === null || time < oldest ? time : oldest;
      newest = newest === null || time > newest ? time : newest;
    }
  }
  result.oldest = oldest === null ? null : new Date(oldest).toISOString();
  result.newest = newest === null ? null : new Date(newest).toISOString();
  return result;
}

/** The `max` largest entries of [{ bytes }], largest first (equal sizes keep their order). */
function largest(list, max) {
  var copy = (list || []).slice();
  var indexed = [];
  for (var i = 0; i < copy.length; i++) {
    indexed.push({ entry: copy[i], index: i });
  }
  indexed.sort(function (a, b) {
    var diff = (Number(b.entry.bytes) || 0) - (Number(a.entry.bytes) || 0);
    return diff !== 0 ? diff : a.index - b.index;
  });
  var result = [];
  var limit = max === undefined ? LARGEST_MAX : max;
  for (var j = 0; j < indexed.length && j < limit; j++) {
    result.push(indexed[j].entry);
  }
  return result;
}

/**
 * The Berlin day from which the daily cleanup empties a discarded entry (lib/inbox-cleanup.js):
 * 30 full Berlin days after the day it was discarded. null without a valid time.
 */
function emptyDay(handledAt, retentionDays, berlinTime) {
  var raw = text(handledAt);
  var ms = raw === '' ? NaN : Date.parse(raw.replace(' ', 'T'));
  if (!isFinite(ms)) {
    return null;
  }
  return berlinTime.addDays(berlinTime.berlinToday(ms), retentionDays);
}

/**
 * The groups of "Liegengebliebenes aufräumen" a request may name: a list of known groups, at
 * least one, none twice. Returns '' or the code of the violation.
 */
function leftoverGroupsViolation(groups) {
  if (Object.prototype.toString.call(groups) !== '[object Array]' || groups.length === 0) {
    return 'validation_storage_groups';
  }
  var seen = {};
  for (var i = 0; i < groups.length; i++) {
    var group = text(groups[i]);
    if (LEFTOVER_GROUPS.indexOf(group) === -1 || seen[group]) {
      return 'validation_storage_groups';
    }
    seen[group] = true;
  }
  return '';
}

function isAction(name) {
  return ACTIONS.indexOf(text(name)) !== -1;
}

var MESSAGES = {
  validation_storage_groups: 'Bitte wählen, was aufgeräumt werden soll: Programmreste, Sicherheitskopien oder alte Sicherungen von PocketBase.'
};

module.exports = {
  DB_GROUPS: DB_GROUPS,
  FILE_CATEGORIES: FILE_CATEGORIES,
  LARGEST_MAX: LARGEST_MAX,
  LEFTOVER_GROUPS: LEFTOVER_GROUPS,
  ACTIONS: ACTIONS,
  MESSAGES: MESSAGES,
  groupOfTable: groupOfTable,
  databaseGroups: databaseGroups,
  hasDbstat: hasDbstat,
  fileCategory: fileCategory,
  fileKeyParts: fileKeyParts,
  isOldProgram: isOldProgram,
  isAutoBackup: isAutoBackup,
  isOldRestoreCopy: isOldRestoreCopy,
  summarize: summarize,
  largest: largest,
  emptyDay: emptyDay,
  leftoverGroupsViolation: leftoverGroupsViolation,
  isAction: isAction
};
