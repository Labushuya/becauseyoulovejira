// One run of a Google Calendar connection (ADR-0016 section 2, ADR-0020; E4 plan packages 15 and
// 20): fetch the secret iCal address, parse it with the parser of the .ics files, take the events
// of the window whose title or description matches a keyword of the connection into the inbox
// (channel "calendar", fingerprint UID plus RECURRENCE-ID, so the same event from a file and from
// the feed is one entry; events without a match are not saved) and let entries that are still new
// follow a changed event. Discarded and converted entries stay as they are. Called by
// channel-runner.js, which holds the lock and cleans errors. CommonJS module, ES5 only, Goja
// runtime only.
'use strict';

var ical = require(__hooks + '/lib/ical.js');
var berlin = require(__hooks + '/lib/berlin-time.js');
var calendar = require(__hooks + '/lib/channel-calendar.js');
var inboxRules = require(__hooks + '/lib/inbox-rules.js');
var keywords = require(__hooks + '/lib/keywords.js');
var rules = require(__hooks + '/lib/connection-rules.js');
var inboxIcs = require(__hooks + '/lib/inbox-ics.js');
var service = require(__hooks + '/lib/inbox-service.js');

function metaOf(record) {
  var raw = record.getString('source_meta');
  if (raw === '' || raw === 'null') {
    return {};
  }
  try {
    var value = JSON.parse(raw);
    return value && typeof value === 'object' ? value : {};
  } catch (err) {
    return {};
  }
}

function settingsOf(record) {
  var raw = record.getString('settings');
  if (raw === '' || raw === 'null') {
    return null;
  }
  try {
    return JSON.parse(raw);
  } catch (err) {
    return null;
  }
}

// A new entry follows the changed event; returns true if it was saved.
function follow(app, existing, draft) {
  if (existing.getString('state') !== 'new') {
    return false;
  }
  var stored = {
    title: existing.getString('title'),
    body: existing.getString('body'),
    source_url: existing.getString('source_url'),
    source_date: existing.getString('source_date'),
    meta: metaOf(existing)
  };
  if (!calendar.hasChanged(stored, draft, inboxRules)) {
    return false;
  }
  existing.set('title', inboxRules.normalizeTitle(draft.title));
  existing.set('body', inboxRules.normalizeBody(draft.body));
  existing.set('source_url', draft.source_url);
  existing.set('source_date', draft.source_date);
  existing.set('source_meta', draft.meta);
  existing.set('original', $filesystem.fileFromBytes(draft.original, draft.kind === 'todo' ? 'aufgabe.ics' : 'termin.ics'));
  app.save(existing);
  return true;
}

/**
 * values.secret is the iCal address. Returns { created, duplicates, updated, skipped, failed,
 * unmatched } or
 * { error } with a text that may still hold the address (the runner cleans it).
 */
function run(app, record, values) {
  var limits = require(__hooks + '/lib/channel-runner.js');
  if (!/^https?:\/\/\S+$/i.test(values.secret)) {
    return { error: 'Die Variable enthält keine http- oder https-Adresse.' };
  }
  var response = $http.send({
    url: values.secret,
    method: 'GET',
    timeout: limits.HTTP_TIMEOUT_SECONDS,
    headers: { Accept: 'text/calendar' }
  });
  if (response.statusCode !== 200) {
    return { error: 'Der Kalender antwortet mit HTTP ' + response.statusCode + '. Stimmt die geheime Adresse noch?' };
  }
  if (response.body.length > limits.MAX_BODY_BYTES) {
    return { error: 'Die Antwort des Kalenders ist größer als 20 MB und wurde verworfen.' };
  }
  var text = toString(response.body);
  if (text.indexOf('BEGIN:VCALENDAR') === -1) {
    return { error: 'Die Antwort ist kein Kalender im iCal-Format.' };
  }
  var parsed = ical.parse(text, berlin);
  var inWindow = calendar.selectDrafts(parsed.drafts, berlin.berlinToday(Date.now()), calendar.WINDOW_DAYS, berlin);
  var list = rules.keywordsOf(settingsOf(record), keywords);
  var matching = calendar.matchDrafts(inWindow, list, keywords);
  var drafts = matching.matched;
  var owner = record.getString('owner');
  var outcome = {
    created: 0,
    duplicates: 0,
    updated: 0,
    skipped: parsed.skipped,
    failed: 0,
    unmatched: matching.unmatched
  };
  for (var i = 0; i < drafts.length; i++) {
    if (outcome.created >= limits.MAX_NEW_PER_RUN) {
      outcome.skipped += drafts.length - i;
      break;
    }
    var saved;
    try {
      saved = service.ingest(app, owner, inboxIcs.toInboxDraft(drafts[i], 'calendar', record.id));
    } catch (err) {
      // One event the inbox refuses does not stop the others.
      outcome.failed++;
      continue;
    }
    if (saved.kind === 'created') {
      outcome.created++;
      continue;
    }
    try {
      if (follow(app, saved.item, drafts[i])) {
        outcome.updated++;
      } else {
        outcome.duplicates++;
      }
    } catch (err) {
      outcome.failed++;
    }
  }
  return outcome;
}

module.exports = {
  run: run
};
