// iCalendar parser for the inbox (ADR-0017 section 1, E4 plan package 14). Pure CommonJS module,
// ES5 only (Goja runtime and Vitest); it needs berlin-time.js, which the caller passes in, so the
// module has no require of its own and runs unchanged in both runtimes.
//
// Reads the small part of RFC 5545 the inbox needs: unfolding, properties with parameters and
// text escapes, VEVENT (kind "event") and VTODO (kind "todo", DUE as the date at the sender).
// Taken over: UID, RECURRENCE-ID, SUMMARY, DESCRIPTION, LOCATION, URL, DTSTART, DTEND or
// DURATION, DUE, STATUS (cancelled ones are skipped) and RRULE (raw, for E5). Everything else is
// ignored; nested components (VALARM) are not read.
//
// Times: DATE stays a calendar date (all day, stored as Berlin midnight); DATE-TIME with "Z" is
// UTC; TZID Europe/Berlin and the Windows name "W. Europe Standard Time" are converted with the
// EU rule of berlin-time.js; every other TZID and floating times are read as Berlin local time
// and marked `tz_approx` (the date is only a hint and never becomes the due date, P-5).
'use strict';

// Largest file or feed (ADR-0017 section 1), in characters of the decoded text.
var MAX_TEXT_LENGTH = 20 * 1024 * 1024;
// Most VEVENT/VTODO components read from one file; the rest count as skipped.
var MAX_COMPONENTS = 5000;
// Limits of inbox_items (ADR-0014 section 1).
var MAX_REF_LENGTH = 500;
var MAX_URL_LENGTH = 2000;
var MAX_META_TEXT = 2000;

var ENTRY_TYPES = { VEVENT: 'event', VTODO: 'todo' };
var BERLIN_TZIDS = ['w. europe standard time', 'europe/berlin'];
var NAME = /^[A-Za-z0-9-]+$/;
var DATE_VALUE = /^(\d{4})(\d{2})(\d{2})$/;
var DATE_TIME_VALUE = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/;
var DURATION_VALUE = /^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/;

function text(value) {
  return value === undefined || value === null ? '' : String(value);
}

function cut(value, max) {
  var input = text(value);
  return input.length <= max ? input : input.slice(0, max);
}

// Physical lines -> logical lines. Each logical line keeps its raw text (folds included) for the
// original snippet. CRLF, LF and a lone CR end a line; a leading BOM is dropped.
function unfold(input) {
  var source = text(input);
  if (source.charCodeAt(0) === 0xfeff) {
    source = source.slice(1);
  }
  var physical = source.split(/\r\n|\n|\r/);
  var lines = [];
  for (var i = 0; i < physical.length; i++) {
    var line = physical[i];
    var first = line.charAt(0);
    if ((first === ' ' || first === '\t') && lines.length > 0) {
      var last = lines[lines.length - 1];
      last.value += line.slice(1);
      last.raw += '\r\n' + line;
    } else if (line !== '') {
      lines.push({ value: line, raw: line });
    }
  }
  return lines;
}

// "NAME;P1=a;P2="x:y",b:value" -> { name, params: { P1: ['a'], P2: ['x:y', 'b'] }, value } or
// null for a line that is no property.
function parseLine(line) {
  var i = 0;
  var length = line.length;
  while (i < length && line.charAt(i) !== ';' && line.charAt(i) !== ':') {
    i++;
  }
  var name = line.slice(0, i).toUpperCase();
  if (i >= length || !NAME.test(name)) {
    return null;
  }
  var params = {};
  while (line.charAt(i) === ';') {
    i++;
    var start = i;
    while (i < length && line.charAt(i) !== '=' && line.charAt(i) !== ';' && line.charAt(i) !== ':') {
      i++;
    }
    var paramName = line.slice(start, i).toUpperCase();
    var values = [];
    if (line.charAt(i) === '=') {
      i++;
      for (;;) {
        var value = '';
        if (line.charAt(i) === '"') {
          var close = line.indexOf('"', i + 1);
          if (close === -1) {
            return null;
          }
          value = line.slice(i + 1, close);
          i = close + 1;
        } else {
          var from = i;
          while (i < length && line.charAt(i) !== ',' && line.charAt(i) !== ';' && line.charAt(i) !== ':') {
            i++;
          }
          value = line.slice(from, i);
        }
        values.push(value);
        if (line.charAt(i) !== ',') {
          break;
        }
        i++;
      }
    }
    if (!NAME.test(paramName)) {
      return null;
    }
    params[paramName] = values;
  }
  if (line.charAt(i) !== ':') {
    return null;
  }
  return { name: name, params: params, value: line.slice(i + 1) };
}

