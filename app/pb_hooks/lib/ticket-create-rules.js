// Pure decisions of "Neues Ticket" with everything at once (NT-1, ADR-0069). CommonJS module, ES5
// only, no dependencies and no `$app` (Goja runtime and Vitest). lib/ticket-create-service.js reads and
// writes the database; web/src/lib/domain/ticket-create.ts has the same limits and texts
// (tests/unit/web-ticket-create.test.mjs).
//
// The request names the new ticket with the fields of the collection a client may set (the create
// rule of the Record API: the owner is always the acting account) and the options that need the
// ticket: its sub-tasks, the entries of the inbox and the tickets it stems from, a rule that makes it
// the first ticket of a series, a pin and an entry in the day plan of today.
'use strict';

// Fields of the ticket a request may set. Key, number, scope, completed_at, the series, the trash and
// the pinned comment belong to the server (CLAUDE.md section 5), the owner is the acting account.
var TEXT_FIELDS = Object.freeze([
  'household',
  'title',
  'description',
  'status',
  'priority',
  'due',
  'project',
  'parent',
  'color',
  'charm',
  'kind',
  'assignee',
  'source',
  'source_item'
]);

// Fields that came with a later migration: a value is refused while the server does not know them
// (instead of being dropped by PocketBase without a word).
var LATER_FIELDS = Object.freeze(['color', 'charm', 'kind', 'assignee']);

// Select fields of the ticket; their allowed values come from the schema of the collection.
var SELECT_FIELDS = Object.freeze(['status', 'priority', 'color', 'kind']);

// Parameters of the rule a request may set. Its template (title, description, project, tags,
// priority, color, charm) is the ticket as it is created, like "Wiederholen…" takes it
// (ticketTemplate of web/src/lib/domain/series-template.ts); next_due, scope and the hints belong to
// the server.
var RULE_FIELDS = Object.freeze([
  'mode',
  'freq',
  'interval',
  'weekdays',
  'month_day',
  'anchor',
  'lead_days',
  'active',
  'each_occurrence',
  'initial_status',
  'template_subtasks',
  'assignee_mode',
  'assignees',
  'assignee_next'
]);

// Fields of the body of a rule that are no schema fields (the request hook of the rules reads them).
var RULE_BODY_FIELDS = Object.freeze(['start', 'backlog']);

// Limits of one request. The sub-tasks follow the limit of a template (TEMPLATE_SUBTASKS_MAX of
// lib/recurrence-rules.js); the rest keeps one request small.
var SUBTASKS_MAX = 20;
var TICKET_SOURCES_MAX = 20;
var SOURCES_MAX = 50;

// Longest title of a ticket (tickets.title, migration 1790200500) and description (100 000).
var TITLE_MAX = 200;
var DESCRIPTION_MAX = 100000;

var PRIORITIES = Object.freeze(['low', 'medium', 'high', 'urgent']);
var DEFAULT_PRIORITY = 'medium';

var MESSAGES = Object.freeze({
  validation_create_format: 'Dieser Wert ist ungültig.',
  validation_create_title: 'Der Titel darf nicht leer sein.',
  validation_create_title_max: 'Der Titel hat höchstens 200 Zeichen.',
  validation_create_description_max: 'Die Beschreibung hat höchstens 100 000 Zeichen.',
  validation_create_unavailable: 'Diese Option kennt der Server erst nach einem Neustart der App.',
  validation_create_subtasks: 'Die Unteraufgaben sind ungültig.',
  validation_create_subtasks_max: 'Beim Anlegen gehen höchstens 20 Unteraufgaben.',
  validation_create_subtask_title: 'Jede Unteraufgabe braucht einen Titel.',
  validation_create_subtask_title_max: 'Der Titel einer Unteraufgabe hat höchstens 200 Zeichen.',
  validation_create_subtask_priority: 'Bitte für jede Unteraufgabe eine gültige Priorität wählen.',
  validation_create_subtasks_nested: 'Eine Unteraufgabe hat keine eigenen Unteraufgaben (nur eine Ebene).',
  validation_create_ticket_sources: 'Die Quell-Tickets sind ungültig.',
  validation_create_ticket_sources_max: 'Beim Anlegen gehen höchstens 20 Quell-Tickets.',
  validation_create_sources: 'Die Quellen aus dem Eingang sind ungültig.',
  validation_create_sources_max: 'Beim Anlegen gehen höchstens 50 Einträge aus dem Eingang.',
  validation_create_source_missing: 'Dieser Eintrag ist nicht mehr im Eingang oder für dich nicht sichtbar.',
  validation_create_recurrence: 'Die Angaben zur Wiederholung sind ungültig.'
});

