// Pure rules of moving records between the areas Privat and Haushalt and of dissolving a household
// (E7-4, ADR-0061): the input of the routes, who may move what, the codes of moved projects, the
// mapping of tags by name, the history entry of a moved ticket and the answers of a refusal.
// CommonJS module, ES5 only, no dependencies (Goja runtime and Vitest load it the same way); the
// routes live in area.pb.js and household.pb.js with lib/area-move-service.js.
// web/src/lib/domain/area-move.ts mirrors the texts and the rules of the dialog (parity test).
'use strict';

// Kinds of records a move starts from; each takes its cascade along (lib/area-move-service.js).
var KINDS = ['ticket', 'project', 'rule', 'item'];
// Directions: into the household of the account, or into its private area.
var DIRECTIONS = ['household', 'private'];
// What happens to a dependency with a ticket that stays behind: take that ticket along, or release
// the dependency.
var DEPENDENCY_CHOICES = ['take', 'release'];
// Ways to dissolve a household: everything into the private area of the owner, or delete all.
var DISSOLVE_MODES = ['adopt', 'delete'];
// At most this many records start one move (the bulk action of the table "Aufgaben" included).
var MAX_ROOTS = 200;

// History field of a moved ticket; the old value is the key before, the new value JSON (historyValue).
var HISTORY_FIELD = 'area_move';
// Transient record key of a write of a move: the model hooks of tickets, projects and inbox items
// only call e.next() (the move service sets scope, key and history itself). A client cannot send a
// field name with "@".
var MOVE_KEY = '@area_move';

var RECORD_ID = /^[a-z0-9]{15}$/;
var CODE_PATTERN = /^[A-Z]{2,6}$/;
var TASK = 'TASK';
// Letters of the suffix of a code that collides when a household is dissolved: H for "Haushalt"
// first, then the alphabet.
var SUFFIX_LETTERS = 'HABCDEFGIJKLMNOPQRSTUVWXYZ';

// Texts of the refused requests; the dialog says the same (web/src/lib/domain/area-move.ts).
var PROBLEMS = {
  format: 'Die Angabe fehlt oder ist ungültig.',
  'too-many': 'Höchstens ' + MAX_ROOTS + ' Einträge auf einmal.',
  'no-household': 'Du bist in keinem Haushalt.',
  missing: 'Diesen Eintrag gibt es nicht (mehr), oder er ist für dich nicht sichtbar.',
  area: 'Der Eintrag liegt nicht in dem Bereich, aus dem verschoben wird.',
  linked: 'Dieser Eintrag gehört zu einem Ticket. Verschiebe das Ticket, dann kommt der Eintrag mit.',
  right:
    'Dafür fehlt dir das Recht. Ins Private verschieben dürfen nur der Ersteller, der Inhaber und Mitglieder mit dem Recht „Ins Private verschieben“.',
  'project-choice': 'Bitte wählen, in welches Projekt die Einträge im Ziel kommen, oder „Ohne Projekt“.',
  project: 'Dieses Projekt gibt es im Ziel nicht, oder es ist archiviert.',
  'dependencies-choice': 'Bitte wählen, ob die verknüpften Tickets mitkommen oder die Verknüpfung gelöst wird.',
  code: 'Bitte einen Code aus 2 bis 6 Großbuchstaben wählen, den es im Ziel noch nicht gibt (nicht TASK).',
  'owner-only': 'Auflösen kann nur der Inhaber des Haushalts.',
  mode: 'Bitte wählen: alles ins Private übernehmen oder alles endgültig löschen.',
  'dissolve-name': 'Bitte den Namen des Haushalts genau so eintippen, wie er hier steht.'
};

var STATUS_OF_PROBLEM = {
  'no-household': 404,
  missing: 404,
  right: 403,
  'owner-only': 403,
  linked: 409
};

function text(value) {
  return typeof value === 'string' ? value : '';
}

