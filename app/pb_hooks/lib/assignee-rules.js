// Pure rules of "Zuständig" (E7-5, ADR-0068): who may be the assignee of a ticket, when an
// assignment by someone else counts (live notice, "neu" again), and the assignment of the tickets of
// a rule of a household: none, one fixed person, or a rotation with a stored pointer. CommonJS module,
// ES5 only, no dependencies (Goja runtime and Vitest); the SPA mirrors it in
// web/src/lib/domain/assignee.ts (tests/unit/web-assignee.test.mjs keeps both equal).
'use strict';

// Modes of a rule; an empty value is "keine".
var MODES = Object.freeze(['fixed', 'rotate']);
// At most this many people in the list of a rule (the field of the migration 1790204900 allows as
// many).
var ASSIGNEES_MAX = 10;

// Texts of the codes, the same in web/src/lib/domain/assignee.ts.
var MESSAGES = Object.freeze({
  validation_assignee_private: 'Private Tickets haben keine Zuständigkeit.',
  validation_assignee_member: 'Zuständig sein kann nur ein Mitglied des Haushalts.',
  validation_recurrence_assignee_private: 'Private Wiederholungen haben keine Zuständigkeit.',
  validation_recurrence_assignee_mode: 'Unbekannte Art der Zuständigkeit.',
  validation_recurrence_assignee_fixed: 'Bitte genau eine Person wählen.',
  validation_recurrence_assignee_rotate: 'Bitte mindestens eine Person wählen.',
  validation_recurrence_assignee_member: 'Zuständig sein kann nur ein Mitglied des Haushalts.',
  validation_recurrence_assignees_max: 'Höchstens 10 Personen.',
  validation_recurrence_assignee_next: 'Ungültige Stelle in der Reihenfolge.'
});

function isMode(value) {
  return MODES.indexOf(value) !== -1;
}

/** The mode of a stored value: 'fixed', 'rotate' or '' ("keine"). */
function modeOf(value) {
  return isMode(value) ? value : '';
}

// --- Tickets -------------------------------------------------------------------------------------

/**
 * The assignee of a ticket (ADR-0068 §1). `input`: { household ('' for a private ticket), assignee
 * ('' for none), changed (the assignee or the household changed with this write, or a create),
 * isMember (the assignee is a member of the household now; only read when it matters) }. Returns ''
 * or the code: a private ticket never has one, and a new or moved assignee is a current member. An
 * unchanged one is not checked again, so another change of the ticket never fails because of it (a
 * membership that ends clears it anyway).
 */
function ticketViolation(input) {
  if (input.assignee === '') {
    return '';
  }
  if (input.household === '') {
    return 'validation_assignee_private';
  }
  if (!input.changed) {
    return '';
  }
  return input.isMember ? '' : 'validation_assignee_member';
}

/**
 * Someone else gave the ticket to its assignee (ADR-0068 §4): a new assignee that is not the account
 * of the write. Own assignments ("Ich übernehme") and writes without an account (the generation of a
 * series, the superuser) are none. `input`: { assignee, previous ('' on create), actor }.
 */
function isForeignAssignment(input) {
  return input.assignee !== '' && input.assignee !== input.previous && input.actor !== '' && input.actor !== input.assignee;
}

/**
 * What happens to `assigned_at` (ADR-0068 §4): 'set' (now) for an assignment by someone else, 'keep'
 * while the assignee stays, 'clear' for every other change (own assignment, none, the server).
 */
function assignedAtAction(input) {
  if (input.assignee === input.previous) {
    return 'keep';
  }
  return isForeignAssignment(input) ? 'set' : 'clear';
}

// --- Rules of a series -----------------------------------------------------------------------------

function listOf(values) {
  var list = [];
  if (values) {
    for (var i = 0; i < values.length; i++) {
      var value = String(values[i]);
      if (value !== '' && list.indexOf(value) === -1) {
        list.push(value);
      }
    }
  }
  return list;
}

function isIndex(value) {
  return typeof value === 'number' && isFinite(value) && Math.floor(value) === value && value >= 0;
}

/**
 * The assignment of a rule as it is stored (ADR-0068 §5). `input`: { household ('' for a private
 * rule), mode, assignees (IDs in order), next (the pointer), nextSent (the client named the pointer),
 * listChanged (mode or list changed with this write, or a create), householdChanged, members (IDs of
 * the members of the household now) }. Returns { code, index } for a refusal (index of the person in
 * the list for `validation_recurrence_assignee_member`, else -1), otherwise { code: '', value: { mode,
 * assignees, next } }: without a mode no people and the pointer 0; "fest" exactly one person;
 * "abwechselnd" at least one; every new or moved person a member; a pointer named by the client inside
 * the list, else 0 after a change of the list and otherwise kept inside it.
 */