function isEmpty(value) {
  return value === undefined || value === null;
}

function isList(value) {
  return Object.prototype.toString.call(value) === '[object Array]';
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !isList(value);
}

function trim(value) {
  return String(value).replace(/^\s+|\s+$/g, '');
}

// Characters of a text as PocketBase counts them (code points: a surrogate pair is one).
function characterCount(text) {
  var count = 0;
  for (var i = 0; i < text.length; i++) {
    var code = text.charCodeAt(i);
    if (code < 0xdc00 || code > 0xdfff) {
      count += 1;
    }
  }
  return count;
}

function violation(field, code, index) {
  var found = { field: field, code: code };
  if (typeof index === 'number') {
    found.index = index;
  }
  return found;
}

// A list of record IDs: missing is [], each a non-empty text, each once (in the order of the request).
function idList(value, field, max, code) {
  if (isEmpty(value)) {
    return { ids: [] };
  }
  if (!isList(value)) {
    return { failure: violation(field, code) };
  }
  if (value.length > max) {
    return { failure: violation(field, code + '_max') };
  }
  var ids = [];
  for (var i = 0; i < value.length; i++) {
    if (typeof value[i] !== 'string' || trim(value[i]) === '') {
      return { failure: violation(field, code, i) };
    }
    if (ids.indexOf(value[i]) === -1) {
      ids.push(value[i]);
    }
  }
  return { ids: ids };
}

// The sub-tasks: missing is [], at most SUBTASKS_MAX entries { title, priority }, titles trimmed and
// required, an empty priority "medium" (like a new ticket and the template of a rule).
function subtaskList(value) {
  if (isEmpty(value)) {
    return { subtasks: [] };
  }
  if (!isList(value)) {
    return { failure: violation('subtasks', 'validation_create_subtasks') };
  }
  if (value.length > SUBTASKS_MAX) {
    return { failure: violation('subtasks', 'validation_create_subtasks_max') };
  }
  var subtasks = [];
  for (var i = 0; i < value.length; i++) {
    var entry = value[i];
    if (!isObject(entry) || (!isEmpty(entry.title) && typeof entry.title !== 'string')) {
      return { failure: violation('subtasks', 'validation_create_subtasks', i) };
    }
    var title = isEmpty(entry.title) ? '' : trim(entry.title);
    if (title === '') {
      return { failure: violation('subtasks', 'validation_create_subtask_title', i) };
    }
    if (characterCount(title) > TITLE_MAX) {
      return { failure: violation('subtasks', 'validation_create_subtask_title_max', i) };
    }
    var priority = isEmpty(entry.priority) || entry.priority === '' ? DEFAULT_PRIORITY : entry.priority;
    if (PRIORITIES.indexOf(priority) === -1) {
      return { failure: violation('subtasks', 'validation_create_subtask_priority', i) };
    }
    subtasks.push({ title: title, priority: priority });
  }
  return { subtasks: subtasks };
}

// A switch of the request: missing is off, else true or false.
function flag(value, field) {
  if (isEmpty(value)) {
    return { value: false };
  }
  if (value !== true && value !== false) {
    return { failure: violation(field, 'validation_create_format') };
  }
  return { value: value };
}

// The rule: missing is none, else an object of which only RULE_FIELDS and RULE_BODY_FIELDS count.
function ruleOf(value) {
  if (isEmpty(value)) {
    return { rule: null };
  }
  if (!isObject(value)) {
    return { failure: violation('recurrence', 'validation_create_recurrence') };
  }
  var fields = {};
  var body = {};
  for (var i = 0; i < RULE_FIELDS.length; i++) {
    var name = RULE_FIELDS[i];
    if (Object.prototype.hasOwnProperty.call(value, name)) {
      fields[name] = value[name];
      body[name] = value[name];
    }
  }
  for (var j = 0; j < RULE_BODY_FIELDS.length; j++) {
    var extra = RULE_BODY_FIELDS[j];
    if (Object.prototype.hasOwnProperty.call(value, extra)) {
      body[extra] = value[extra];
    }
  }
  return { rule: { fields: fields, body: body } };
}