// TEXT value: \n and \N are line breaks, \, \; and \\ the characters themselves.
function unescapeText(value) {
  return text(value).replace(/\\([nN,;\\])/g, function (match, character) {
    return character === 'n' || character === 'N' ? '\n' : character;
  });
}

function param(property, name) {
  var values = property.params[name];
  return values && values.length > 0 ? values[0] : '';
}

function isBerlinTzid(tzid) {
  var name = text(tzid).replace(/^\s+|\s+$/g, '').toLowerCase();
  for (var i = 0; i < BERLIN_TZIDS.length; i++) {
    var known = BERLIN_TZIDS[i];
    // Some exporters put a path in front: "/mozilla.org/20050126_1/Europe/Berlin".
    if (name === known || name.slice(-(known.length + 1)) === '/' + known) {
      return true;
    }
  }
  return false;
}

/**
 * DATE or DATE-TIME value -> { ms, allDay, date, approx } or null. `date` is the calendar date of
 * an all-day value, else ''. `berlin` is the berlin-time.js module.
 */
function parseDateValue(property, berlin) {
  var value = text(property.value).replace(/^\s+|\s+$/g, '');
  var type = param(property, 'VALUE').toUpperCase();
  var dateOnly = DATE_VALUE.exec(value);
  if (dateOnly && type !== 'DATE-TIME') {
    var date = dateOnly[1] + '-' + dateOnly[2] + '-' + dateOnly[3];
    if (!berlin.isCalendarDate(date)) {
      return null;
    }
    return { ms: berlin.berlinMidnight(date), allDay: true, date: date, approx: false };
  }
  var match = DATE_TIME_VALUE.exec(value);
  if (!match || type === 'DATE') {
    return null;
  }
  var day = match[1] + '-' + match[2] + '-' + match[3];
  if (!berlin.isCalendarDate(day) || Number(match[4]) > 23 || Number(match[5]) > 59 || Number(match[6]) > 60) {
    return null;
  }
  if (match[7] === 'Z') {
    var utc = Date.UTC(
      Number(match[1]),
      Number(match[2]) - 1,
      Number(match[3]),
      Number(match[4]),
      Number(match[5]),
      Math.min(Number(match[6]), 59)
    );
    return { ms: utc, allDay: false, date: '', approx: false };
  }
  var time = match[4] + ':' + match[5] + ':' + (match[6] === '60' ? '59' : match[6]);
  return {
    ms: berlin.berlinWallClockToUtc(day, time),
    allDay: false,
    date: '',
    approx: !isBerlinTzid(param(property, 'TZID'))
  };
}

// DURATION value -> milliseconds, or null.
function parseDuration(value) {
  var match = DURATION_VALUE.exec(text(value).replace(/^\s+|\s+$/g, ''));
  if (!match || match[0] === 'P' || match[0] === '+P' || match[0] === '-P') {
    return null;
  }
  var ms =
    Number(match[2] || 0) * 7 * 86400000 +
    Number(match[3] || 0) * 86400000 +
    Number(match[4] || 0) * 3600000 +
    Number(match[5] || 0) * 60000 +
    Number(match[6] || 0) * 1000;
  return match[1] === '-' ? -ms : ms;
}

// RECURRENCE-ID in one form for the duplicate key, so the same occurrence from a file and from
// the feed gives the same value: "YYYYMMDD" for a date, else the UTC time "YYYYMMDDTHHMMSSZ".
function recurrenceKey(property, berlin) {
  var parsed = parseDateValue(property, berlin);
  if (!parsed) {
    return text(property.value).replace(/^\s+|\s+$/g, '');
  }
  if (parsed.allDay) {
    return parsed.date.replace(/-/g, '');
  }
  return berlin.toPocketBaseDate(parsed.ms).replace(/[-:]/g, '').replace(' ', 'T').slice(0, 15) + 'Z';
}

