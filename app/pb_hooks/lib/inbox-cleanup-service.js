// Cleans discarded inbox items after DISCARDED_RETENTION_DAYS days (OF-E4-6, E4 plan package 24):
// the database part of lib/inbox-cleanup.js. CommonJS module, ES5 only, Goja runtime only; the
// cron job in inbox.pb.js calls run($app, Date.now()).
'use strict';

var cleanup = require(__hooks + '/lib/inbox-cleanup.js');
var berlinTime = require(__hooks + '/lib/berlin-time.js');
var rules = require(__hooks + '/lib/inbox-rules.js');
var service = require(__hooks + '/lib/inbox-service.js');

var INBOX = 'inbox_items';
var BATCH_SIZE = 200;

// Discarded before the cutoff and after the last item of the previous batch (by ID, so an item
// that stays unchanged or fails does not come again in the same run).
var FILTER = "state = 'discarded' && handled_at != '' && handled_at < {:cutoff} && id > {:after}";

/**
 * One run over all scopes. Idempotent: a cleaned item is left alone. A failing item is logged
 * and counted; the others go on. Returns { checked, cleaned, failed, unavailable }.
 */
function run(app, now) {
  var result = { checked: 0, cleaned: 0, failed: 0, unavailable: false };
  try {
    app.findCollectionByNameOrId(INBOX);
  } catch (err) {
    result.unavailable = true;
    return result;
  }
  var limit = cleanup.cutoff(now, berlinTime);
  var after = '';
  for (;;) {
    var batch = app.findRecordsByFilter(INBOX, FILTER, 'id', BATCH_SIZE, 0, { cutoff: limit, after: after });
    for (var i = 0; i < batch.length; i++) {
      var record = batch[i];
      after = record.id;
      result.checked += 1;
      try {
        if (clean(app, record)) {
          result.cleaned += 1;
        }
      } catch (err) {
        result.failed += 1;
        app.logger().warn('Eingang: verworfenen Eintrag nicht bereinigt', 'item', record.id, 'error', String(err));
      }
    }
    if (batch.length < BATCH_SIZE) {
      break;
    }
  }
  if (result.cleaned > 0 || result.failed > 0) {
    app
      .logger()
      .info('Eingang: verworfene Einträge bereinigt', 'cleaned', result.cleaned, 'failed', result.failed, 'cutoff', limit);
  }
  return result;
}

// Saves the cleaned values; false if the item is cleaned already. The record hook keeps state,
// handled_at and fingerprint; PocketBase deletes the removed original file after the save.
function clean(app, record) {
  var values = cleanup.purgedValues(
    {
      title: record.getString('title'),
      body: record.getString('body'),
      meta: service.metaOf(record),
      original: record.getString('original')
    },
    rules
  );
  if (values === null) {
    return false;
  }
  record.set('title', values.title);
  record.set('body', values.body);
  record.set('source_meta', values.meta);
  if (values.clearOriginal) {
    record.set('original', '');
  }
  app.save(record);
  return true;
}

module.exports = {
  run: run,
  // "Verworfene jetzt leeren" of the page "Speicher" (ADR-0047 §6) empties the same way.
  clean: clean
};
