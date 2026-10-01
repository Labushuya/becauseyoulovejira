// Rules of the trash for tickets (ADR-0037, docs/plan/papierkorb.md). Pure CommonJS module, ES5
// only; berlin-time.js is passed in where needed, so the Goja runtime and Vitest load it the same
// way. The database part is lib/trash-service.js. The SPA gets the remaining days from the trash
// route and computes none itself.
'use strict';

// users.trash_retention: days a ticket stays in the trash, or 'never'. Empty or unknown means
// the default of 30 days.
var RETENTION_VALUES = ['7', '30', '90', 'never'];
var DEFAULT_RETENTION_DAYS = 30;

// What happens to the sources of a ticket moved to the trash (ADR-0031, addendum B, ADR-0037):
// 'inbox' gives them back to the inbox at once, 'discard' keeps them with the ticket until it is
// deleted for good.
var SOURCE_HANDLINGS = ['inbox', 'discard'];

// History field of moving to and restoring from the trash (lib/history.js does not track it; the
// trash service writes it).
var TRASH_FIELD = 'trash';
var TRASHED = 'trashed';
var RESTORED = 'restored';

var MESSAGES = {
  validation_trash_managed: 'Den Papierkorb verwaltet der Server; diese Felder lassen sich nicht setzen.',
  validation_trash_stale: 'Das Ticket wurde inzwischen wiederhergestellt oder geändert.',
  validation_trash_group_member: 'Diese Unteraufgabe kommt mit ihrem übergeordneten Ticket zurück.',
  validation_trash_project_required:
    'Das Projekt gibt es nicht mehr oder es hat einen anderen Code. Bitte ein Zielprojekt wählen.',
  validation_trash_project_invalid: 'Dieses Projekt ist nicht verfügbar.',
  validation_trash_series_conflict: 'Die Serie hat schon ein offenes Ticket.',
  validation_trash_source_handling: 'Unbekannte Behandlung der Quellen: erlaubt sind „inbox“ und „discard“.',
  // Deleting for good only after the dependencies are resolved (ADR-0047, lib/trash-dependencies.js).
  validation_trash_blocked:
    'Das Ticket hat noch offene Abhängigkeiten (nicht erledigte Tickets oder Quellen). Erst entscheiden, was mit ihnen geschieht; dann lässt es sich endgültig löschen.',
  validation_trash_resolve_empty: 'Bitte mindestens eine Entscheidung wählen.',
  validation_trash_resolve_action: 'Unbekannte Entscheidung: erlaubt sind „complete“, „inbox“, „discard“ und „move“.',
  validation_trash_resolve_target: 'Das ist keine offene Abhängigkeit dieses Tickets mehr.',
  validation_trash_resolve_primary:
    'Die Hauptquelle bleibt bei ihrem Ticket; sie geht nur zurück in den Eingang oder wird verworfen.'
};

function isEmpty(value) {
  return value === undefined || value === null || value === '';
}

function text(value) {
  return isEmpty(value) ? '' : String(value);
}

/**
 * Whether a ticket is in the trash, from its `deleted_at` (record.getString gives '' without the
 * field, i.e. before the migration, so every ticket is live then).
 */
function isTrashed(deletedAt) {
  return text(deletedAt) !== '';
}

/** Days of a retention value (7, 30, 90) or null for 'never'; anything else gives 30. */
function retentionDays(value) {
  if (value === 'never') {
    return null;
  }
  if (value === '7' || value === '30' || value === '90') {
    return Number(value);
  }
  return DEFAULT_RETENTION_DAYS;
}

function isRetention(value) {
  return RETENTION_VALUES.indexOf(value) !== -1;
}

// Milliseconds of a PocketBase date text `YYYY-MM-DD HH:MM:SS.sssZ` (also with "T"), NaN if none.
function instantOf(value) {
  var raw = text(value);
  if (raw === '') {
    return NaN;
  }
  return Date.parse(raw.replace(' ', 'T'));
}

/**
 * Berlin calendar date from which a ticket moved to the trash at `deletedAt` is deleted for
 * good: the Berlin date of the move plus `days`. null for 'never' (days null) or without a
 * valid time.
 */
function purgeDate(deletedAt, days, berlinTime) {
  var ms = instantOf(deletedAt);
  if (days === null || days === undefined || !isFinite(ms)) {
    return null;
  }
  return berlinTime.addDays(berlinTime.berlinToday(ms), days);
}

/**
 * Whole days until the ticket is deleted for good (0 = today or overdue, the next daily run),
 * null for 'never'. "wird endgültig gelöscht in N Tagen".
 */
function daysLeft(deletedAt, days, now, berlinTime) {
  var date = purgeDate(deletedAt, days, berlinTime);
  if (date === null) {
    return null;
  }
  var today = berlinTime.berlinToday(now);
  var left = Math.round((Date.parse(date + 'T00:00:00Z') - Date.parse(today + 'T00:00:00Z')) / berlinTime.DAY_MS);
  return left > 0 ? left : 0;
}

/** Whether the daily run deletes the ticket for good. */
function isDue(deletedAt, days, now, berlinTime) {
  var date = purgeDate(deletedAt, days, berlinTime);
  return date !== null && berlinTime.berlinToday(now) >= date;
}