function isHttpUrl(value) {
  return /^https?:\/\/[^\s]+$/i.test(value) && value.length <= MAX_URL_LENGTH;
}

// Calendar date in Berlin of an instant, or the date itself for an all-day value.
function calendarDate(parsed, berlin) {
  return parsed.allDay ? parsed.date : berlin.berlinToday(parsed.ms);
}

/**
 * One VEVENT/VTODO -> draft for the inbox, or { skip: 'cancelled' }.
 * Draft: { kind, title, body, source_url, source_ref, source_date, meta, startDate, endDate,
 * original }. `startDate`/`endDate` are Berlin calendar dates ('' when unknown) for the window of
 * the calendar feed; `meta.recurrence_id` belongs to the duplicate key (ADR-0014 section 3).
 */
function toDraft(component, berlin, envelope) {
  var props = {};
  for (var i = 0; i < component.properties.length; i++) {
    var property = component.properties[i];
    if (!props[property.name]) {
      props[property.name] = property;
    }
  }
  var status = props.STATUS ? text(props.STATUS.value).toUpperCase() : '';
  if (status === 'CANCELLED' || envelope.cancelled) {
    return { skip: 'cancelled' };
  }
  var kind = ENTRY_TYPES[component.type];
  var meta = {};
  var summary = props.SUMMARY ? unescapeText(props.SUMMARY.value) : '';
  var title = summary.replace(/\s+/g, ' ').replace(/^ | $/g, '');

  var start = props.DTSTART ? parseDateValue(props.DTSTART, berlin) : null;
  var due = props.DUE ? parseDateValue(props.DUE, berlin) : null;
  var main = kind === 'todo' ? due || start : start;
  var end = null;
  if (kind === 'event' && start) {
    if (props.DTEND) {
      end = parseDateValue(props.DTEND, berlin);
    } else if (props.DURATION) {
      var duration = parseDuration(props.DURATION.value);
      if (duration !== null) {
        end = {
          ms: start.ms + duration,
          allDay: start.allDay,
          date: start.allDay ? berlin.berlinToday(start.ms + duration) : '',
          approx: start.approx
        };
      }
    }
  }

  if (main && main.allDay) {
    meta.all_day = true;
  }
  if (main && main.approx) {
    meta.tz_approx = true;
  }
  if (end) {
    meta.end = berlin.toPocketBaseDate(end.ms);
  }
  if (props['RECURRENCE-ID']) {
    meta.recurrence_id = recurrenceKey(props['RECURRENCE-ID'], berlin);
  }
  if (props.LOCATION) {
    var location = unescapeText(props.LOCATION.value).replace(/^\s+|\s+$/g, '');
    if (location !== '') {
      meta.location = cut(location, MAX_META_TEXT);
    }
  }
  if (props.RRULE) {
    meta.rrule = cut(text(props.RRULE.value).replace(/^\s+|\s+$/g, ''), MAX_META_TEXT);
  }

  var url = props.URL ? text(props.URL.value).replace(/^\s+|\s+$/g, '') : '';
  var startDate = main ? calendarDate(main, berlin) : '';
  var endDate = startDate;
  if (end && startDate !== '') {
    // An all-day DTEND is exclusive: the event ends the day before.
    var last = end.allDay ? berlin.addDays(end.date, -1) : berlin.berlinToday(end.ms);
    endDate = last > startDate ? last : startDate;
  }

  return {
    kind: kind,
    title: title === '' ? '(ohne Titel)' : title,
    body: props.DESCRIPTION ? unescapeText(props.DESCRIPTION.value) : '',
    source_url: isHttpUrl(url) ? url : '',
    source_ref: props.UID ? cut(text(props.UID.value).replace(/^\s+|\s+$/g, ''), MAX_REF_LENGTH) : '',
    source_date: main ? berlin.toPocketBaseDate(main.ms) : '',
    meta: meta,
    startDate: startDate,
    endDate: endDate,
    original: snippet(component, envelope)
  };
}

