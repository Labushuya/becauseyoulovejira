// Pure decisions of "Ticket duplizieren" (ADR-0045). CommonJS module, ES5 only, no dependencies
// and no `$app` (Goja runtime and Vitest). lib/duplicate-service.js reads and writes the database;
// web/src/lib/domain/duplicate.ts has the same texts (tests/unit/web-duplicate.test.mjs).
'use strict';

// Statuses a duplicate may start with: every status but "done" (a duplicate is new work).
var STATUSES = Object.freeze(['backlog', 'open', 'in_progress', 'waiting']);

// What happens to the sources: none (the default), or a copy of the main source as the main
// source of the duplicate ("Kopie der Herkunft übernehmen").
var SOURCE_CHOICES = Object.freeze(['none', 'copy']);

// The area a duplicate goes to (ADR-0045, addendum MV-2): '' for the area of the original, else the
// household of the account or its private area.
var AREAS = Object.freeze(['household', 'private']);

// Longest title of a ticket (tickets.title, migration 1790200500).
var TITLE_MAX = 200;

// Longest body of a comment (comments.body, migration 1790200600).
var COMMENT_MAX = 20000;

// History field of both tickets: "Dupliziert aus HAUS-12" and "Dupliziert nach HAUS-13".
var HISTORY_FIELD = 'duplicate';

var MESSAGES = Object.freeze({
  validation_duplicate_title: 'Bitte einen Titel mit höchstens 200 Zeichen angeben.',
  validation_duplicate_status_required: 'Bitte wählen, mit welchem Status das Duplikat startet.',
  validation_duplicate_status: 'Ein Duplikat startet mit Backlog, Offen, In Arbeit oder Wartet, nie als „Erledigt“.',
  validation_duplicate_source: 'Diese Wahl der Quelle gibt es nicht.',
  validation_duplicate_source_missing: 'Das Original hat keine Hauptquelle, die sich kopieren ließe.',
  validation_duplicate_source_file:
    'Die Originaldatei der Hauptquelle fehlt; die Herkunft lässt sich so nicht vollständig kopieren.',
  validation_duplicate_area: 'Diesen Zielbereich gibt es nicht.',
  validation_duplicate_no_household: 'Du bist in keinem Haushalt.',
  validation_duplicate_area_right: 'In den Haushalt duplizieren lassen sich nur eigene private Tickets.',
  validation_duplicate_source_area:
    'In einen anderen Bereich kommen keine Quellen mit: Einträge des Eingangs bleiben beim Original, und Ticket-Quellen verweisen nie über die Grenze eines Bereichs.',
  validation_duplicate_project_area: 'Dieses Projekt gibt es im Zielbereich nicht, oder es ist archiviert.'
});

function text(value) {
  return value === undefined || value === null ? '' : String(value);
}

function isTrueFlag(value) {
  return value === true || value === 'true';
}

function trim(value) {
  return text(value).replace(/^\s+|\s+$/g, '');
}

/**
 * The request body of the route as plain options, or the first violation. `body` is the parsed
 * JSON (anything else counts as empty). Returns { options } or { field, code }:
 *   title        trimmed, 1 to TITLE_MAX characters
 *   status       one of STATUSES, required (no default: the user chooses, like "Folgetickets
 *                starten mit", ADR-0022 addendum 9)
 *   project      the project of the duplicate ('' for none); the ticket hook checks it
 *   source       'none' (also when missing) or 'copy'
 *   description, priority, tags, due, parent, subtasks, comments: what to take over (flags)
 *   color        the own color of the ticket (flag, ADR-0052; a client of before sends none)
 *   to           '' (also when missing) for the area of the original, or one of AREAS (MV-2)
 */
function parseRequest(body) {
  var input = body && typeof body === 'object' ? body : {};
  var title = trim(input.title);
  if (title === '' || title.length > TITLE_MAX) {
    return { field: 'title', code: 'validation_duplicate_title' };
  }
  var status = text(input.status);
  if (status === '') {
    return { field: 'status', code: 'validation_duplicate_status_required' };
  }
  if (STATUSES.indexOf(status) === -1) {
    return { field: 'status', code: 'validation_duplicate_status' };
  }
  var source = input.source === undefined || input.source === null ? 'none' : text(input.source);
  if (SOURCE_CHOICES.indexOf(source) === -1) {
    return { field: 'source', code: 'validation_duplicate_source' };
  }
  var to = text(input.to);
  if (to !== '' && AREAS.indexOf(to) === -1) {
    return { field: 'to', code: 'validation_duplicate_area' };
  }
  return {
    options: {
      title: title,
      status: status,
      project: text(input.project),
      source: source,
      to: to,
      description: isTrueFlag(input.description),
      priority: isTrueFlag(input.priority),
      tags: isTrueFlag(input.tags),
      due: isTrueFlag(input.due),
      parent: isTrueFlag(input.parent),
      subtasks: isTrueFlag(input.subtasks),
      comments: isTrueFlag(input.comments),
      color: isTrueFlag(input.color)
    }
  };
}

