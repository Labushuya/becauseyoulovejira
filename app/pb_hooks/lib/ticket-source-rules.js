// Pure rules of tickets as sources of other tickets (QT-1, ADR-0067): the circle check, the follow-ups
// reachable from a ticket, the texts of the codes, the values of the history and the request of
// "Folge-Ticket anlegen …". CommonJS module, ES5 only, no dependencies and no `$app` (Goja runtime and
// Vitest load it the same way). lib/ticket-source-service.js reads and writes the database;
// web/src/lib/domain/ticket-origins.ts has the same texts (tests/unit/web-ticket-origins.test.mjs).
//
// A link (ticket, source) means "ticket stems from source". `sourcesOf(id)` gives the IDs a ticket
// stems from, `followUpsOf(id)` the IDs that stem from it.
'use strict';

// History field of the follow-up ticket: "Quelle hinzugefügt: KEY" (new value) and "Quelle entfernt:
// KEY" (old value), each a JSON { ticket, key } of the source.
var HISTORY_SOURCE = 'ticket_source';
// History field of the source ticket: "Folge-Ticket: KEY" (new value) and "Folge-Ticket entfernt: KEY"
// (old value), each a JSON { ticket, key } of the follow-up.
var HISTORY_FOLLOW_UP = 'follow_up';

// Longest title of a ticket (tickets.title, migration 1790200500).
var TITLE_MAX = 200;
// What the title of a follow-up starts with in the dialog.
var FOLLOW_UP_PREFIX = 'Folge: ';

var RECORD_ID = /^[a-z0-9]{15}$/;

var MESSAGES = {
  validation_ticket_source_self: 'Ein Ticket kann nicht aus sich selbst stammen.',
  validation_ticket_source_cycle: 'Diese Verknüpfung würde einen Kreis schließen.',
  validation_ticket_source_missing:
    'Das Ticket gibt es nicht (mehr), es liegt im Papierkorb oder ist für dich nicht sichtbar.',
  validation_ticket_source_format: 'Bitte ein Ticket als Quelle wählen.',
  validation_follow_up_title: 'Bitte einen Titel mit höchstens 200 Zeichen angeben.'
};

function text(value) {
  return value === undefined || value === null ? '' : String(value);
}

function trim(value) {
  return text(value).replace(/^\s+|\s+$/g, '');
}

function isTrueFlag(value) {
  return value === true || value === 'true';
}

function isRecordId(value) {
  return typeof value === 'string' && RECORD_ID.test(value);
}

function has(map, key) {
  return Object.prototype.hasOwnProperty.call(map, key);
}

/**
 * The chain that a new link (ticket stems from source) would close into a circle, or null when it
 * closes none. Returns the IDs from `sourceId` along existing links up to `ticketId`, so
 * [sourceId, ..., ticketId] reads "sourceId stems (through ...) from ticketId"; the shortest such
 * chain (breadth first, the sources of each ticket in the order `sourcesOf` gives them). A link of a
 * ticket to itself is a circle of one: [ticketId]. Diamonds without a circle (A → B, A → C, B → D,
 * C → D) give null. Every ticket is visited once, so a circle among the existing links (which the
 * hook never lets in) cannot loop.
 */
function cyclePath(sourcesOf, ticketId, sourceId) {
  if (ticketId === sourceId) {
    return [ticketId];
  }
  var previous = {};
  previous[sourceId] = null;
  var queue = [sourceId];
  for (var i = 0; i < queue.length; i++) {
    var current = queue[i];
    var next = sourcesOf(current) || [];
    for (var j = 0; j < next.length; j++) {
      var id = next[j];
      if (has(previous, id)) {
        continue;
      }
      previous[id] = current;
      if (id === ticketId) {
        var path = [];
        for (var step = id; step !== null; step = previous[step]) {
          path.push(step);
        }
        return path.reverse();
      }
      queue.push(id);
    }
  }
  return null;
}

/**
 * Every ticket reachable from `startId` through `next` (breadth first, without `startId`): with
 * followUpsOf every ticket that stems from it, directly or over several steps. A ticket among them
 * cannot become a source of `startId`, because it would close a circle.
 */
