// Pure rules of the Notion import (ADR-0041): the fixed API, its limits, the German messages of
// its errors, and how shared sources, rows of a data source and points of lists on a page become
// entries of the inbox. Notion is only read: the import copies, it never writes back.
// CommonJS module, ES5 only, no dependencies; the callers pass notion-markdown.js as `markdown`
// and berlin-time.js as `berlin` (Goja runtime and Vitest load the module the same way).
'use strict';

// Official REST API on a fixed host; Notion-Version 2026-03-11 (the current version, see ADR-0041).
var API_BASE = 'https://api.notion.com';
var API_VERSION = '2026-03-11';
// Tests only: with the mark of the test mode (set by a hook of tests/fixtures/pb_hooks, never part
// of the app folder) this variable names the port of a fake server on 127.0.0.1.
var TEST_PORT_ENV = 'BYL_TEST_NOTION_PORT';
var TEST_MODE_KEY = 'byl-test-mode';
var DEFAULT_SECRET_ENV = 'BYL_NOTION_TOKEN';

var SOURCE_TYPES = ['data_source', 'page'];
var LIST_TYPES = ['to_do', 'bulleted_list_item', 'numbered_list_item'];
// Blocks whose children may hold lists of a page; a toggle names the section of its points.
var CONTAINER_TYPES = ['toggle', 'column_list', 'column', 'callout', 'quote', 'synced_block', 'tab', 'paragraph'];
var HEADING_TYPES = ['heading_1', 'heading_2', 'heading_3', 'heading_4'];

var LIMITS = Object.freeze({
  // Results per request (the most Notion allows).
  pageSize: 100,
  // Shared data sources and pages each in the list of sources.
  maxSources: 500,
  // Rows of one data source (Notion itself answers at most 10 000 per query).
  maxRows: 1000,
  // Reading a page with lists: requests, blocks and depth.
  treeRequests: 100,
  treeBlocks: 5000,
  treeDepth: 8,
  // Page content of one row ("Seiteninhalt als Kopie mitnehmen"): requests, blocks, characters.
  contentRequests: 40,
  contentBlocks: 500,
  contentChars: 50000,
  // Entries per import request; the app sends larger selections in several requests.
  importBatch: 100,
  excerpt: 160,
  // About 3 requests per second (Notion: 180 per minute per integration).
  intervalMs: 350,
  retries: 3,
  retryAfterMaxSeconds: 30,
  timeoutSeconds: 30,
  responseBytes: 20 * 1024 * 1024,
  // Original file of an entry (ADR-0031, addendum D).
  originalBytes: 25 * 1024 * 1024
});

var DONE_NAMES = ['erledigt', 'done', 'fertig', 'abgeschlossen', 'complete', 'completed', 'geschlossen', 'closed', 'erfüllt'];
var DONE_PROPERTY = /erledigt|done|fertig|abgeschlossen|complete/i;
var STATUS_PROPERTY = /status|zustand/i;
var UNTITLED = 'Ohne Titel';

var CONTENT = Object.freeze({
  complete: 'complete',
  properties: 'properties',
  truncated: 'truncated'
});

// Last line of a page content cut at the limits.
var TRUNCATED_NOTE =
  '_Seiteninhalt gekürzt: höchstens ' + LIMITS.contentBlocks + ' Blöcke und ' + thousands(LIMITS.contentChars) + ' Zeichen je Seite. Vollständig in Notion._';