function isObject(value) {
  return value !== null && typeof value === 'object' && Object.prototype.toString.call(value) === '[object Object]';
}

function isRecordId(value) {
  return typeof value === 'string' && RECORD_ID.test(value);
}

/**
 * Body of POST /api/byl/area/move: { kind, ids, to, preview?, project?, dependencies?, codes? }.
 * Returns the input (ids once each, codes in capitals; project and dependencies undefined when not
 * chosen) or { problem }.
 */
function moveInput(body) {
  if (!isObject(body)) {
    return { problem: 'format' };
  }
  if (KINDS.indexOf(body.kind) === -1 || DIRECTIONS.indexOf(body.to) === -1) {
    return { problem: 'format' };
  }
  if (!(body.ids instanceof Array) || body.ids.length === 0) {
    return { problem: 'format' };
  }
  if (body.ids.length > MAX_ROOTS) {
    return { problem: 'too-many' };
  }
  var ids = [];
  for (var i = 0; i < body.ids.length; i++) {
    if (!isRecordId(body.ids[i])) {
      return { problem: 'format' };
    }
    if (ids.indexOf(body.ids[i]) === -1) {
      ids.push(body.ids[i]);
    }
  }
  var project;
  if (body.project !== undefined && body.project !== null) {
    if (body.project !== '' && !isRecordId(body.project)) {
      return { problem: 'format' };
    }
    project = body.project;
  }
  var dependencies;
  if (body.dependencies !== undefined && body.dependencies !== null) {
    if (DEPENDENCY_CHOICES.indexOf(body.dependencies) === -1) {
      return { problem: 'format' };
    }
    dependencies = body.dependencies;
  }
  var codes = {};
  if (body.codes !== undefined && body.codes !== null) {
    if (!isObject(body.codes)) {
      return { problem: 'format' };
    }
    for (var key in body.codes) {
      if (!Object.prototype.hasOwnProperty.call(body.codes, key)) {
        continue;
      }
      if (!isRecordId(key) || typeof body.codes[key] !== 'string') {
        return { problem: 'format' };
      }
      codes[key] = normalizeCode(body.codes[key]);
    }
  }
  return {
    kind: body.kind,
    ids: ids,
    to: body.to,
    preview: body.preview === true,
    project: project,
    dependencies: dependencies,
    codes: codes
  };
}

/** A typed code as it is stored: capitals, without white space. */
function normalizeCode(value) {
  return text(value).replace(/\s+/g, '').toUpperCase();
}

/** '' for a code a moved project may take in the target, else 'code'. `taken` lists the codes there. */
function codeProblem(code, taken) {
  if (typeof code !== 'string' || !CODE_PATTERN.test(code) || code === TASK) {
    return 'code';
  }
  return taken.indexOf(code) !== -1 ? 'code' : '';
}

/**
 * A free code for a project whose code is taken in the target, by a suffix (dissolving a household,
 * ADR-0061 §5): the code with H, else another letter, at the end (shortened to 6 letters), else two
 * letters. '' only if every one of them is taken.
 */
function suffixedCode(code, taken) {
  var base = text(code);
  var i;
  for (i = 0; i < SUFFIX_LETTERS.length; i++) {
    var one = base.slice(0, 5) + SUFFIX_LETTERS.charAt(i);
    if (codeProblem(one, taken) === '') {
      return one;
    }
  }
  for (i = 0; i < SUFFIX_LETTERS.length; i++) {
    for (var j = 0; j < SUFFIX_LETTERS.length; j++) {
      var two = base.slice(0, 4) + SUFFIX_LETTERS.charAt(i) + SUFFIX_LETTERS.charAt(j);
      if (codeProblem(two, taken) === '') {
        return two;
      }
    }
  }
  return '';
}

/**
 * Whether `actor` may move a record { owner, household } in `direction` (ADR-0061 §4): into the
 * household only an own private record; into the private area a record of the household created by
 * the actor, or any with the right "move_out" (`moveOut`, the owner by the role).
 */