/**
 * The request body of POST /api/byl/tickets/create as plain options, or the first violation.
 * `body` is the parsed JSON (anything else counts as empty). Returns { options } or
 * { field, code, index? }:
 *   ticket         the TEXT_FIELDS as texts ('' when missing; the title trimmed, 1 to 200
 *                  characters; the description at most 100 000), `tags` as a list of IDs and
 *                  `blocks_parent` (true when missing, like the request hook of tickets)
 *   subtasks       [{ title, priority }] (subtaskList)
 *   ticketSources  IDs of the tickets the new one stems from (ADR-0067), each once
 *   sources        IDs of new entries of the inbox that become its sources (ADR-0031), each once
 *   rule           { fields, body } of the series (ruleOf) or null
 *   pin, dayPlan   the switches "Anheften" (ADR-0064) and "Zum Tagesplan" (ADR-0065)
 */
function parseRequest(body) {
  var input = isObject(body) ? body : {};
  var ticket = {};
  for (var i = 0; i < TEXT_FIELDS.length; i++) {
    var name = TEXT_FIELDS[i];
    var value = input[name];
    if (isEmpty(value)) {
      ticket[name] = '';
    } else if (typeof value === 'string') {
      ticket[name] = value;
    } else {
      return violation(name, 'validation_create_format');
    }
  }
  ticket.title = trim(ticket.title);
  if (ticket.title === '') {
    return violation('title', 'validation_create_title');
  }
  if (characterCount(ticket.title) > TITLE_MAX) {
    return violation('title', 'validation_create_title_max');
  }
  if (characterCount(ticket.description) > DESCRIPTION_MAX) {
    return violation('description', 'validation_create_description_max');
  }
  var tags = idList(input.tags, 'tags', Number.MAX_VALUE, 'validation_create_format');
  if (tags.failure) {
    return tags.failure;
  }
  ticket.tags = tags.ids;
  var blocks = isEmpty(input.blocks_parent) ? { value: true } : flag(input.blocks_parent, 'blocks_parent');
  if (blocks.failure) {
    return blocks.failure;
  }
  ticket.blocks_parent = blocks.value;

  var subtasks = subtaskList(input.subtasks);
  if (subtasks.failure) {
    return subtasks.failure;
  }
  var ticketSources = idList(input.ticket_sources, 'ticket_sources', TICKET_SOURCES_MAX, 'validation_create_ticket_sources');
  if (ticketSources.failure) {
    return ticketSources.failure;
  }
  var sources = idList(input.sources, 'sources', SOURCES_MAX, 'validation_create_sources');
  if (sources.failure) {
    return sources.failure;
  }
  var rule = ruleOf(input.recurrence);
  if (rule.failure) {
    return rule.failure;
  }
  var pin = flag(input.pin, 'pin');
  if (pin.failure) {
    return pin.failure;
  }
  var dayPlan = flag(input.day_plan, 'day_plan');
  if (dayPlan.failure) {
    return dayPlan.failure;
  }
  return {
    options: {
      ticket: ticket,
      subtasks: subtasks.subtasks,
      ticketSources: ticketSources.ids,
      // The entry the ticket is converted from (`source_item`) is its main source already.
      sources: sources.ids.filter(function (id) {
        return id !== ticket.source_item;
      }),
      rule: rule.rule,
      pin: pin.value,
      dayPlan: dayPlan.value
    }
  };
}

/**
 * Whether the ticket is a sub-task that is to get sub-tasks of its own: one level only (ADR-0033).
 */
function nestedSubtasks(parent, subtasks) {
  return parent !== '' && subtasks.length > 0;
}

module.exports = {
  TEXT_FIELDS: TEXT_FIELDS,
  LATER_FIELDS: LATER_FIELDS,
  SELECT_FIELDS: SELECT_FIELDS,
  RULE_FIELDS: RULE_FIELDS,
  RULE_BODY_FIELDS: RULE_BODY_FIELDS,
  SUBTASKS_MAX: SUBTASKS_MAX,
  TICKET_SOURCES_MAX: TICKET_SOURCES_MAX,
  SOURCES_MAX: SOURCES_MAX,
  TITLE_MAX: TITLE_MAX,
  DESCRIPTION_MAX: DESCRIPTION_MAX,
  PRIORITIES: PRIORITIES,
  DEFAULT_PRIORITY: DEFAULT_PRIORITY,
  MESSAGES: MESSAGES,
  characterCount: characterCount,
  parseRequest: parseRequest,
  nestedSubtasks: nestedSubtasks
};
