// Dates of recurring tasks (CLAUDE.md section 6, ADR-0021 sections 2 and 3). Pure CommonJS
// module, ES5 only, without require (Goja runtime and Vitest). Every date is a calendar date
// `YYYY-MM-DD` without time and without time zone; "today" is always a parameter (the Berlin
// date from berlin-time.js, ADR-0005). Internally a date is its day number since 1970-01-01, and
// every function jumps arithmetically to the matching period instead of looping over days, so a
// gap of ten years costs as much as one of a day.
//
// Mirror of web/src/lib/domain/recurrence.ts; tests/unit/web-recurrence.test.mjs compares both
// with the shared table tests/fixtures/recurrence/cases.json and random rules.
'use strict';

var DAY_MS = 24 * 60 * 60 * 1000;
var CALENDAR_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

var MODES = ['calendar', 'after_completion'];
var FREQS = ['daily', 'weekly', 'monthly', 'yearly'];
// RFC 5545 weekday codes, Monday first (ISO weeks, ADR-0021 section 2).
var WEEKDAYS = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'];
var INTERVAL_MIN = 1;
var INTERVAL_MAX = 365;
var LEAD_DAYS_MIN = 0;
var LEAD_DAYS_MAX = 30;
// OF-E5-1 (recommendation until the user answers): the ticket appears 3 days before it is due.
var DEFAULT_LEAD_DAYS = 3;
var LAST_DAY = -1;
var MONTH_DAY_MAX = 31;
var ANCHOR_MIN_YEAR = 1900;
var ANCHOR_MAX_YEAR = 2999;

var CODES = {
  mode: 'validation_recurrence_mode',
  freq: 'validation_recurrence_freq',
  interval: 'validation_recurrence_interval',
  weekdays: 'validation_recurrence_weekdays',
  weekdaysMode: 'validation_recurrence_weekdays_mode',
  monthDay: 'validation_recurrence_month_day',
  monthDayMode: 'validation_recurrence_month_day_mode',
  anchor: 'validation_recurrence_anchor',
  leadDays: 'validation_recurrence_lead_days'
};

function pad(value, length) {
  var text = String(value);
  while (text.length < length) {
    text = '0' + text;
  }
  return text;
}

function isWholeNumber(value) {
  return typeof value === 'number' && isFinite(value) && Math.floor(value) === value;
}

// Day number of a calendar date, or NaN for anything but a real date.
function dayOf(date) {
  var match = CALENDAR_DATE.exec(String(date));
  if (!match) {
    return NaN;
  }
  var year = Number(match[1]);
  var month = Number(match[2]) - 1;
  var day = Number(match[3]);
  var ms = Date.UTC(year, month, day);
  var check = new Date(ms);
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month || check.getUTCDate() !== day) {
    return NaN;
  }
  return Math.round(ms / DAY_MS);
}

function requireDay(date) {
  var day = dayOf(date);
  if (isNaN(day)) {
    throw new RangeError('Not a calendar date: ' + date);
  }
  return day;
}

function dateOf(dayNumber) {
  var date = new Date(dayNumber * DAY_MS);
  return (
    pad(date.getUTCFullYear(), 4) + '-' + pad(date.getUTCMonth() + 1, 2) + '-' + pad(date.getUTCDate(), 2)
  );
}

function isCalendarDate(value) {
  return typeof value === 'string' && !isNaN(dayOf(value));
}

// Weekday index of a day number, Monday = 0 ... Sunday = 6 (1970-01-01 was a Thursday).
function weekdayIndex(dayNumber) {
  return (((dayNumber + 3) % 7) + 7) % 7;
}

function daysInMonth(year, month) {
  return new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
}

// Day number of `day` in a month counted as year * 12 + month; the day is clamped to the last
// day of the month, and -1 is the last day (ADR-0021 section 2: clamping instead of skipping).
function dayInMonth(monthIndex, day) {
  var year = Math.floor(monthIndex / 12);
  var month = monthIndex - year * 12;
  var last = daysInMonth(year, month);
  var target = day === LAST_DAY ? last : Math.min(day, last);
  return Math.round(Date.UTC(year, month, target) / DAY_MS);
}

function monthIndexOf(dayNumber) {
  var date = new Date(dayNumber * DAY_MS);
  return date.getUTCFullYear() * 12 + date.getUTCMonth();
}

function dayOfMonth(dayNumber) {
  return new Date(dayNumber * DAY_MS).getUTCDate();
}