function mayMove(direction, record, actor, moveOut) {
  var owner = text(record.owner);
  var household = text(record.household);
  if (direction === 'household') {
    return household === '' && owner === actor;
  }
  return household !== '' && (owner === actor || moveOut === true);
}

/**
 * Tags of the moved records by name (ADR-0061 §2): a name the target has is reused, any other is
 * created there. Case does not count, like the unique index of tags. Returns { reused, created } with
 * the names once each, in the order given.
 */
function tagMapping(names, targetNames) {
  var known = {};
  for (var i = 0; i < targetNames.length; i++) {
    known[text(targetNames[i]).toLowerCase()] = true;
  }
  var seen = {};
  var result = { reused: [], created: [] };
  for (var j = 0; j < names.length; j++) {
    var name = text(names[j]);
    var lower = name.toLowerCase();
    if (name === '' || seen[lower]) {
      continue;
    }
    seen[lower] = true;
    (known[lower] ? result.reused : result.created).push(name);
  }
  return result;
}

/**
 * The new value of the history entry of a moved ticket (field HISTORY_FIELD, the old value is the
 * key before): JSON with the direction, the new key and only what else changed: the project before
 * and after (names, '' for none), the key of a parent that stayed behind, whether it left its series,
 * whether it came from a dissolved household.
 */
function historyValue(input) {
  var value = { to: input.to === 'household' ? 'household' : 'private', key: text(input.key) };
  if (input.project) {
    value.project = { from: text(input.project.from), to: text(input.project.to) };
  }
  if (text(input.parent) !== '') {
    value.parent = text(input.parent);
  }
  if (input.series === true) {
    value.series = true;
  }
  if (input.dissolved === true) {
    value.dissolved = true;
  }
  return JSON.stringify(value);
}

/** Body of POST /api/byl/household/dissolve: { mode, preview?, name? } or { problem: 'mode' }. */
function dissolveInput(body) {
  var value = isObject(body) ? body : {};
  if (DISSOLVE_MODES.indexOf(value.mode) === -1) {
    return { problem: 'mode' };
  }
  return { mode: value.mode, preview: value.preview === true, name: text(value.name) };
}

/** Whether the typed name confirms deleting the household `name` (white space at the ends aside). */
function nameConfirmed(typed, name) {
  var trimmed = text(typed).replace(/^\s+|\s+$/g, '');
  return trimmed !== '' && trimmed === text(name).replace(/^\s+|\s+$/g, '');
}

/** Answer of a refused request: { status, body } with reason "invalid", the problem and its params. */
function problemBody(problem, params) {
  var known = Object.prototype.hasOwnProperty.call(PROBLEMS, problem) ? problem : 'format';
  var status = STATUS_OF_PROBLEM[known] || 400;
  var body = { status: status, message: PROBLEMS[known], reason: 'invalid', problem: known };
  if (params) {
    body.params = params;
  }
  return { status: status, body: body };
}

module.exports = {
  KINDS: KINDS,
  DIRECTIONS: DIRECTIONS,
  DEPENDENCY_CHOICES: DEPENDENCY_CHOICES,
  DISSOLVE_MODES: DISSOLVE_MODES,
  MAX_ROOTS: MAX_ROOTS,
  HISTORY_FIELD: HISTORY_FIELD,
  MOVE_KEY: MOVE_KEY,
  PROBLEMS: PROBLEMS,
  isRecordId: isRecordId,
  moveInput: moveInput,
  normalizeCode: normalizeCode,
  codeProblem: codeProblem,
  suffixedCode: suffixedCode,
  mayMove: mayMove,
  tagMapping: tagMapping,
  historyValue: historyValue,
  dissolveInput: dissolveInput,
  nameConfirmed: nameConfirmed,
  problemBody: problemBody
};
