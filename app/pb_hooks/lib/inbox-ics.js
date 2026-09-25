// Takes an iCalendar text into the inbox (ADR-0017 section 1, E4 plan packages 14, 15 and 21): the
// .ics routes and the calendar feed share it. A dropped file is shown as a selection first, with
// the keywords of the user (ADR-0020); only the chosen components become entries. CommonJS
// module, ES5 only, Goja runtime only (it writes through inbox-service.js).
'use strict';

var ical = require(__hooks + '/lib/ical.js');
var berlin = require(__hooks + '/lib/berlin-time.js');
var service = require(__hooks + '/lib/inbox-service.js');
var keywords = require(__hooks + '/lib/keywords.js');

var ORIGINAL_NAMES = { event: 'termin.ics', todo: 'aufgabe.ics' };
// Most components of one selection (the parser reads at most 5 000 per file).
var MAX_SELECTION = 5000;
var MAX_FILE_BYTES = 20 * 1024 * 1024;
var TOO_LARGE = 'Größer als 20 MB, deshalb nicht übernommen.';
var UNAVAILABLE = 'Der Eingang steht nach dem nächsten Start der App bereit (start.bat).';

// Parser draft -> draft of inbox-service.ingest.
function toInboxDraft(draft, channel, connection) {
  return {
    channel: channel,
    kind: draft.kind,
    title: draft.title,
    body: draft.body,
    source_url: draft.source_url,
    source_ref: draft.source_ref,
    source_date: draft.source_date,
    meta: draft.meta,
    original: draft.original,
    originalName: ORIGINAL_NAMES[draft.kind] || 'termin.ics',
    connection: connection || ''
  };
}

/**
 * Creates one inbox item per draft for `owner`, one after the other; a failing draft is counted
 * and the others go on. Returns { created, duplicates, failed, createdItems, duplicateItems }
 * with the records of the new and the existing items.
 */
function ingestDrafts(app, owner, drafts, channel, connection) {
  var summary = { created: 0, duplicates: 0, failed: 0, createdItems: [], duplicateItems: [] };
  for (var i = 0; i < drafts.length; i++) {
    var outcome;
    try {
      outcome = service.ingest(app, owner, toInboxDraft(drafts[i], channel, connection));
    } catch (err) {
      summary.failed++;
      continue;
    }
    if (outcome.kind === 'created') {
      summary.created++;
      summary.createdItems.push(outcome.item);
    } else {
      summary.duplicates++;
      summary.duplicateItems.push(outcome.item);
    }
  }
  return summary;
}

// The keyword of `list` that matches title or description of a parser draft, or ''.
function keywordOf(draft, list) {
  return keywords.matchKeyword(list, [draft.title, draft.body]);
}

// A copy of the draft with meta.keyword if a keyword matches (ADR-0020 section 4).
function withKeyword(draft, list) {
  var keyword = keywordOf(draft, list);
  if (keyword === '') {
    return draft;
  }
  var copy = {};
  for (var key in draft) {
    if (Object.prototype.hasOwnProperty.call(draft, key)) {
      copy[key] = draft[key];
    }
  }
  var meta = {};
  for (var name in draft.meta || {}) {
    if (Object.prototype.hasOwnProperty.call(draft.meta, name)) {
      meta[name] = draft.meta[name];
    }
  }
  meta.keyword = keyword;
  copy.meta = meta;
  return copy;
}

/**
 * The selection view of an .ics file: per component its index, kind, title, date, whether it is
 * all-day or a series, the place, the keyword of `list` that matches, and whether it is in the
 * inbox of `owner` already (state and text of the existing entry). Saves nothing.
 * Returns { tooLarge } or { items, skipped }.
 */
function previewFile(app, owner, text, list) {
  var parsed = ical.parse(text, berlin);
  if (parsed.tooLarge) {
    return { tooLarge: true };
  }
  var items = [];
  for (var i = 0; i < parsed.drafts.length; i++) {
    var draft = parsed.drafts[i];
    var meta = draft.meta || {};
    var existing = service.lookup(app, owner, toInboxDraft(draft, 'ics', ''));
    items.push({
      index: i,
      kind: draft.kind,
      title: draft.title,
      source_date: draft.source_date || '',
      all_day: meta.all_day === true,
      series: typeof meta.rrule === 'string' && meta.rrule !== '',
      location: typeof meta.location === 'string' ? meta.location : '',
      keyword: keywordOf(draft, list),
      state: existing ? existing.state : '',
      message: existing ? existing.message : ''
    });
  }
  return { tooLarge: false, items: items, skipped: parsed.skipped };
}