function floorDiv(a, b) {
  return Math.floor(a / b);
}

function ceilDiv(a, b) {
  return Math.ceil(a / b);
}

function isEmpty(value) {
  return value === undefined || value === null || value === '' || value === 0;
}

function weekdayList(value) {
  if (value === undefined || value === null || value === '') {
    return [];
  }
  return Object.prototype.toString.call(value) === '[object Array]' ? value.slice() : [value];
}

function sortedWeekdays(list) {
  var result = [];
  for (var i = 0; i < WEEKDAYS.length; i++) {
    if (list.indexOf(WEEKDAYS[i]) !== -1) {
      result.push(WEEKDAYS[i]);
    }
  }
  return result;
}

// Rule with its defaults (ADR-0021 section 3): interval 1, lead time 3 days, weekdays or day of
// the month from the anchor for calendar rules. PocketBase stores an empty number field as 0, so
// 0 counts as "not set" for `interval` and `month_day` (not for `lead_days`, where 0 means "on
// the day itself"). Values that do not belong to the rhythm are kept, so validate can reject
// them; nothing else is changed.
function normalize(rule) {
  var source = rule || {};
  var result = {
    mode: source.mode === undefined || source.mode === null ? '' : source.mode,
    freq: source.freq === undefined || source.freq === null ? '' : source.freq,
    interval: isEmpty(source.interval) ? 1 : source.interval,
    weekdays: weekdayList(source.weekdays),
    month_day: isEmpty(source.month_day) ? null : source.month_day,
    anchor: source.anchor === undefined || source.anchor === null ? '' : String(source.anchor),
    lead_days:
      source.lead_days === undefined || source.lead_days === null || source.lead_days === ''
        ? DEFAULT_LEAD_DAYS
        : source.lead_days
  };
  var anchorDay = dayOf(result.anchor);
  if (result.mode === 'calendar' && !isNaN(anchorDay)) {
    if (result.freq === 'weekly' && result.weekdays.length === 0) {
      result.weekdays = [WEEKDAYS[weekdayIndex(anchorDay)]];
    }
    if (result.freq === 'monthly' && result.month_day === null) {
      result.month_day = dayOfMonth(anchorDay);
    }
  }
  if (result.weekdays.length > 0 && sortedWeekdays(result.weekdays).length === result.weekdays.length) {
    result.weekdays = sortedWeekdays(result.weekdays);
  }
  return result;
}

function anchorIsValid(anchor) {
  var day = dayOf(anchor);
  if (isNaN(day)) {
    return false;
  }
  var year = new Date(day * DAY_MS).getUTCFullYear();
  return year >= ANCHOR_MIN_YEAR && year <= ANCHOR_MAX_YEAR;
}

// Field errors of a (normalized) rule as { field: code }; empty when the rule is valid.
function validate(rule) {
  var r = rule || {};
  var errors = {};
  if (MODES.indexOf(r.mode) === -1) {
    errors.mode = CODES.mode;
  }
  if (FREQS.indexOf(r.freq) === -1) {
    errors.freq = CODES.freq;
  }
  if (!isWholeNumber(r.interval) || r.interval < INTERVAL_MIN || r.interval > INTERVAL_MAX) {
    errors.interval = CODES.interval;
  }
  var weekdays = weekdayList(r.weekdays);
  var weeklyCalendar = r.mode === 'calendar' && r.freq === 'weekly';
  if (weekdays.length > 0 && !weeklyCalendar) {
    errors.weekdays = CODES.weekdaysMode;
  } else if (weekdays.length > 0 && sortedWeekdays(weekdays).length !== weekdays.length) {
    errors.weekdays = CODES.weekdays;
  } else if (weeklyCalendar && weekdays.length === 0) {
    errors.weekdays = CODES.weekdays;
  }
  var monthDay = r.month_day;
  var hasMonthDay = !isEmpty(monthDay);
  var monthlyCalendar = r.mode === 'calendar' && r.freq === 'monthly';
  if (hasMonthDay && !monthlyCalendar) {
    errors.month_day = CODES.monthDayMode;
  } else if (
    hasMonthDay &&
    (!isWholeNumber(monthDay) || (monthDay !== LAST_DAY && (monthDay < 1 || monthDay > MONTH_DAY_MAX)))
  ) {
    errors.month_day = CODES.monthDay;
  } else if (monthlyCalendar && !hasMonthDay) {
    errors.month_day = CODES.monthDay;
  }
  if (!anchorIsValid(r.anchor)) {
    errors.anchor = CODES.anchor;
  }
  if (!isWholeNumber(r.lead_days) || r.lead_days < LEAD_DAYS_MIN || r.lead_days > LEAD_DAYS_MAX) {
    errors.lead_days = CODES.leadDays;
  }
  return errors;
}