/**
 * Fields taken from a ticket into its copy (plain values in, plain values out): `ticket`
 * { description, priority, tags, due, color }. What is not taken over gets the default of a new
 * ticket ('' and [], the hook sets priority "medium"; no color means "wie Projekt"). The duplicate
 * and its new sub-tickets use the same choice, each with its own values.
 */
function takenValues(ticket, options) {
  return {
    description: options.description ? text(ticket.description) : '',
    priority: options.priority ? text(ticket.priority) : '',
    tags: options.tags && ticket.tags ? ticket.tags.slice() : [],
    due: options.due ? text(ticket.due) : '',
    color: options.color ? text(ticket.color) : ''
  };
}

/**
 * Value of the history entry "duplicate": direction 'from' (the duplicate) or 'to' (the original).
 * Across the border of an area (MV-2) `area` names the area of the other ticket ('household' or
 * 'private'), and the entry keeps only its key, no ID: no reference crosses the border (ADR-0059 §4).
 */
function historyValue(direction, ticketId, key, area) {
  if (area === 'household' || area === 'private') {
    return JSON.stringify({ direction: direction, ticket: '', key: text(key), area: area });
  }
  return JSON.stringify({ direction: direction, ticket: text(ticketId), key: text(key) });
}

/**
 * Whether a duplicate goes into another area than its original (MV-2): `to` '' keeps the area,
 * 'household' leaves the private area, 'private' leaves the household. `household` is the household
 * of the original ('' for a private one).
 */
function crossesArea(household, to) {
  if (to === 'household') {
    return text(household) === '';
  }
  if (to === 'private') {
    return text(household) !== '';
  }
  return false;
}

/**
 * The right to duplicate into another area (ADR-0045, addendum MV-2), '' or the code: into the
 * household only an own private ticket (`original` { owner, household }); into the private area every
 * member who sees the ticket of the household (the route checks the view rule and the membership).
 */
function areaViolation(to, original, actor) {
  if (to === 'household' && !(text(original.household) === '' && text(original.owner) === text(actor))) {
    return 'validation_duplicate_area_right';
  }
  return '';
}

/**
 * Body of a copied comment: a note "Kopiert aus HAUS-12" with a link to the original ticket, then
 * the text. A text close to COMMENT_MAX gets the note without link and, only if even that does not
 * fit, loses its end ("…"), so copying never fails at the limit of the field.
 */
function copiedCommentBody(body, key, ticketId, max) {
  var limit = max || COMMENT_MAX;
  var content = text(body);
  var linked = '_Kopiert aus [' + key + '](/tickets/' + ticketId + ')._';
  var plain = '_Kopiert aus ' + key + '._';
  var separator = '\n\n';
  if (linked.length + separator.length + content.length <= limit) {
    return linked + separator + content;
  }
  if (plain.length + separator.length + content.length <= limit) {
    return plain + separator + content;
  }
  var room = limit - plain.length - separator.length - 1;
  return plain + separator + content.slice(0, Math.max(0, room)) + '…';
}

/**
 * source_meta of the copy of a source: the details of the original plus `copy_of` { item, ticket,
 * key, at } (the entry, ticket and key it was copied from, and when). The note of a deleted ticket
 * does not travel with it.
 */
function copyMeta(meta, from) {
  var result = {};
  var source = meta && typeof meta === 'object' ? meta : {};
  for (var name in source) {
    if (Object.prototype.hasOwnProperty.call(source, name) && name !== 'ticket_deleted' && name !== 'copy_of') {
      result[name] = source[name];
    }
  }
  result.copy_of = { item: text(from.item), ticket: text(from.ticket), key: text(from.key), at: text(from.at) };
  return result;
}

module.exports = {
  STATUSES: STATUSES,
  SOURCE_CHOICES: SOURCE_CHOICES,
  AREAS: AREAS,
  TITLE_MAX: TITLE_MAX,
  COMMENT_MAX: COMMENT_MAX,
  HISTORY_FIELD: HISTORY_FIELD,
  MESSAGES: MESSAGES,
  parseRequest: parseRequest,
  takenValues: takenValues,
  historyValue: historyValue,
  crossesArea: crossesArea,
  areaViolation: areaViolation,
  copiedCommentBody: copiedCommentBody,
  copyMeta: copyMeta
};