/**
 * The chosen indices of a selection (an array or its JSON text): a non-empty list of distinct
 * whole numbers below `count`, or null.
 */
function selectionOf(value, count) {
  var list = value;
  if (typeof list === 'string') {
    try {
      list = JSON.parse(list);
    } catch (err) {
      return null;
    }
  }
  if (Object.prototype.toString.call(list) !== '[object Array]' || list.length === 0 || list.length > MAX_SELECTION) {
    return null;
  }
  var seen = {};
  for (var i = 0; i < list.length; i++) {
    var index = list[i];
    if (typeof index !== 'number' || index % 1 !== 0 || index < 0 || index >= count || seen[index]) {
      return null;
    }
    seen[index] = true;
  }
  return list;
}

/**
 * The .ics file of the route: the chosen components (`selection`, see selectionOf) become items
 * (channel "ics") with the matching keyword of `list` in meta.keyword. Returns { tooLarge },
 * { invalidSelection } or { created, skipped, duplicates, failed, item } where `item` is the ID
 * of the only new item (for a link in the result), else ''.
 */
function importFile(app, owner, text, selection, list) {
  var parsed = ical.parse(text, berlin);
  if (parsed.tooLarge) {
    return { tooLarge: true };
  }
  var chosen = selectionOf(selection, parsed.drafts.length);
  if (chosen === null) {
    return { tooLarge: false, invalidSelection: true };
  }
  var drafts = [];
  for (var i = 0; i < chosen.length; i++) {
    drafts.push(withKeyword(parsed.drafts[chosen[i]], list));
  }
  var summary = ingestDrafts(app, owner, drafts, 'ics', '');
  return {
    tooLarge: false,
    invalidSelection: false,
    created: summary.created,
    duplicates: summary.duplicates,
    skipped: parsed.skipped,
    failed: summary.failed,
    item: summary.created === 1 ? summary.createdItems[0].id : ''
  };
}

/**
 * The keywords of .ics files of the signed-in user (users.import_keywords, ADR-0020 section 3);
 * none before the migration 1790201500 or without a list.
 */
function userKeywords(auth) {
  var raw = auth ? auth.getString('import_keywords') : '';
  if (raw === '' || raw === 'null') {
    return [];
  }
  try {
    return keywords.importSettingsOf(JSON.parse(raw), 'ics').keywords;
  } catch (err) {
    return [];
  }
}

/**
 * The .ics file of a request of the routes (multipart field "file", at most 20 MB) as text, or
 * { unavailable: true } before the migrations of E4. Throws a BadRequestError with the reason.
 */
function uploadedText(e) {
  try {
    e.app.findCollectionByNameOrId('inbox_items');
  } catch (err) {
    return { unavailable: true };
  }
  var files = [];
  try {
    files = e.findUploadedFiles('file');
  } catch (err) {
    files = [];
  }
  if (!files || files.length !== 1) {
    throw new BadRequestError('Genau eine .ics-Datei erwartet.');
  }
  var file = files[0];
  if (file.size > MAX_FILE_BYTES || file.size > ical.MAX_TEXT_LENGTH) {
    throw new BadRequestError(TOO_LARGE);
  }
  var reader = file.reader.open();
  try {
    return { unavailable: false, text: toString(reader, MAX_FILE_BYTES) };
  } finally {
    reader.close();
  }
}

module.exports = {
  toInboxDraft: toInboxDraft,
  ingestDrafts: ingestDrafts,
  previewFile: previewFile,
  selectionOf: selectionOf,
  importFile: importFile,
  userKeywords: userKeywords,
  uploadedText: uploadedText,
  TOO_LARGE: TOO_LARGE,
  UNAVAILABLE: UNAVAILABLE
};