function idList(value) {
  var list = [];
  if (Object.prototype.toString.call(value) === '[object Array]') {
    for (var i = 0; i < value.length; i++) {
      if (typeof value[i] === 'string' && value[i] !== '') {
        list.push(value[i]);
      }
    }
  }
  return list;
}

/**
 * The snapshot of tickets.trash as a plain object with every key (empty values when missing):
 * { project, project_code, parent, recurrence, occurrence, source_item, sources: { handling,
 * items, returned } }. `returned` (ADR-0047): sources discarded with the ticket that the decision
 * help gave back to the inbox one by one; a restore links them again like `items` of 'inbox'.
 */
function readSnapshot(value) {
  var raw = value;
  if (typeof raw === 'string') {
    try {
      raw = raw === '' ? {} : JSON.parse(raw);
    } catch (err) {
      raw = {};
    }
  }
  if (raw === null || typeof raw !== 'object' || Object.prototype.toString.call(raw) !== '[object Object]') {
    raw = {};
  }
  var sources = raw.sources && typeof raw.sources === 'object' ? raw.sources : {};
  return {
    project: text(raw.project),
    project_code: text(raw.project_code),
    parent: text(raw.parent),
    recurrence: text(raw.recurrence),
    occurrence: text(raw.occurrence),
    source_item: text(raw.source_item),
    sources: {
      handling: SOURCE_HANDLINGS.indexOf(sources.handling) !== -1 ? sources.handling : 'inbox',
      items: idList(sources.items),
      returned: idList(sources.returned)
    }
  };
}

/**
 * The sources a restore links again (ADR-0037 §6): all of the snapshot when they went back to the
 * inbox with the ticket, else those the decision help gave back one by one (ADR-0047).
 */
function returnedSources(snapshot) {
  return snapshot.sources.handling === 'inbox' ? snapshot.sources.items : snapshot.sources.returned;
}

/**
 * Where a restored ticket goes (ADR-0037 §5). `input`:
 *   snapshotProject  project before the trash ('' for none)
 *   snapshotCode     code of that project then
 *   project          null (deleted) or { scope, code } of that project now
 *   ticketScope      scope of the ticket
 * Returns { action: 'keep' } (key stays: no project, or the same project with the same code in
 * the same scope) or { action: 'choose', reason: 'missing' | 'changed' } (a target is needed and
 * the ticket gets a new key there).
 */
function projectDecision(input) {
  if (isEmpty(input.snapshotProject)) {
    return { action: 'keep' };
  }
  if (!input.project) {
    return { action: 'choose', reason: 'missing' };
  }
  if (input.project.scope !== input.ticketScope || input.project.code !== input.snapshotCode) {
    return { action: 'choose', reason: 'changed' };
  }
  return { action: 'keep' };
}

/**
 * The target project chosen for a restore: '' (no project) is always fine; a project must exist,
 * be in the scope of the ticket and not be archived. Returns '' or the code of the violation.
 */
function targetViolation(target, ticketScope) {
  if (target === null) {
    return 'validation_trash_project_invalid';
  }
  if (target === '') {
    return '';
  }
  if (target.scope !== ticketScope || target.archived) {
    return 'validation_trash_project_invalid';
  }
  return '';
}

/**
 * Whether a sub-ticket deleted on its own goes back to its parent (ADR-0037 §4): the parent
 * exists, is not in the trash, is in the same scope and is no sub-ticket itself. `parent` is null
 * or { scope, parent, trashed }.
 */
function reattachesParent(parent, ticketScope) {
  return !!parent && !parent.trashed && parent.scope === ticketScope && isEmpty(parent.parent);
}

/**
 * Whether a source given back to the inbox is linked again on restore (ADR-0037 §6): only while
 * it is still new, without a ticket and in the scope of the ticket. `item` is null or { state,
 * ticket, scope }. Returns '' (link again) or why it is skipped: 'missing', 'converted' (turned
 * into or linked to another ticket), 'discarded'.
 */
function sourceSkip(item, ticketScope) {
  if (!item || item.scope !== ticketScope) {
    return 'missing';
  }
  if (item.state === 'discarded') {
    return 'discarded';
  }
  if (item.state !== 'new' || !isEmpty(item.ticket)) {
    return 'converted';
  }
  return '';
}

module.exports = {
  RETENTION_VALUES: RETENTION_VALUES,
  DEFAULT_RETENTION_DAYS: DEFAULT_RETENTION_DAYS,
  SOURCE_HANDLINGS: SOURCE_HANDLINGS,
  TRASH_FIELD: TRASH_FIELD,
  TRASHED: TRASHED,
  RESTORED: RESTORED,
  MESSAGES: MESSAGES,
  isTrashed: isTrashed,
  retentionDays: retentionDays,
  isRetention: isRetention,
  instantOf: instantOf,
  purgeDate: purgeDate,
  daysLeft: daysLeft,
  isDue: isDue,
  readSnapshot: readSnapshot,
  returnedSources: returnedSources,
  projectDecision: projectDecision,
  targetViolation: targetViolation,
  reattachesParent: reattachesParent,
  sourceSkip: sourceSkip
};