// The component in its own VCALENDAR with VERSION, PRODID and the VTIMEZONE blocks its TZIDs
// name, so the original opens in a calendar program on its own.
function snippet(component, envelope) {
  var lines = ['BEGIN:VCALENDAR'];
  lines.push(envelope.version || 'VERSION:2.0');
  if (envelope.prodid) {
    lines.push(envelope.prodid);
  }
  var used = {};
  for (var i = 0; i < component.properties.length; i++) {
    var tzid = param(component.properties[i], 'TZID');
    if (tzid !== '' && envelope.timezones[tzid] && !used[tzid]) {
      used[tzid] = true;
      lines.push(envelope.timezones[tzid]);
    }
  }
  lines.push(component.raw.join('\r\n'));
  lines.push('END:VCALENDAR');
  return lines.join('\r\n') + '\r\n';
}

/**
 * Parses an iCalendar text. `berlin` is the berlin-time.js module.
 * Returns { drafts, skipped, invalidLines, tooLarge }: `skipped` counts cancelled components and
 * those over MAX_COMPONENTS, `invalidLines` lines that are no property (they are ignored).
 * A text over MAX_TEXT_LENGTH is not read at all (`tooLarge`).
 */
function parse(input, berlin) {
  var result = { drafts: [], skipped: 0, invalidLines: 0, tooLarge: false };
  if (text(input).length > MAX_TEXT_LENGTH) {
    result.tooLarge = true;
    return result;
  }
  var lines = unfold(input);
  var envelope = { version: '', prodid: '', cancelled: false, timezones: {} };
  var components = [];
  var stack = [];
  var entry = null;
  var timezone = null;
  var count = 0;

  for (var i = 0; i < lines.length; i++) {
    var line = lines[i];
    var property = parseLine(line.value);
    if (!property) {
      result.invalidLines++;
      continue;
    }
    var value = text(property.value).replace(/^\s+|\s+$/g, '').toUpperCase();
    if (property.name === 'BEGIN') {
      stack.push(value);
      if (stack.length === 2 && stack[0] === 'VCALENDAR' && ENTRY_TYPES[value]) {
        count++;
        entry = count <= MAX_COMPONENTS ? { type: value, properties: [], raw: [] } : null;
        if (!entry) {
          result.skipped++;
        }
      } else if (stack.length === 2 && stack[0] === 'VCALENDAR' && value === 'VTIMEZONE') {
        timezone = { tzid: '', raw: [] };
      }
    }
    if (entry) {
      entry.raw.push(line.raw);
      if (stack.length === 2 && property.name !== 'BEGIN' && property.name !== 'END') {
        entry.properties.push(property);
      }
    } else if (timezone) {
      timezone.raw.push(line.raw);
      if (stack.length === 2 && property.name === 'TZID') {
        timezone.tzid = text(property.value).replace(/^\s+|\s+$/g, '');
      }
    } else if (stack.length === 1 && stack[0] === 'VCALENDAR') {
      if (property.name === 'VERSION') {
        envelope.version = line.raw;
      } else if (property.name === 'PRODID') {
        envelope.prodid = line.raw;
      } else if (property.name === 'METHOD' && value === 'CANCEL') {
        envelope.cancelled = true;
      }
    }
    if (property.name === 'END') {
      if (stack.length === 0 || stack[stack.length - 1] !== value) {
        result.invalidLines++;
        continue;
      }
      stack.pop();
      if (stack.length === 1 && entry) {
        components.push(entry);
        entry = null;
      } else if (stack.length === 1 && timezone) {
        if (timezone.tzid !== '') {
          envelope.timezones[timezone.tzid] = timezone.raw.join('\r\n');
        }
        timezone = null;
      }
    }
  }

  if (entry) {
    // The file ends inside a component (cut off): it is not taken over.
    result.skipped++;
  }
  for (var c = 0; c < components.length; c++) {
    var draft = toDraft(components[c], berlin, envelope);
    if (draft.skip) {
      result.skipped++;
    } else {
      result.drafts.push(draft);
    }
  }
  return result;
}

module.exports = {
  MAX_TEXT_LENGTH: MAX_TEXT_LENGTH,
  MAX_COMPONENTS: MAX_COMPONENTS,
  unfold: unfold,
  parseLine: parseLine,
  unescapeText: unescapeText,
  parseDuration: parseDuration,
  parse: parse
};