function isValid(rule) {
  var errors = validate(rule);
  for (var key in errors) {
    if (Object.prototype.hasOwnProperty.call(errors, key)) {
      return false;
    }
  }
  return true;
}

function requireCalendar(rule) {
  var r = normalize(rule);
  if (r.mode !== 'calendar' || !isValid(r)) {
    throw new RangeError('Not a valid calendar rule');
  }
  return r;
}

// --- Calendar occurrences on day numbers --------------------------------------------------

function weeklyWeekdaySet(r) {
  var set = [];
  for (var i = 0; i < r.weekdays.length; i++) {
    set.push(WEEKDAYS.indexOf(r.weekdays[i]));
  }
  set.sort(function (a, b) {
    return a - b;
  });
  return set;
}

function weekStart(dayNumber) {
  return dayNumber - weekdayIndex(dayNumber);
}

// First occurrence >= `from` (a day number); `from` is at least the anchor.
function firstFrom(r, from) {
  var anchor = requireDay(r.anchor);
  var start = Math.max(from, anchor);
  var step = r.interval;
  if (r.freq === 'daily') {
    return anchor + ceilDiv(start - anchor, step) * step;
  }
  if (r.freq === 'weekly') {
    var set = weeklyWeekdaySet(r);
    var firstWeek = weekStart(anchor);
    var weeks = ceilDiv((weekStart(start) - firstWeek) / 7, step) * step;
    var week = firstWeek + weeks * 7;
    var lowest = Math.max(start, week);
    for (var i = 0; i < set.length; i++) {
      if (week + set[i] >= lowest) {
        return week + set[i];
      }
    }
    return week + step * 7 + set[0];
  }
  if (r.freq === 'monthly') {
    var firstMonth = monthIndexOf(anchor);
    var month = firstMonth + ceilDiv(monthIndexOf(start) - firstMonth, step) * step;
    var candidate = dayInMonth(month, r.month_day);
    return candidate >= start ? candidate : dayInMonth(month + step, r.month_day);
  }
  // yearly: month and day of the anchor, 29 February becomes 28 February in common years.
  var anchorMonth = monthIndexOf(anchor);
  var anchorDate = dayOfMonth(anchor);
  var firstYear = Math.floor(anchorMonth / 12);
  var monthOfYear = anchorMonth - firstYear * 12;
  var startYear = new Date(start * DAY_MS).getUTCFullYear();
  var year = firstYear + ceilDiv(startYear - firstYear, step) * step;
  var yearly = dayInMonth(year * 12 + monthOfYear, anchorDate);
  return yearly >= start ? yearly : dayInMonth((year + step) * 12 + monthOfYear, anchorDate);
}

// Last occurrence <= `until` (a day number), or null.
function lastUntil(r, until) {
  var anchor = requireDay(r.anchor);
  if (until < anchor) {
    return null;
  }
  var step = r.interval;
  if (r.freq === 'daily') {
    return anchor + floorDiv(until - anchor, step) * step;
  }
  if (r.freq === 'weekly') {
    var set = weeklyWeekdaySet(r);
    var firstWeek = weekStart(anchor);
    var week = firstWeek + floorDiv((weekStart(until) - firstWeek) / 7, step) * step * 7;
    while (week >= firstWeek) {
      for (var i = set.length - 1; i >= 0; i--) {
        var day = week + set[i];
        if (day <= until && day >= anchor) {
          return day;
        }
      }
      week -= step * 7;
    }
    return null;
  }
  if (r.freq === 'monthly') {
    var firstMonth = monthIndexOf(anchor);
    var month = firstMonth + floorDiv(monthIndexOf(until) - firstMonth, step) * step;
    var candidate = dayInMonth(month, r.month_day);
    if (candidate > until) {
      month -= step;
      if (month < firstMonth) {
        return null;
      }
      candidate = dayInMonth(month, r.month_day);
    }
    return candidate >= anchor ? candidate : null;
  }
  var anchorMonth = monthIndexOf(anchor);
  var anchorDate = dayOfMonth(anchor);
  var firstYear = Math.floor(anchorMonth / 12);
  var monthOfYear = anchorMonth - firstYear * 12;
  var untilYear = new Date(until * DAY_MS).getUTCFullYear();
  var year = firstYear + floorDiv(untilYear - firstYear, step) * step;
  var yearly = dayInMonth(year * 12 + monthOfYear, anchorDate);
  if (yearly > until) {
    year -= step;
    if (year < firstYear) {
      return null;
    }
    yearly = dayInMonth(year * 12 + monthOfYear, anchorDate);
  }
  return yearly;
}

