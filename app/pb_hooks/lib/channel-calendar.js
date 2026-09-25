// Google Calendar through the secret iCal address (ADR-0016 section 2, ADR-0020; E4 plan packages
// 15 and 20). Pure CommonJS module, ES5 only (Goja runtime and Vitest): which events of the feed
// come into the inbox (window and keywords), and whether an entry that is still new must follow a
// changed event. Fetching and saving happen in channel-calendar-run.js; berlin-time.js,
// inbox-rules.js and keywords.js are passed in.
'use strict';

// Window of the feed: today (Berlin) up to 30 days ahead.
var WINDOW_DAYS = 30;

function text(value) {
  return value === undefined || value === null ? '' : String(value);
}

// Last day of a series from RRULE UNTIL ("YYYY-MM-DD"), or '' without one. COUNT is not
// evaluated: such a series counts as running (E5 reads the rule).
function untilDate(rrule) {
  var match = /(?:^|;)UNTIL=(\d{4})(\d{2})(\d{2})/i.exec(text(rrule));
  return match ? match[1] + '-' + match[2] + '-' + match[3] : '';
}

/**
 * Drafts of the parser (ical.js) that lie in the window `today` .. `today` + `days`: a single
 * event or task overlaps the window with its dates; a series (RRULE) began at the latest on the
 * last day of the window and has not ended before today. Drafts without a date are left out.
 */
function selectDrafts(drafts, today, days, berlin) {
  var end = berlin.addDays(today, days);
  var selected = [];
  for (var i = 0; i < drafts.length; i++) {
    var draft = drafts[i];
    var start = text(draft.startDate);
    if (start === '' || start > end) {
      continue;
    }
    var rrule = draft.meta && draft.meta.rrule;
    if (rrule) {
      var until = untilDate(rrule);
      if (until === '' || until >= today) {
        selected.push(draft);
      }
    } else if (text(draft.endDate || start) >= today) {
      selected.push(draft);
    }
  }
  return selected;
}

/**
 * Keeps the drafts whose title or description matches one of `list` (ADR-0020 section 1) and notes
 * the keyword in `meta.keyword` (on a copy). Returns { matched, unmatched } with the number of
 * drafts without a match; those are not saved at all.
 */
function matchDrafts(drafts, list, keywords) {
  var result = { matched: [], unmatched: 0 };
  for (var i = 0; i < drafts.length; i++) {
    var draft = drafts[i];
    var keyword = keywords.matchKeyword(list, [draft.title, draft.body]);
    if (keyword === '') {
      result.unmatched++;
      continue;
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
    result.matched.push(copy);
  }
  return result;
}

// JSON of a plain object with sorted keys, so the order of the keys does not count as a change.
function stableJson(value) {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value === undefined ? null : value);
  }
  if (Object.prototype.toString.call(value) === '[object Array]') {
    var items = [];
    for (var i = 0; i < value.length; i++) {
      items.push(stableJson(value[i]));
    }
    return '[' + items.join(',') + ']';
  }
  var keys = [];
  for (var key in value) {
    if (Object.prototype.hasOwnProperty.call(value, key)) {
      keys.push(key);
    }
  }
  keys.sort();
  var parts = [];
  for (var k = 0; k < keys.length; k++) {
    parts.push(JSON.stringify(keys[k]) + ':' + stableJson(value[keys[k]]));
  }
  return '{' + parts.join(',') + '}';
}

/**
 * Whether an entry that is still new must take over a changed event (title, text, link, start or
 * details). `existing`: { title, body, source_url, source_date, meta } as stored; `draft`: the
 * parser draft. Titles and texts are compared as the hook stores them (`rules` = inbox-rules.js).
 */
function hasChanged(existing, draft, rules) {
  return (
    text(existing.title) !== rules.normalizeTitle(draft.title) ||
    text(existing.body) !== rules.normalizeBody(draft.body) ||
    text(existing.source_url) !== text(draft.source_url) ||
    text(existing.source_date) !== text(draft.source_date) ||
    stableJson(existing.meta || {}) !== stableJson(draft.meta || {})
  );
}

module.exports = {
  WINDOW_DAYS: WINDOW_DAYS,
  untilDate: untilDate,
  selectDrafts: selectDrafts,
  matchDrafts: matchDrafts,
  stableJson: stableJson,
  hasChanged: hasChanged
};
