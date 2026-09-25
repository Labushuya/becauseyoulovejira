// Berlin calendar date and wall-clock time without the time zone data of the runtime (ADR-0005).
// Pure CommonJS module, ES5 only, no dependencies (Goja runtime and Vitest). The official Windows
// binary of PocketBase has no tzdata: a DateTime with the zone name "Europe/Berlin" silently
// gives UTC, and the local Date methods follow the Windows setting of the machine. This module
// therefore implements the EU daylight saving rule itself: summer time (UTC+2) from the last
// Sunday of March, 01:00 UTC, to the last Sunday of October, 01:00 UTC; otherwise UTC+1.
//
// Mirror of web/src/lib/domain/berlin-date.ts; tests/unit/berlin-time.test.mjs compares both.
'use strict';

var MINUTE_MS = 60 * 1000;
var HOUR_MS = 60 * MINUTE_MS;
var DAY_MS = 24 * HOUR_MS;
var CALENDAR_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
var TIME_OF_DAY = /^([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?$/;

function toMs(instant) {
  var ms = typeof instant === 'number' ? instant : instant instanceof Date ? instant.getTime() : NaN;
  if (typeof ms !== 'number' || !isFinite(ms)) {
    throw new RangeError('Invalid point in time');
  }
  return ms;
}

function pad(value, length) {
  var text = String(value);
  while (text.length < length) {
    text = '0' + text;
  }
  return text;
}

// UTC instant (ms) of the last Sunday of a month (0-based), 01:00 UTC.
function lastSundayAtOneUtc(year, month) {
  var lastDay = new Date(Date.UTC(year, month + 1, 0));
  var sunday = lastDay.getUTCDate() - lastDay.getUTCDay();
  return Date.UTC(year, month, sunday, 1);
}

// Offset of Berlin local time to UTC at the given instant, in hours (1 or 2).
function berlinOffsetHours(instant) {
  var ms = toMs(instant);
  var year = new Date(ms).getUTCFullYear();
  var summer = ms >= lastSundayAtOneUtc(year, 2) && ms < lastSundayAtOneUtc(year, 9);
  return summer ? 2 : 1;
}

function formatUtcDate(ms) {
  var date = new Date(ms);
  return (
    pad(date.getUTCFullYear(), 4) + '-' + pad(date.getUTCMonth() + 1, 2) + '-' + pad(date.getUTCDate(), 2)
  );
}

// UTC midnight (ms) of a calendar date `YYYY-MM-DD`; throws for anything but a real date.
function parseCalendarDate(date) {
  var match = CALENDAR_DATE.exec(String(date));
  if (!match) {
    throw new RangeError('Not a calendar date: ' + date);
  }
  var ms = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  if (formatUtcDate(ms) !== date) {
    throw new RangeError('Not a calendar date: ' + date);
  }
  return ms;
}

function isCalendarDate(value) {
  try {
    parseCalendarDate(value);
    return true;
  } catch (err) {
    return false;
  }
}

// Berlin calendar date (`YYYY-MM-DD`) at the given point in time (ms or Date).
function berlinToday(instant) {
  var ms = toMs(instant);
  return formatUtcDate(ms + berlinOffsetHours(ms) * HOUR_MS);
}

// Calendar date `days` days after `date` (negative values go back).
function addDays(date, days) {
  if (typeof days !== 'number' || Math.floor(days) !== days) {
    throw new RangeError('Not a whole number of days: ' + days);
  }
  return formatUtcDate(parseCalendarDate(date) + days * DAY_MS);
}

// UTC instant (ms) of a local time given as milliseconds since the epoch "as if UTC". In the
// hour the clocks go back the summer time is taken; a time in the skipped hour of the spring
// change comes out one hour later, as a clock would show it (same rule as berlin-date.ts).
function localToUtc(localMs) {
  var summerCandidate = localMs - 2 * HOUR_MS;
  return berlinOffsetHours(summerCandidate) === 2 ? summerCandidate : localMs - HOUR_MS;
}

// UTC instant (ms) of a Berlin wall-clock time: `date` at `time` (`HH:MM` or `HH:MM:SS`,
// midnight without one).
function berlinWallClockToUtc(date, time) {
  var clock = time === undefined ? '00:00' : String(time);
  var match = TIME_OF_DAY.exec(clock);
  if (!match) {
    throw new RangeError('Not a time of day: ' + clock);
  }
  var local =
    parseCalendarDate(date) +
    Number(match[1]) * HOUR_MS +
    Number(match[2]) * MINUTE_MS +
    Number(match[3] || 0) * 1000;
  return localToUtc(local);
}

// UTC instant (ms) at which the given calendar date begins in Berlin.
function berlinMidnight(date) {
  return berlinWallClockToUtc(date, '00:00');
}

// Date value as PocketBase stores it: `YYYY-MM-DD HH:MM:SS.mmmZ` (UTC).
function toPocketBaseDate(instant) {
  var date = new Date(toMs(instant));
  return (
    formatUtcDate(date.getTime()) +
    ' ' +
    pad(date.getUTCHours(), 2) +
    ':' +
    pad(date.getUTCMinutes(), 2) +
    ':' +
    pad(date.getUTCSeconds(), 2) +
    '.' +
    pad(date.getUTCMilliseconds(), 3) +
    'Z'
  );
}

module.exports = {
  HOUR_MS: HOUR_MS,
  DAY_MS: DAY_MS,
  berlinOffsetHours: berlinOffsetHours,
  parseCalendarDate: parseCalendarDate,
  isCalendarDate: isCalendarDate,
  berlinToday: berlinToday,
  addDays: addDays,
  berlinWallClockToUtc: berlinWallClockToUtc,
  berlinMidnight: berlinMidnight,
  toPocketBaseDate: toPocketBaseDate
};