function ruleCheck(input) {
  var mode = input.mode === null || input.mode === undefined ? '' : String(input.mode);
  if (mode !== '' && !isMode(mode)) {
    return { code: 'validation_recurrence_assignee_mode', index: -1 };
  }
  var assignees = listOf(input.assignees);
  if (input.household === '') {
    if (mode !== '' || assignees.length > 0) {
      return { code: 'validation_recurrence_assignee_private', index: -1 };
    }
    return { code: '', value: { mode: '', assignees: [], next: 0 } };
  }
  if (mode === '') {
    return { code: '', value: { mode: '', assignees: [], next: 0 } };
  }
  if (assignees.length > ASSIGNEES_MAX) {
    return { code: 'validation_recurrence_assignees_max', index: -1 };
  }
  if (mode === 'fixed' && assignees.length !== 1) {
    return { code: 'validation_recurrence_assignee_fixed', index: -1 };
  }
  if (mode === 'rotate' && assignees.length === 0) {
    return { code: 'validation_recurrence_assignee_rotate', index: -1 };
  }
  if (input.listChanged || input.householdChanged) {
    var members = input.members || [];
    for (var i = 0; i < assignees.length; i++) {
      if (members.indexOf(assignees[i]) === -1) {
        return { code: 'validation_recurrence_assignee_member', index: i };
      }
    }
  }
  var next = 0;
  if (mode === 'rotate') {
    if (input.nextSent) {
      if (!isIndex(input.next) || input.next >= assignees.length) {
        return { code: 'validation_recurrence_assignee_next', index: -1 };
      }
      next = input.next;
    } else if (!input.listChanged && isIndex(input.next) && input.next < assignees.length) {
      next = input.next;
    }
  }
  return { code: '', value: { mode: mode, assignees: assignees, next: next } };
}

/**
 * The person of the next new occurrence of a rule and the pointer after it (ADR-0068 §5): "fest" its
 * one person, "abwechselnd" the person at the pointer (0 outside the list), which then moves on by one,
 * round and round; '' without a mode. `rule`: { mode, assignees, next }.
 */
function nextAssignee(rule) {
  var mode = modeOf(rule.mode);
  var assignees = listOf(rule.assignees);
  if (mode === 'fixed' && assignees.length > 0) {
    return { assignee: assignees[0], next: 0 };
  }
  if (mode === 'rotate' && assignees.length > 0) {
    var index = isIndex(rule.next) && rule.next < assignees.length ? rule.next : 0;
    return { assignee: assignees[index], next: (index + 1) % assignees.length };
  }
  return { assignee: '', next: 0 };
}

/**
 * The people of the next `count` new occurrences, for the preview of the dialog ("Nächstes Vorkommen:
 * …, danach: …"): [] without a mode.
 */
function upcoming(rule, count) {
  var result = [];
  var state = { mode: rule.mode, assignees: listOf(rule.assignees), next: rule.next };
  for (var i = 0; i < count; i++) {
    var step = nextAssignee(state);
    if (step.assignee === '') {
      break;
    }
    result.push(step.assignee);
    state.next = step.next;
  }
  return result;
}

/**
 * A rule without the person `user`, whose membership ended (ADR-0068 §6): out of the list, the pointer
 * stays on the same next person (or the one after the removed one), and an empty list means "keine".
 * Returns { changed, value: { mode, assignees, next } }.
 */
function withoutMember(rule, user) {
  var mode = modeOf(rule.mode);
  var assignees = listOf(rule.assignees);
  var at = assignees.indexOf(user);
  var next = isIndex(rule.next) ? rule.next : 0;
  if (at === -1) {
    return { changed: false, value: { mode: mode, assignees: assignees, next: next } };
  }
  var rest = assignees.slice(0, at).concat(assignees.slice(at + 1));
  if (rest.length === 0 || mode === '') {
    return { changed: true, value: { mode: '', assignees: [], next: 0 } };
  }
  if (mode === 'rotate') {
    if (at < next) {
      next -= 1;
    }
    if (next >= rest.length) {
      next = 0;
    }
  } else {
    next = 0;
  }
  return { changed: true, value: { mode: mode, assignees: rest, next: next } };
}

/**
 * The pointer after a new occurrence with the person `assignee` was taken back (reopening its
 * predecessor removes the untouched follow-up, ADR-0023 section 3): back by one when the person before
 * the pointer is that person, so the next occurrence goes to the same person again; else unchanged.
 */
function pointerBack(rule, assignee) {
  var assignees = listOf(rule.assignees);
  var next = isIndex(rule.next) ? rule.next : 0;
  if (modeOf(rule.mode) !== 'rotate' || assignees.length === 0 || assignee === '') {
    return next;
  }
  var previous = (next - 1 + assignees.length) % assignees.length;
  return assignees[previous] === assignee ? previous : next;
}

module.exports = {
  MODES: MODES,
  ASSIGNEES_MAX: ASSIGNEES_MAX,
  MESSAGES: MESSAGES,
  modeOf: modeOf,
  ticketViolation: ticketViolation,
  isForeignAssignment: isForeignAssignment,
  assignedAtAction: assignedAtAction,
  ruleCheck: ruleCheck,
  nextAssignee: nextAssignee,
  upcoming: upcoming,
  withoutMember: withoutMember,
  pointerBack: pointerBack
};