// --- Public functions ----------------------------------------------------------------------

// First occurrence on or after `date` (calendar rules only).
function onOrAfter(rule, date) {
  var r = requireCalendar(rule);
  return dateOf(firstFrom(r, requireDay(date)));
}

// First occurrence strictly after `date` (calendar rules only).
function after(rule, date) {
  var r = requireCalendar(rule);
  return dateOf(firstFrom(r, requireDay(date) + 1));
}

// Last occurrence on or before `date`, or null (calendar rules only).
function latestOnOrBefore(rule, date) {
  var r = requireCalendar(rule);
  var day = lastUntil(r, requireDay(date));
  return day === null ? null : dateOf(day);
}

// Next due date of an after-completion rule: the completion date plus the interval. Months and
// years are clamped from the completion date itself (31 January + 1 month = 28/29 February).
function afterCompletion(rule, completedDate) {
  var r = normalize(rule);
  if (r.mode !== 'after_completion' || !isValid(r)) {
    throw new RangeError('Not a valid after-completion rule');
  }
  var day = requireDay(completedDate);
  if (r.freq === 'daily') {
    return dateOf(day + r.interval);
  }
  if (r.freq === 'weekly') {
    return dateOf(day + r.interval * 7);
  }
  var months = r.freq === 'monthly' ? r.interval : r.interval * 12;
  return dateOf(dayInMonth(monthIndexOf(day) + months, dayOfMonth(day)));
}

// Due date of the next ticket after missed occurrences (ADR-0022 section 3): `pendingDue` if no
// further occurrence lies after it up to `today`, otherwise the latest occurrence <= today.
// Never earlier than `pendingDue`. After-completion rules have no missed occurrences.
function catchUp(rule, pendingDue, today) {
  var r = normalize(rule);
  var pending = requireDay(pendingDue);
  var now = requireDay(today);
  if (r.mode !== 'calendar') {
    return dateOf(pending);
  }
  requireCalendar(r);
  var latest = lastUntil(r, now);
  return latest !== null && latest > pending ? dateOf(latest) : dateOf(pending);
}

// Day from which the ticket due on `due` is created: `due` minus the lead time.
function createOn(due, leadDays) {
  if (!isWholeNumber(leadDays) || leadDays < LEAD_DAYS_MIN || leadDays > LEAD_DAYS_MAX) {
    throw new RangeError('Lead time out of range: ' + leadDays);
  }
  return dateOf(requireDay(due) - leadDays);
}

// The next `count` occurrences from `date` on (inclusive), for the preview "Nächste Termine".
function upcoming(rule, date, count) {
  var r = requireCalendar(rule);
  var result = [];
  var day = requireDay(date);
  for (var i = 0; i < count; i++) {
    day = firstFrom(r, day);
    result.push(dateOf(day));
    day += 1;
  }
  return result;
}

// Weekday code (MO ... SU) of a calendar date.
function weekdayOf(date) {
  return WEEKDAYS[weekdayIndex(requireDay(date))];
}

module.exports = {
  MODES: MODES,
  FREQS: FREQS,
  WEEKDAYS: WEEKDAYS,
  INTERVAL_MIN: INTERVAL_MIN,
  INTERVAL_MAX: INTERVAL_MAX,
  LEAD_DAYS_MIN: LEAD_DAYS_MIN,
  LEAD_DAYS_MAX: LEAD_DAYS_MAX,
  DEFAULT_LEAD_DAYS: DEFAULT_LEAD_DAYS,
  LAST_DAY: LAST_DAY,
  ANCHOR_MIN_YEAR: ANCHOR_MIN_YEAR,
  ANCHOR_MAX_YEAR: ANCHOR_MAX_YEAR,
  CODES: CODES,
  isCalendarDate: isCalendarDate,
  normalize: normalize,
  validate: validate,
  isValid: isValid,
  onOrAfter: onOrAfter,
  after: after,
  latestOnOrBefore: latestOnOrBefore,
  afterCompletion: afterCompletion,
  catchUp: catchUp,
  createOn: createOn,
  upcoming: upcoming,
  weekdayOf: weekdayOf
};
