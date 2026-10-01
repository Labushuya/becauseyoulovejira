// Content of discarded inbox items after 30 days (OF-E4-6, E4 plan package 24). Pure CommonJS
// module, ES5 only; berlin-time.js and inbox-rules.js are passed in, so the Goja runtime and
// Vitest load it the same way. The database part is lib/inbox-cleanup-service.js.
//
// A discarded item is a tombstone (ADR-0014 section 3): fingerprint, state, channel, kind,
// source_ref, source_url, source_date and connection stay, so no channel and no mailbox selection
// brings the object back. Text, original file and the details in source_meta go; the title is
// cut. The stored fingerprint is never computed again, so the details it was made of (sender,
// chat) are not needed any more.
'use strict';

// Days a discarded item keeps its content (answer to OF-E4-6).
var DISCARDED_RETENTION_DAYS = 30;

// Length of the title that stays, so the item stays recognisable under "Verworfen".
var PURGED_TITLE_MAX_LENGTH = 40;

// Text of a cleaned item; also marks it as cleaned (the run is idempotent).
var PURGED_BODY = '_Inhalt gelöscht: Der Eintrag war länger als 30 Tage verworfen._';

// Keys of source_meta that stay: the keyword and "all day" for the display, the recurrence ID of
// an event as part of its identity.
var KEPT_META_KEYS = ['keyword', 'all_day', 'recurrence_id'];

/**
 * First instant that is kept, as PocketBase date text: the start of the Berlin day
 * DISCARDED_RETENTION_DAYS days before today (ADR-0005). An item discarded before it is cleaned,
 * so it keeps its content for 30 full Berlin days: discarded on 1 March, cleaned from 1 April on.
 */
function cutoff(now, berlinTime) {
  var today = berlinTime.berlinToday(now);
  return berlinTime.toPocketBaseDate(berlinTime.berlinMidnight(berlinTime.addDays(today, -DISCARDED_RETENTION_DAYS)));
}

function keptMeta(meta) {
  var value = meta !== null && typeof meta === 'object' && Object.prototype.toString.call(meta) === '[object Object]' ? meta : {};
  var kept = {};
  for (var i = 0; i < KEPT_META_KEYS.length; i++) {
    var key = KEPT_META_KEYS[i];
    if (Object.prototype.hasOwnProperty.call(value, key)) {
      kept[key] = value[key];
    }
  }
  return kept;
}

function sameMeta(a, b) {
  var keysA = Object.keys(a);
  if (keysA.length !== Object.keys(b).length) {
    return false;
  }
  for (var i = 0; i < keysA.length; i++) {
    if (!Object.prototype.hasOwnProperty.call(b, keysA[i]) || a[keysA[i]] !== b[keysA[i]]) {
      return false;
    }
  }
  return true;
}

// Text of a source that stayed with a ticket in the trash ("Quellen verwerfen") and was emptied
// when the ticket was deleted for good (ADR-0037 §6). Since ADR-0047 a ticket of the trash goes
// for good only without bound sources, so no new tombstone gets it; existing ones count as cleaned.
var TRASH_PURGED_BODY = '_Inhalt gelöscht: Das Ticket wurde endgültig gelöscht._';

/**
 * The cleaned values of a discarded item { title, body, meta, original } (meta parsed, original
 * the file name or ''), or null if the item is cleaned already (with either text). Returns
 * { title, body, meta, clearOriginal } with `body` PURGED_BODY.
 */
function purgedValues(item, inboxRules) {
  var title = inboxRules.truncate(String(item.title || ''), PURGED_TITLE_MAX_LENGTH);
  var meta = keptMeta(item.meta);
  var clearOriginal = String(item.original || '') !== '';
  var unchanged =
    title === String(item.title || '') &&
    (item.body === PURGED_BODY || item.body === TRASH_PURGED_BODY) &&
    !clearOriginal &&
    sameMeta(meta, item.meta !== null && typeof item.meta === 'object' ? item.meta : {});
  if (unchanged) {
    return null;
  }
  return { title: title, body: PURGED_BODY, meta: meta, clearOriginal: clearOriginal };
}

module.exports = {
  DISCARDED_RETENTION_DAYS: DISCARDED_RETENTION_DAYS,
  PURGED_TITLE_MAX_LENGTH: PURGED_TITLE_MAX_LENGTH,
  PURGED_BODY: PURGED_BODY,
  TRASH_PURGED_BODY: TRASH_PURGED_BODY,
  KEPT_META_KEYS: KEPT_META_KEYS,
  cutoff: cutoff,
  purgedValues: purgedValues
};
