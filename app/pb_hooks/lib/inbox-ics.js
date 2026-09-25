// Takes an iCalendar text into the inbox (ADR-0017 section 1, E4 plan packages 14 and 15): the
// .ics route and the calendar feed share it. CommonJS module, ES5 only, Goja runtime only (it
// writes through inbox-service.js).
'use strict';

var ical = require(__hooks + '/lib/ical.js');
var berlin = require(__hooks + '/lib/berlin-time.js');
var service = require(__hooks + '/lib/inbox-service.js');

var ORIGINAL_NAMES = { event: 'termin.ics', todo: 'aufgabe.ics' };

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

/**
 * The .ics file of the route: every VEVENT/VTODO becomes an item (channel "ics").
 * Returns { tooLarge } or { created, skipped, duplicates, failed, item } where `item` is the ID
 * of the only new item (for a link in the result), else ''.
 */
function importFile(app, owner, text) {
  var parsed = ical.parse(text, berlin);
  if (parsed.tooLarge) {
    return { tooLarge: true };
  }
  var summary = ingestDrafts(app, owner, parsed.drafts, 'ics', '');
  return {
    tooLarge: false,
    created: summary.created,
    duplicates: summary.duplicates,
    skipped: parsed.skipped,
    failed: summary.failed,
    item: summary.created === 1 ? summary.createdItems[0].id : ''
  };
}

module.exports = {
  toInboxDraft: toInboxDraft,
  ingestDrafts: ingestDrafts,
  importFile: importFile
};
