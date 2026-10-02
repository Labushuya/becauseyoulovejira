// Target project of the ways into the inbox (ADR-0049, package 1 "Standardprojekt je Verbindung"):
// the pure rules. Every way into the inbox has an optional target project; an entry remembers the
// target it got when it came in (inbox_items.target_project), and converting the entry chooses it
// in advance. CommonJS module, ES5 only, no dependencies (Goja runtime and Vitest load it the same
// way); web/src/lib/domain/target-project.ts mirrors the names of the cards and the texts.
'use strict';

// Field of inbox_items and connections (relation to projects, at most one).
var FIELD = 'target_project';

// JSON field of users with the targets of the cards that have no connection record.
var USER_FIELD = 'inbox_targets';

// Transient record key of a target the server already resolved for a new entry: the copy of a
// source for a duplicate takes the target of its original (ADR-0045), and a way with its own units
// (a repository, a folder; ADR-0049 §3) passes the target of its unit. A client cannot send a field
// name with "@".
var GIVEN_KEY = '@target_project';

// Note in source_meta of an entry whose target project was deleted: PocketBase empties the relation
// then (the only way it becomes empty), and converting says why nothing is chosen in advance.
var GONE_KEY = 'target_gone';

// Cards without a connection record and the channels of their entries. The own inbox and WhatsApp
// Web keep their target per user like their keywords (ADR-0038 §1, users.import_keywords); the card
// "Dateien" has one target for the three kinds of files.
var CARD_CHANNELS = {
  api: ['api'],
  'whatsapp-web': ['whatsapp-web'],
  files: ['eml', 'ics', 'whatsapp']
};
var CARDS = ['api', 'whatsapp-web', 'files'];

var RECORD_ID = /^[a-z0-9]{15}$/;

var MESSAGES = {
  validation_target_project_missing: 'Dieses Projekt gibt es nicht oder es liegt in einem anderen Bereich.',
  validation_target_project_archived: 'Ein archiviertes Projekt lässt sich nicht als Zielprojekt wählen.',
  validation_inbox_targets: 'Zielprojekte nur für „api“, „whatsapp-web“ und „files“, je mit der ID eines Projekts oder leer.'
};

function isRecordId(value) {
  return typeof value === 'string' && RECORD_ID.test(value);
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && Object.prototype.toString.call(value) === '[object Object]';
}

/** The card without a connection record whose target applies to a channel, '' for none. */
function cardOfChannel(channel) {
  for (var i = 0; i < CARDS.length; i++) {
    if (CARD_CHANNELS[CARDS[i]].indexOf(channel) !== -1) {
      return CARDS[i];
    }
  }
  return '';
}

/**
 * The stored targets of a user as { api, 'whatsapp-web', files } with a record ID or ''. Accepts
 * the parsed value or its JSON text; anything else (empty, broken, unknown keys) reads as none.
 */
function targetsOf(value) {
  var parsed = value;
  if (typeof value === 'string') {
    try {
      parsed = value === '' ? null : JSON.parse(value);
    } catch (err) {
      parsed = null;
    }
  }
  var targets = {};
  for (var i = 0; i < CARDS.length; i++) {
    var id = isPlainObject(parsed) ? parsed[CARDS[i]] : '';
    targets[CARDS[i]] = isRecordId(id) ? id : '';
  }
  return targets;
}

/**
 * Violation of a value of users.inbox_targets a client sends: '' or the message. Allowed are an
 * empty value (null) and an object with only the keys of CARDS, each '' or a record ID.
 */
function targetsViolation(value) {
  if (value === null || value === undefined || value === '') {
    return '';
  }
  if (!isPlainObject(value)) {
    return MESSAGES.validation_inbox_targets;
  }
  for (var key in value) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) {
      continue;
    }
    if (CARDS.indexOf(key) === -1 || (value[key] !== '' && !isRecordId(value[key]))) {
      return MESSAGES.validation_inbox_targets;
    }
  }
  return '';
}

/** Cards whose target differs between two stored values (each read with targetsOf). */
function changedCards(before, after) {
  var old = targetsOf(before);
  var next = targetsOf(after);
  var changed = [];
  for (var i = 0; i < CARDS.length; i++) {
    if (old[CARDS[i]] !== next[CARDS[i]]) {
      changed.push(CARDS[i]);
    }
  }
  return changed;
}

/**
 * The target a new entry asks for, before the project is checked (ADR-0049 §2), first match wins:
 * 1. `given`: a target the server resolved already (copy of a source, the unit of a way); null for
 *    none, '' for "explicitly none";
 * 2. with a connection: the target of the connection (`connectionTarget`), also when it is empty;
 * 3. else the target of the card of the channel (`cardTarget`).
 * Returns a record ID or ''.
 */
function requestedTarget(sources) {
  var given = sources.given;
  var id;
  if (given !== null && given !== undefined) {
    id = String(given);
  } else if (sources.hasConnection) {
    id = sources.connectionTarget || '';
  } else {
    id = sources.cardTarget || '';
  }
  return isRecordId(id) ? id : '';
}

/**
 * The target an entry keeps: the requested project if it exists in the area of the entry. An
 * archived project is kept on purpose (the entry remembers what its way said; converting then
 * chooses nothing and says why). `project` is { scope } or null.
 */
function usableTarget(id, project, scope) {
  return id !== '' && project !== null && project !== undefined && project.scope === scope ? id : '';
}

/**
 * Whether a project may be chosen as target by a user (connection, card): it must exist in the area
 * of the way and be active. `project` is { scope, archived } or null. Returns '' or the code.
 */
function choiceViolation(project, scope) {
  if (project === null || project === undefined || project.scope !== scope) {
    return 'validation_target_project_missing';
  }
  return project.archived ? 'validation_target_project_archived' : '';
}

/** source_meta of an entry whose target project was deleted: the note GONE_KEY, nothing else changes. */
function withTargetGone(meta) {
  var next = {};
  var source = isPlainObject(meta) ? meta : {};
  for (var key in source) {
    if (Object.prototype.hasOwnProperty.call(source, key)) {
      next[key] = source[key];
    }
  }
  next[GONE_KEY] = true;
  return next;
}

module.exports = {
  FIELD: FIELD,
  USER_FIELD: USER_FIELD,
  GIVEN_KEY: GIVEN_KEY,
  GONE_KEY: GONE_KEY,
  CARDS: CARDS,
  CARD_CHANNELS: CARD_CHANNELS,
  MESSAGES: MESSAGES,
  isRecordId: isRecordId,
  cardOfChannel: cardOfChannel,
  targetsOf: targetsOf,
  targetsViolation: targetsViolation,
  changedCards: changedCards,
  requestedTarget: requestedTarget,
  usableTarget: usableTarget,
  choiceViolation: choiceViolation,
  withTargetGone: withTargetGone
};