function reachable(next, startId) {
  var seen = {};
  seen[startId] = true;
  var result = [];
  var queue = [startId];
  for (var i = 0; i < queue.length; i++) {
    var found = next(queue[i]) || [];
    for (var j = 0; j < found.length; j++) {
      if (has(seen, found[j])) {
        continue;
      }
      seen[found[j]] = true;
      result.push(found[j]);
      queue.push(found[j]);
    }
  }
  return result;
}

/** "HAUS-12", "HAUS-12 und HAUS-15", "HAUS-12, HAUS-15 und HAUS-17". */
function keyList(keys) {
  if (keys.length <= 1) {
    return keys.join('');
  }
  return keys.slice(0, -1).join(', ') + ' und ' + keys[keys.length - 1];
}

/**
 * Text of a refused circle with its chain of keys (cyclePath with keys): "HAUS-20 stammt bereits von
 * HAUS-3 ab." or "HAUS-20 stammt bereits (über HAUS-12) von HAUS-3 ab."; a chain of one is the ticket
 * itself.
 */
function cycleMessage(keys) {
  if (!keys || keys.length < 2) {
    return MESSAGES.validation_ticket_source_self;
  }
  var middle = keys.slice(1, -1);
  return (
    keys[0] +
    ' stammt bereits ' +
    (middle.length > 0 ? '(über ' + keyList(middle) + ') ' : '') +
    'von ' +
    keys[keys.length - 1] +
    ' ab.'
  );
}

/** Value of a history entry: the other ticket of the link by ID and its key at that moment. */
function historyValue(ticketId, key) {
  return JSON.stringify({ ticket: text(ticketId), key: text(key) });
}

/** Body of "Quelle hinzufügen → Ticket": { source }. Returns { source } or { code }. */
function parseAdd(body) {
  var input = body && typeof body === 'object' ? body : {};
  if (!isRecordId(input.source)) {
    return { code: 'validation_ticket_source_format' };
  }
  return { source: input.source };
}

/**
 * The title "Folge-Ticket anlegen …" starts with: "Folge: ‹Titel›"; a long title is cut before it
 * fits, with "…", so the whole stays within TITLE_MAX.
 */
function followUpTitle(title) {
  var base = trim(title);
  if (FOLLOW_UP_PREFIX.length + base.length <= TITLE_MAX) {
    return FOLLOW_UP_PREFIX + base;
  }
  var room = TITLE_MAX - FOLLOW_UP_PREFIX.length - 1;
  return FOLLOW_UP_PREFIX + base.slice(0, room).replace(/\s+$/, '') + '…';
}

/**
 * Body of "Folge-Ticket anlegen …": { title, tags, charm, description }. The title is trimmed, 1 to
 * TITLE_MAX characters; the flags say what the follow-up takes over from its source (only `true`
 * counts). Returns { options } or { field, code }.
 */
function parseFollowUp(body) {
  var input = body && typeof body === 'object' ? body : {};
  var title = trim(input.title);
  if (title === '' || title.length > TITLE_MAX) {
    return { field: 'title', code: 'validation_follow_up_title' };
  }
  return {
    options: {
      title: title,
      tags: isTrueFlag(input.tags),
      charm: isTrueFlag(input.charm),
      description: isTrueFlag(input.description)
    }
  };
}

/** The project of a follow-up: the one of its source while that is active, else none (''). */
function followUpProject(projectId, archived) {
  return text(projectId) !== '' && archived !== true ? text(projectId) : '';
}

module.exports = {
  HISTORY_SOURCE: HISTORY_SOURCE,
  HISTORY_FOLLOW_UP: HISTORY_FOLLOW_UP,
  TITLE_MAX: TITLE_MAX,
  FOLLOW_UP_PREFIX: FOLLOW_UP_PREFIX,
  MESSAGES: MESSAGES,
  cyclePath: cyclePath,
  reachable: reachable,
  keyList: keyList,
  cycleMessage: cycleMessage,
  historyValue: historyValue,
  parseAdd: parseAdd,
  followUpTitle: followUpTitle,
  parseFollowUp: parseFollowUp,
  followUpProject: followUpProject
};