/** A count with a dot between thousands, as German texts write it ("50.000"). */
function thousands(value) {
  return String(value).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

function text(value) {
  return value === undefined || value === null ? '' : String(value);
}

function isObject(value) {
  return value !== null && typeof value === 'object' && Object.prototype.toString.call(value) === '[object Object]';
}

function isArray(value) {
  return Object.prototype.toString.call(value) === '[object Array]';
}

function trim(value) {
  return text(value).replace(/^\s+|\s+$/g, '');
}

function keysOf(value) {
  var keys = [];
  if (!isObject(value)) {
    return keys;
  }
  for (var key in value) {
    if (Object.prototype.hasOwnProperty.call(value, key)) {
      keys.push(key);
    }
  }
  return keys;
}

/**
 * A Notion ID in its canonical form (lower case with dashes, 8-4-4-4-12) from 32 hex digits with
 * or without dashes; '' for anything else. IDs from a request are checked with it before they
 * become part of an address.
 */
function normalizeId(value) {
  var compact = text(value).toLowerCase().replace(/-/g, '');
  if (!/^[0-9a-f]{32}$/.test(compact)) {
    return '';
  }
  return (
    compact.slice(0, 8) + '-' + compact.slice(8, 12) + '-' + compact.slice(12, 16) + '-' + compact.slice(16, 20) + '-' + compact.slice(20)
  );
}

function isSourceType(value) {
  return SOURCE_TYPES.indexOf(value) !== -1;
}

/** The base address of the API: api.notion.com, in the test mode 127.0.0.1 on the fake port. */
function apiBase(testMode, portValue) {
  if (testMode === true) {
    var port = parseInt(text(portValue), 10);
    if (port > 0 && port < 65536 && String(port) === trim(portValue)) {
      return 'http://127.0.0.1:' + port;
    }
  }
  return API_BASE;
}

/**
 * German message of a failed request and whether it concerns the connection (token, rights,
 * reachability) rather than one source. `context` is 'connection' (users/me, search) or 'source'
 * (a data source, a page, blocks); `variable` names the variable of the token. `status` 0 means
 * no answer. Never contains the token or an address with it.
 */
function failureOf(status, code, context, variable) {
  var notionCode = trim(code) === '' ? '' : trim(code).replace(/[^a-z_]/g, '');
  var source = context === 'source';
  if (status === 0) {
    return { message: 'Notion ist nicht erreichbar. Besteht eine Internetverbindung?', connection: true };
  }
  if (status === 401) {
    return {
      message: 'Notion lehnt den Token ab (401). Stimmt der Wert von ' + text(variable) + '? Neuen Token setzen, dann neu-starten.bat.',
      connection: true
    };
  }
  if (status === 403) {
    return source
      ? {
          message: 'Die Integration darf diese Quelle nicht lesen (403). In Notion die Fähigkeit „Read content“ einschalten und die Seite freigeben.',
          connection: false
        }
      : {
          message: 'Die Integration darf keine Inhalte lesen (403). In Notion unter „Configuration“ die Fähigkeit „Read content“ einschalten.',
          connection: true
        };
  }
  if (status === 404) {
    return source
      ? {
          message:
            'Diese Quelle ist nicht freigegeben oder gelöscht (404). In Notion bei der Seite bzw. Datenbank über „•••“ → „Verbindungen“ die Integration hinzufügen.',
          connection: false
        }
      : { message: 'Notion kennt diese Anfrage nicht (404).', connection: true };
  }
  if (status === 429) {
    return { message: 'Notion bremst gerade die Anfragen (429). Bitte in einer Minute erneut versuchen.', connection: false };
  }
  if (status >= 500) {
    return { message: 'Notion ist gerade nicht verfügbar (HTTP ' + status + '). Bitte später erneut versuchen.', connection: false };
  }
  return {
    message: 'Notion lehnt die Anfrage ab (HTTP ' + status + (notionCode === '' ? '' : ', ' + notionCode) + ').',
    connection: false
  };
}

/**
 * Milliseconds to wait before request `attempt` (0 for the first retry) is sent again, or -1 for
 * no retry: 429 and 529 after Retry-After (whole seconds, else 1, 2, 4 s) up to 30 s, 500, 502,
 * 503 and 504 after 1 and 2 s. Other answers and a missing answer are not repeated.
 */
function retryDelayMs(status, retryAfter, attempt) {
  if (attempt >= LIMITS.retries) {
    return -1;
  }
  if (status === 429 || status === 529) {
    var raw = trim(retryAfter);
    var seconds = /^\d{1,6}$/.test(raw) ? parseInt(raw, 10) : Math.pow(2, attempt);
    return seconds > LIMITS.retryAfterMaxSeconds ? -1 : seconds * 1000;
  }
  if ((status === 500 || status === 502 || status === 503 || status === 504) && attempt < 2) {
    return 1000 * Math.pow(2, attempt);
  }
  return -1;
}

/** Milliseconds to wait before the next request so there are at most about 3 per second. */
function throttleWaitMs(lastAt, now) {
  var last = Number(lastAt);
  if (!(last > 0)) {
    return 0;
  }
  var wait = last + LIMITS.intervalMs - now;
  return wait > 0 ? Math.min(wait, LIMITS.intervalMs) : 0;
}

/** Title of a page: its property of the kind "title". */
function pageTitle(page, markdown) {
  var properties = isObject(page) && isObject(page.properties) ? page.properties : {};
  var names = keysOf(properties);
  for (var i = 0; i < names.length; i++) {
    var property = properties[names[i]];
    if (isObject(property) && property.type === 'title') {
      return trim(markdown.plainText(property.title).replace(/\s+/g, ' '));
    }
  }
  return '';
}

/** Address of a page: its own https address from Notion, else one built from the ID. */
function pageUrl(page, markdown) {
  var own = isObject(page) ? text(page.url) : '';
  if (/^https:\/\/[^\s<>]+$/i.test(own) && own.length <= 2000) {
    return own;
  }
  return markdown.notionUrl(isObject(page) ? page.id : '');
}

function isTrashed(value) {
  return isObject(value) && (value.in_trash === true || value.archived === true);
}

/**
 * One result of the search as a source, or null: data sources, and pages that are no row of a
 * database (rows come with their data source). Trashed results are left out.
 * Returns { id, type, title, url, edited }.
 */
function sourceOf(result, markdown) {
  if (!isObject(result) || isTrashed(result)) {
    return null;
  }
  var id = normalizeId(result.id);
  if (id === '') {
    return null;
  }
  var edited = text(result.last_edited_time);
  if (result.object === 'data_source') {
    var parent = isObject(result.parent) ? result.parent : {};
    var database = normalizeId(parent.database_id);
    return {
      id: id,
      type: 'data_source',
      title: trim(markdown.plainText(result.title).replace(/\s+/g, ' ')) || UNTITLED,
      url: markdown.notionUrl(database === '' ? id : database),
      edited: edited
    };
  }
  if (result.object === 'page') {
    var parentType = isObject(result.parent) ? result.parent.type : '';
    if (parentType === 'data_source_id' || parentType === 'database_id') {
      return null;
    }
    return { id: id, type: 'page', title: pageTitle(result, markdown) || UNTITLED, url: pageUrl(result, markdown), edited: edited };
  }
  return null;
}

function pad(value) {
  return value < 10 ? '0' + value : String(value);
}

// Parts of an ISO date or date-time of Notion: date, time, offset in minutes (null without one).
function parseNotionDate(value) {
  var match = /^(\d{4}-\d{2}-\d{2})(?:T([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d)(?:\.\d{1,9})?)?(Z|[+-](?:[01]\d|2[0-3]):?[0-5]\d)?)?$/.exec(
    trim(value)
  );
  if (!match) {
    return null;
  }
  if (match[2] === undefined) {
    return { date: match[1], time: '', offset: null };
  }
  var offset = null;
  if (match[5] === 'Z') {
    offset = 0;
  } else if (match[5]) {
    var sign = match[5].charAt(0) === '-' ? -1 : 1;
    var digits = match[5].slice(1).replace(':', '');
    offset = sign * (parseInt(digits.slice(0, 2), 10) * 60 + parseInt(digits.slice(2), 10));
  }
  return { date: match[1], time: match[2] + ':' + match[3] + ':' + (match[4] || '00'), offset: offset };
}

// Instant (ms) of a date-time with offset, or of a Berlin wall clock.
function instantOf(parts, zone, berlin) {
  if (parts.offset !== null) {
    var fields = parts.date.split('-');
    var clock = parts.time.split(':');
    return (
      Date.UTC(Number(fields[0]), Number(fields[1]) - 1, Number(fields[2]), Number(clock[0]), Number(clock[1]), Number(clock[2])) -
      parts.offset * 60000
    );
  }
  if (zone === '' || zone === 'Europe/Berlin') {
    return berlin.berlinWallClockToUtc(parts.date, parts.time);
  }
  return null;
}

// "15.09.2026" or "15.09.2026, 14:30" in Berlin time.
function momentText(parts, instant, berlin) {
  if (instant === null) {
    var date = parts.date.split('-');
    return date[2] + '.' + date[1] + '.' + date[0];
  }
  var local = new Date(instant + berlin.berlinOffsetHours(instant) * berlin.HOUR_MS);
  return (
    pad(local.getUTCDate()) + '.' + pad(local.getUTCMonth() + 1) + '.' + local.getUTCFullYear() + ', ' + pad(local.getUTCHours()) + ':' + pad(local.getUTCMinutes())
  );
}

/**
 * A date value of Notion ({ start, end, time_zone }) as source date: a date without time is an
 * all-day date that starts at Berlin midnight; a date-time with offset its instant; a date-time
 * without offset in another zone than Berlin counts as its day (no time zone data, CLAUDE.md §3).
 * Returns { sourceDate, allDay, text } or null.
 */
function dateOf(value, berlin) {
  if (!isObject(value)) {
    return null;
  }
  var start = parseNotionDate(value.start);
  if (start === null || !berlin.isCalendarDate(start.date)) {
    return null;
  }
  var zone = trim(value.time_zone);
  var instant = start.time === '' ? null : instantOf(start, zone, berlin);
  var allDay = instant === null;
  var sourceDate = berlin.toPocketBaseDate(allDay ? berlin.berlinMidnight(start.date) : instant);
  var shown = momentText(start, instant, berlin);
  var end = parseNotionDate(value.end);
  if (end !== null && berlin.isCalendarDate(end.date)) {
    var endInstant = end.time === '' ? null : instantOf(end, zone, berlin);
    shown += ' – ' + momentText(end, endInstant, berlin);
  }
  return { sourceDate: sourceDate, allDay: allDay, text: shown };
}

function numberText(value) {
  return typeof value === 'number' && isFinite(value) ? String(value).replace('.', ',') : '';
}

function plainValue(plain, markdown) {
  var value = trim(plain);
  return value === '' ? null : { plain: value, markdown: markdown.escapeInline(value) };
}

function linkValue(label, href, markdown) {
  var target = markdown.safeHref(href);
  if (trim(label) === '') {
    return null;
  }
  return { plain: trim(label), markdown: target === '' ? markdown.escapeInline(trim(label)) : '[' + markdown.escapeInline(trim(label)) + '](' + target + ')' };
}

function namesOf(list) {
  var names = [];
  for (var i = 0; isArray(list) && i < list.length; i++) {
    if (isObject(list[i]) && trim(list[i].name) !== '') {
      names.push(trim(list[i].name));
    }
  }
  return names;
}

function countText(count, one, many) {
  return count === 1 ? '1 ' + one : count + ' ' + many;
}

// Persons as names (with the user capability of the integration), else as their number.
function peopleValue(list, markdown) {
  var people = isArray(list) ? list : [];
  if (people.length === 0) {
    return null;
  }
  var names = namesOf(people);
  return plainValue(names.length === people.length ? names.join(', ') : countText(people.length, 'Person', 'Personen'), markdown);
}

function formulaValue(formula, berlin, markdown) {
  if (!isObject(formula)) {
    return null;
  }
  if (formula.type === 'string') {
    return plainValue(formula.string, markdown);
  }
  if (formula.type === 'number') {
    return plainValue(numberText(formula.number), markdown);
  }
  if (formula.type === 'boolean') {
    return typeof formula.boolean === 'boolean' ? plainValue(formula.boolean ? 'ja' : 'nein', markdown) : null;
  }
  if (formula.type === 'date') {
    var date = dateOf(formula.date, berlin);
    return date === null ? null : plainValue(date.text, markdown);
  }
  return null;
}

/**
 * One property value of a row as { plain, markdown }, or null for an empty value and for kinds a
 * copy does not need (created and edited by and when, buttons, verification, place).
 */
function propertyValue(property, berlin, markdown) {
  if (!isObject(property)) {
    return null;
  }
  switch (property.type) {
    case 'rich_text': {
      var plain = trim(markdown.plainText(property.rich_text));
      return plain === '' ? null : { plain: plain.replace(/\s+/g, ' '), markdown: markdown.richTextToMarkdown(property.rich_text).replace(/\n/g, ' ') };
    }
    case 'number':
      return plainValue(numberText(property.number), markdown);
    case 'select':
    case 'status':
      return isObject(property[property.type]) ? plainValue(property[property.type].name, markdown) : null;
    case 'multi_select':
      return plainValue(namesOf(property.multi_select).join(', '), markdown);
    case 'date': {
      var date = dateOf(property.date, berlin);
      return date === null ? null : plainValue(date.text, markdown);
    }
    case 'people':
      return peopleValue(property.people, markdown);
    case 'checkbox':
      return plainValue(property.checkbox === true ? 'ja' : 'nein', markdown);
    case 'url':
      return linkValue(property.url, property.url, markdown);
    case 'email':
      return linkValue(property.email, 'mailto:' + trim(property.email), markdown);
    case 'phone_number':
      return plainValue(property.phone_number, markdown);
    case 'formula':
      return formulaValue(property.formula, berlin, markdown);
    case 'relation':
      return isArray(property.relation) && property.relation.length > 0
        ? plainValue(countText(property.relation.length, 'verknüpfte Seite', 'verknüpfte Seiten'), markdown)
        : null;
    case 'rollup':
      if (!isObject(property.rollup)) {
        return null;
      }
      if (property.rollup.type === 'number') {
        return plainValue(numberText(property.rollup.number), markdown);
      }
      if (property.rollup.type === 'date') {
        var rolled = dateOf(property.rollup.date, berlin);
        return rolled === null ? null : plainValue(rolled.text, markdown);
      }
      return null;
    case 'files':
      return plainValue(namesOf(property.files).join(', '), markdown);
    case 'unique_id':
      if (!isObject(property.unique_id) || typeof property.unique_id.number !== 'number') {
        return null;
      }
      return plainValue((trim(property.unique_id.prefix) === '' ? '' : trim(property.unique_id.prefix) + '-') + property.unique_id.number, markdown);
    default:
      return null;
  }
}

/** Names of the date properties of a schema, in the order Notion gives them. */
function dateProperties(schema) {
  var names = keysOf(schema);
  var result = [];
  for (var i = 0; i < names.length; i++) {
    if (isObject(schema[names[i]]) && schema[names[i]].type === 'date') {
      result.push(names[i]);
    }
  }
  return result;
}

/**
 * The date property of the import: the requested one (null: the first; '': none). Returns
 * { name } or { invalid: true } for a name that is no date property of the schema.
 */
function chooseDateProperty(schema, requested) {
  var names = dateProperties(schema);
  if (requested === null || requested === undefined) {
    return { name: names.length > 0 ? names[0] : '' };
  }
  if (requested === '') {
    return { name: '' };
  }
  return names.indexOf(requested) === -1 ? { invalid: true } : { name: requested };
}

function isDoneName(value) {
  return DONE_NAMES.indexOf(trim(value).toLowerCase()) !== -1;
}

// Option IDs of the group "Complete" of a status property (always the last of its three groups).
function completeOptionIds(status) {
  var groups = isObject(status) && isArray(status.groups) ? status.groups : [];
  var chosen = null;
  for (var i = 0; i < groups.length; i++) {
    if (isObject(groups[i]) && trim(groups[i].name).toLowerCase() === 'complete') {
      chosen = groups[i];
    }
  }
  if (chosen === null && groups.length > 0) {
    chosen = groups[groups.length - 1];
  }
  return chosen !== null && isArray(chosen.option_ids) ? chosen.option_ids.slice() : [];
}

/**
 * How a row of the schema counts as done ("Erledigte überspringen"): a status property by the
 * group "Complete", else a checkbox named like done ("Erledigt", "Done", …) or the only
 * checkbox, else a select named like a status by the name of its option. null if none applies.
 */
function doneRuleOf(schema) {
  var names = keysOf(schema);
  var checkboxes = [];
  var i;
  for (i = 0; i < names.length; i++) {
    var property = schema[names[i]];
    if (isObject(property) && property.type === 'status') {
      return { type: 'status', name: names[i], ids: completeOptionIds(property.status) };
    }
    if (isObject(property) && property.type === 'checkbox') {
      checkboxes.push(names[i]);
    }
  }
  for (i = 0; i < checkboxes.length; i++) {
    if (DONE_PROPERTY.test(checkboxes[i])) {
      return { type: 'checkbox', name: checkboxes[i] };
    }
  }
  if (checkboxes.length === 1) {
    return { type: 'checkbox', name: checkboxes[0] };
  }
  for (i = 0; i < names.length; i++) {
    if (isObject(schema[names[i]]) && schema[names[i]].type === 'select' && STATUS_PROPERTY.test(names[i])) {
      return { type: 'select', name: names[i] };
    }
  }
  return null;
}

/** Whether a row counts as done after `rule` (doneRuleOf). */
function isRowDone(page, rule) {
  if (rule === null || !isObject(page) || !isObject(page.properties)) {
    return false;
  }
  var property = page.properties[rule.name];
  if (!isObject(property)) {
    return false;
  }
  if (rule.type === 'status') {
    var status = property.status;
    if (!isObject(status)) {
      return false;
    }
    return rule.ids.length > 0 ? rule.ids.indexOf(status.id) !== -1 : isDoneName(status.name);
  }
  if (rule.type === 'checkbox') {
    return property.checkbox === true;
  }
  return isObject(property.select) && isDoneName(property.select.name);
}

function excerptOf(value) {
  var plain = trim(text(value).replace(/\s+/g, ' '));
  return plain.length <= LIMITS.excerpt ? plain : plain.slice(0, LIMITS.excerpt - 1) + '…';
}

/**
 * A row of a data source as an entry: title, the chosen date as source date, done, and the other
 * properties as a Markdown list (and as one line for the preview). `context`: { schema,
 * dateProperty, doneRule }.
 * Returns { ref, kind, title, url, date, done, excerpt, summary, raw } (summary: Markdown lines).
 */
function rowEntry(page, context, berlin, markdown) {
  var properties = isObject(page.properties) ? page.properties : {};
  var order = keysOf(context.schema);
  var own = keysOf(properties);
  for (var o = 0; o < own.length; o++) {
    if (order.indexOf(own[o]) === -1) {
      order.push(own[o]);
    }
  }
  var lines = [];
  var plain = [];
  for (var i = 0; i < order.length; i++) {
    var property = properties[order[i]];
    if (!isObject(property) || property.type === 'title') {
      continue;
    }
    var value = propertyValue(property, berlin, markdown);
    if (value === null) {
      continue;
    }
    lines.push('- **' + markdown.escapeInline(order[i]) + ':** ' + value.markdown);
    plain.push(order[i] + ': ' + value.plain);
  }
  var date = context.dateProperty === '' || !isObject(properties[context.dateProperty])
    ? null
    : dateOf(properties[context.dateProperty].date, berlin);
  return {
    ref: normalizeId(page.id),
    kind: 'task',
    title: pageTitle(page, markdown) || UNTITLED,
    url: pageUrl(page, markdown),
    date: date,
    done: isRowDone(page, context.doneRule),
    excerpt: excerptOf(plain.join(' · ')),
    summary: lines,
    raw: page
  };
}

// First date mention in the text of a point ("@15. Oktober").
function mentionedDate(richText, berlin) {
  for (var i = 0; isArray(richText) && i < richText.length; i++) {
    var item = richText[i];
    if (isObject(item) && item.type === 'mention' && isObject(item.mention) && item.mention.type === 'date') {
      var date = dateOf(item.mention.date, berlin);
      if (date !== null) {
        return date;
      }
    }
  }
  return null;
}

// A point of a list as an entry; null for a point without text.
function pointEntry(block, section, page, berlin, markdown) {
  var payload = isObject(block[block.type]) ? block[block.type] : {};
  var plain = trim(markdown.plainText(payload.rich_text));
  if (plain === '') {
    return null;
  }
  var title = plain.replace(/\s+/g, ' ');
  var own = markdown.richTextToMarkdown(payload.rich_text);
  var children = isArray(block.children) ? block.children : [];
  var nested = markdown.blocksToMarkdown(children, LIMITS.contentBlocks, LIMITS.contentChars);
  var parts = [];
  // The title is plain text: formatting, links and long or broken lines keep their place in the text.
  if (own !== markdown.escapeInline(plain) || plain.indexOf('\n') !== -1 || title.length > 200) {
    var lines = own.split('\n');
    for (var l = 0; l < lines.length; l++) {
      lines[l] = markdown.escapeLineStart(lines[l]);
    }
    parts.push(lines.join('\n'));
  }
  if (nested.markdown !== '') {
    parts.push(nested.markdown);
  }
  var compact = markdown.compactId(block.id);
  return {
    ref: normalizeId(block.id),
    kind: 'todo',
    title: title,
    url: page.url + (compact === '' ? '' : '#' + compact),
    date: mentionedDate(payload.rich_text, berlin),
    done: block.type === 'to_do' && payload.checked === true,
    excerpt: excerptOf(markdown.plainText(collectText(children))),
    body: parts.join('\n\n'),
    truncated: nested.truncated,
    section: section,
    blockType: block.type,
    raw: block
  };
}

// Rich text of nested blocks, flat, for the excerpt of a point.
function collectText(blocks) {
  var result = [];
  for (var i = 0; isArray(blocks) && i < blocks.length; i++) {
    var block = blocks[i];
    if (!isObject(block)) {
      continue;
    }
    var payload = isObject(block[block.type]) ? block[block.type] : {};
    if (isArray(payload.rich_text)) {
      result = result.concat(payload.rich_text, [{ type: 'text', plain_text: ' ' }]);
    }
    result = result.concat(collectText(block.children));
  }
  return result;
}

/**
 * The points of the lists of a page (to-do, bulleted and numbered) as entries, with their nested
 * points and other children as their text. Lists inside toggles, columns, callouts, quotes and
 * synced blocks count as well; sub-pages and databases are sources of their own. The heading
 * or toggle above a point names its section. `page`: { url } of the page.
 * Returns { entries, empty } (empty: points without text, left out).
 */
function pointEntries(blocks, page, berlin, markdown) {
  var result = { entries: [], empty: 0 };
  walkPoints(isArray(blocks) ? blocks : [], '', page, berlin, markdown, result);
  return result;
}

function walkPoints(blocks, section, page, berlin, markdown, result) {
  var current = section;
  for (var i = 0; i < blocks.length; i++) {
    var block = blocks[i];
    if (!isObject(block)) {
      continue;
    }
    var type = text(block.type);
    var payload = isObject(block[type]) ? block[type] : {};
    if (LIST_TYPES.indexOf(type) !== -1) {
      var entry = pointEntry(block, current, page, berlin, markdown);
      if (entry === null) {
        result.empty += 1;
      } else {
        result.entries.push(entry);
      }
      continue;
    }
    if (HEADING_TYPES.indexOf(type) !== -1) {
      current = trim(markdown.plainText(payload.rich_text).replace(/\s+/g, ' '));
      walkPoints(isArray(block.children) ? block.children : [], current, page, berlin, markdown, result);
      continue;
    }
    if (CONTAINER_TYPES.indexOf(type) !== -1) {
      var named = type === 'toggle' ? trim(markdown.plainText(payload.rich_text).replace(/\s+/g, ' ')) : '';
      walkPoints(isArray(block.children) ? block.children : [], named === '' ? current : named, page, berlin, markdown, result);
    }
  }
}

/** Whether the page content is read further below `block`: everything but sub-pages and databases. */
function descendForContent(block) {
  var type = isObject(block) ? text(block.type) : '';
  return type !== 'child_page' && type !== 'child_database';
}

/**
 * Whether the block tree of a page with lists is read further below `block`: inside a point all of
 * its content (it becomes the text of the point), outside only lists, headings and containers
 * that may hold lists.
 */
function descendForPoints(block, inPoint) {
  if (inPoint === true) {
    return descendForContent(block);
  }
  var type = isObject(block) ? text(block.type) : '';
  return LIST_TYPES.indexOf(type) !== -1 || HEADING_TYPES.indexOf(type) !== -1 || CONTAINER_TYPES.indexOf(type) !== -1;
}

/** Whether `block` is a point of a list (its children are its content). */
function isPoint(block) {
  return isObject(block) && LIST_TYPES.indexOf(text(block.type)) !== -1;
}

/**
 * The text of an entry: the properties of a row, then (with "Seiteninhalt als Kopie mitnehmen")
 * its page content after a rule; the text of a point is its nested content.
 */
function bodyOf(entry, content) {
  if (entry.kind !== 'task') {
    return entry.body || '';
  }
  var parts = [];
  if (entry.summary.length > 0) {
    parts.push(entry.summary.join('\n'));
  }
  if (content !== null && content !== undefined) {
    var copied = content.markdown === '' ? '_Die Seite hat keinen Inhalt._' : content.markdown;
    parts.push(copied + (content.truncated ? '\n\n' + TRUNCATED_NOTE : ''));
  }
  return parts.join('\n\n---\n\n');
}

/**
 * What the copy of an entry holds (ADR-0031 §5): 'complete' (a point with its nested content, a
 * row with its whole page), 'properties' (a row without its page content) or 'truncated'.
 */
function contentState(entry, content) {
  if (entry.kind !== 'task') {
    return entry.truncated ? CONTENT.truncated : CONTENT.complete;
  }
  if (content === null || content === undefined) {
    return CONTENT.properties;
  }
  return content.truncated ? CONTENT.truncated : CONTENT.complete;
}

/**
 * source_meta of an entry: where it came from (source, object, date property, whether the page
 * content was copied, the state of the copy) and, for a date without time, all_day.
 */
function metaOf(entry, source, options, content) {
  var notion = {
    source_id: source.id,
    source_type: source.type,
    source_title: text(source.title).slice(0, 200),
    source_url: source.url,
    object: entry.kind === 'task' ? 'page' : 'block',
    copy: options.copyContent === true,
    content: contentState(entry, content)
  };
  if (entry.kind === 'task') {
    notion.date_property = text(options.dateProperty);
  } else {
    notion.block_type = entry.blockType;
    if (trim(entry.section) !== '') {
      notion.section = text(entry.section).slice(0, 200);
    }
  }
  var meta = { notion: notion };
  if (entry.date !== null && entry.date.allDay) {
    meta.all_day = true;
  }
  return meta;
}

/** Number of bytes of a text in UTF-8 (the original file is limited in bytes). */
function utf8Length(value) {
  var input = text(value);
  var bytes = 0;
  for (var i = 0; i < input.length; i++) {
    var code = input.charCodeAt(i);
    if (code < 0x80) {
      bytes += 1;
    } else if (code < 0x800) {
      bytes += 2;
    } else if (code >= 0xd800 && code <= 0xdbff) {
      bytes += 4;
      i += 1;
    } else {
      bytes += 3;
    }
  }
  return bytes;
}

/**
 * The validated body of the preview and import routes: { source: { type, id }, date_property,
 * skip_done, copy_content, refs }. Returns { ok: true, value } or { ok: false, message }.
 * `refs` is required only when `withRefs` is set.
 */
function parseRequest(body, withRefs) {
  var input = isObject(body) ? body : {};
  var source = isObject(input.source) ? input.source : {};
  var type = text(source.type);
  var id = normalizeId(source.id);
  if (!isSourceType(type) || id === '') {
    return { ok: false, message: 'Keine gültige Quelle: bitte eine Datenbank oder Seite wählen.' };
  }
  var dateProperty = null;
  if (input.date_property !== undefined && input.date_property !== null) {
    if (typeof input.date_property !== 'string' || input.date_property.length > 200) {
      return { ok: false, message: 'Keine gültige Datums-Eigenschaft.' };
    }
    dateProperty = input.date_property;
  }
  var value = {
    source: { type: type, id: id },
    dateProperty: dateProperty,
    skipDone: input.skip_done !== false,
    copyContent: input.copy_content === true && type === 'data_source',
    refs: []
  };
  if (withRefs) {
    var refs = isArray(input.refs) ? input.refs : [];
    if (refs.length === 0 || refs.length > LIMITS.importBatch) {
      return { ok: false, message: 'Bitte 1 bis ' + LIMITS.importBatch + ' Einträge je Anfrage wählen.' };
    }
    for (var i = 0; i < refs.length; i++) {
      var ref = normalizeId(refs[i]);
      if (ref === '') {
        return { ok: false, message: 'Keine gültige Auswahl.' };
      }
      if (value.refs.indexOf(ref) === -1) {
        value.refs.push(ref);
      }
    }
  }
  return { ok: true, value: value };
}

module.exports = {
  API_BASE: API_BASE,
  API_VERSION: API_VERSION,
  TEST_PORT_ENV: TEST_PORT_ENV,
  TEST_MODE_KEY: TEST_MODE_KEY,
  DEFAULT_SECRET_ENV: DEFAULT_SECRET_ENV,
  SOURCE_TYPES: SOURCE_TYPES,
  LIMITS: LIMITS,
  CONTENT: CONTENT,
  DONE_NAMES: DONE_NAMES,
  UNTITLED: UNTITLED,
  TRUNCATED_NOTE: TRUNCATED_NOTE,
  normalizeId: normalizeId,
  isSourceType: isSourceType,
  apiBase: apiBase,
  failureOf: failureOf,
  retryDelayMs: retryDelayMs,
  throttleWaitMs: throttleWaitMs,
  pageTitle: pageTitle,
  pageUrl: pageUrl,
  sourceOf: sourceOf,
  dateOf: dateOf,
  propertyValue: propertyValue,
  dateProperties: dateProperties,
  chooseDateProperty: chooseDateProperty,
  doneRuleOf: doneRuleOf,
  isRowDone: isRowDone,
  rowEntry: rowEntry,
  pointEntries: pointEntries,
  isPoint: isPoint,
  descendForPoints: descendForPoints,
  descendForContent: descendForContent,
  bodyOf: bodyOf,
  contentState: contentState,
  metaOf: metaOf,
  utf8Length: utf8Length,
  parseRequest: parseRequest
};
