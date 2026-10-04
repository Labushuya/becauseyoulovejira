// Pure rules of a household (ADR-0058, E7-2): the catalog of rights and who may change what, the
// invitation codes (alphabet, normalizing, format, status), the names and the answers of the routes.
// CommonJS module, ES5 only, no dependencies (Goja runtime and Vitest load it the same way); the
// routes live in household.pb.js with lib/household-service.js. web/src/lib/domain/household.ts
// mirrors the rules and texts (parity test).
'use strict';

// Rights besides the normal use of the household, in the order of the page. The owner has every one
// by the role; a new member has none.
//   invite   - create and revoke invitation codes
//   remove   - remove members (never the owner)
//   delegate - give and take rights, only those one holds oneself
//   rename   - rename the household
//   purge    - delete for good in the household and set the retention of its trash (since E7-3)
//   move_out - move household records of others into the private area (since E7-4, ADR-0061 §4)
var RIGHTS = ['invite', 'remove', 'delegate', 'rename', 'purge', 'move_out'];
var OWNER = 'owner';
var MEMBER = 'member';

// Retention of the trash of a household (E7-3, migration 1790204100), the values of
// users.trash_retention (lib/trash-rules.js RETENTION_VALUES); empty means 30 days.
var RETENTIONS = ['7', '30', '90', 'never'];

// The same limit as the field households.name and the display name of an account.
var NAME_MAX = 100;
var CONTROL = /[\u0000-\u001f\u007f]/;

// Invitation codes: 8 signs of 31 without look-alikes (no 0, O, 1, I, L), about 40 bits, shown in two
// groups ("ABCD-EFGH"). Case, white space and hyphens do not count when a code is typed.
var CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
var CODE_LENGTH = 8;
var CODE_GROUP = 4;
var DAY_MS = 24 * 60 * 60 * 1000;
// A code is valid for 7 days and once.
var INVITE_VALID_MS = 7 * DAY_MS;
// Open codes of one household at a time.
var OPEN_INVITES_MAX = 10;
// An ended code (used, revoked, expired) stays in the list for 7 days and in the database for 30.
var ENDED_LISTED_MS = 7 * DAY_MS;
var ENDED_KEPT_MS = 30 * DAY_MS;

// Texts of the refused requests; the page says the same (web/src/lib/domain/household.ts). "code" is
// the one neutral answer for an unknown, expired, used or revoked code.
var PROBLEMS = {
  name: 'Bitte einen Namen eingeben.',
  'name-long': 'Höchstens ' + NAME_MAX + ' Zeichen.',
  format: 'Die Angabe fehlt oder ist ungültig.',
  code: 'Code ungültig oder abgelaufen.',
  'already-member': 'Du bist schon Mitglied eines Haushalts. Ein Konto kann vorerst nur in einem Haushalt sein.',
  'no-household': 'Du bist in keinem Haushalt.',
  right: 'Dafür fehlt dir das Recht im Haushalt.',
  'owner-only': 'Das kann nur der Inhaber des Haushalts.',
  'owner-untouchable': 'Beim Inhaber des Haushalts geht das nicht.',
  'self-rights': 'Deine eigenen Rechte kann nur ein anderes Mitglied ändern.',
  'self-remove': 'Um den Haushalt zu verlassen, wähle „Austreten“.',
  'self-transfer': 'Du bist schon Inhaber des Haushalts.',
  'rights-foreign': 'Du kannst nur Rechte vergeben oder entziehen, die du selbst hast.',
  member: 'Dieses Mitglied gibt es im Haushalt nicht mehr.',
  invite: 'Diesen Code gibt es nicht mehr.',
  'invite-closed': 'Dieser Code ist nicht mehr offen.',
  'invites-full': 'Höchstens ' + OPEN_INVITES_MAX + ' offene Codes. Widerrufe zuerst einen.',
  'owner-leave':
    'Als Inhaber kannst du nicht austreten. Übertrage zuerst die Inhaberschaft an ein anderes Mitglied, ' +
    'oder löse den Haushalt auf.',
  retention: 'Bitte 7, 30 oder 90 Tage oder „Nie automatisch“ wählen.'
};

var STATUS_OF_PROBLEM = {
  'already-member': 409,
  'invites-full': 409,
  'owner-leave': 409,
  'invite-closed': 409,
  'no-household': 404,
  member: 404,
  invite: 404,
  right: 403,
  'owner-only': 403,
  'owner-untouchable': 403,
  'rights-foreign': 403
};

function text(value) {
  return typeof value === 'string' ? value : '';
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !(value instanceof Array);
}

/** A name as it is stored: without white space at its ends. */
function normalizeName(value) {
  return text(value).replace(/^\s+|\s+$/g, '');
}

/** '' for a valid name of a household, else the problem ('name' or 'name-long'). */
function nameProblem(value) {
  var name = normalizeName(value);
  if (name === '' || CONTROL.test(name)) {
    return 'name';
  }
  return name.length > NAME_MAX ? 'name-long' : '';
}

/** Body { name }: { name } trimmed or { problem }. */
function nameInput(body) {
  var value = isObject(body) ? body.name : undefined;
  var problem = nameProblem(value);
  return problem !== '' ? { problem: problem } : { name: normalizeName(value) };
}

/** Known rights of `list` once each, in the order of the catalog. */
function orderedRights(list) {
  var result = [];
  for (var i = 0; i < RIGHTS.length; i++) {
    for (var j = 0; j < list.length; j++) {
      if (list[j] === RIGHTS[i]) {
        result.push(RIGHTS[i]);
        break;
      }
    }
  }
  return result;
}

/** The rights of a membership: every one for the owner, the stored known ones for a member. */
function effectiveRights(role, stored) {
  if (role === OWNER) {
    return RIGHTS.slice();
  }
  var list = [];
  if (stored && typeof stored.length === 'number') {
    for (var i = 0; i < stored.length; i++) {
      list.push(String(stored[i]));
    }
  }
  return orderedRights(list);
}

/** Whether a membership { role, rights } holds `right`. */
function may(actor, right) {
  return effectiveRights(actor.role, actor.rights).indexOf(right) !== -1;
}

/** Body { rights: [...] }: { rights } (known, once, in order) or { problem: 'format' }. */
function rightsInput(body) {
  var value = isObject(body) ? body.rights : undefined;
  if (!(value instanceof Array) || value.length > RIGHTS.length * 2) {
    return { problem: 'format' };
  }
  for (var i = 0; i < value.length; i++) {
    if (typeof value[i] !== 'string' || RIGHTS.indexOf(value[i]) === -1) {
      return { problem: 'format' };
    }
  }
  return { rights: orderedRights(value) };
}

/** The rights that differ between two lists. */
function changedRights(before, after) {
  var changed = [];
  for (var i = 0; i < RIGHTS.length; i++) {
    if ((before.indexOf(RIGHTS[i]) !== -1) !== (after.indexOf(RIGHTS[i]) !== -1)) {
      changed.push(RIGHTS[i]);
    }
  }
  return changed;
}

/**
 * The problem of giving `target` the rights `next`, or ''. `actor` and `target` are memberships
 * { id, role, rights } of the same household. Only with "delegate", never at the owner, never at
 * oneself, and only rights the actor holds himself may change: no way to more rights.
 */
function rightsProblem(actor, target, next) {
  if (!may(actor, 'delegate')) {
    return 'right';
  }
  if (actor.id === target.id) {
    return 'self-rights';
  }
  if (target.role === OWNER) {
    return 'owner-untouchable';
  }
  var own = effectiveRights(actor.role, actor.rights);
  var changed = changedRights(effectiveRights(target.role, target.rights), next);
  for (var i = 0; i < changed.length; i++) {
    if (own.indexOf(changed[i]) === -1) {
      return 'rights-foreign';
    }
  }
  return '';
}

/** The problem of removing `target`, or '': only with "remove", never the owner, never oneself. */
function removeProblem(actor, target) {
  if (!may(actor, 'remove')) {
    return 'right';
  }
  if (actor.id === target.id) {
    return 'self-remove';
  }
  return target.role === OWNER ? 'owner-untouchable' : '';
}

/** The problem of handing the household to `target`, or '': only the owner, to another member. */
function transferProblem(actor, target) {
  if (actor.role !== OWNER) {
    return 'owner-only';
  }
  return actor.id === target.id ? 'self-transfer' : '';
}

/** The problem of leaving, or '': the owner hands the household on first. */
function leaveProblem(actor) {
  return actor.role === OWNER ? 'owner-leave' : '';
}

/**
 * Whether a membership { role, rights } may delete for good in the trash of its household and set
 * its retention (E7-3): the owner and every member with "purge".
 */
function mayPurge(actor) {
  return may(actor, 'purge');
}

/** Body { retention }: { retention } of RETENTIONS or { problem: 'retention' }. */
function retentionInput(body) {
  var value = isObject(body) ? body.retention : undefined;
  return typeof value === 'string' && RETENTIONS.indexOf(value) !== -1 ? { retention: value } : { problem: 'retention' };
}

/** The stored retention of a household as the page shows it: one of RETENTIONS, '' for the default. */
function retentionOf(value) {
  return typeof value === 'string' && RETENTIONS.indexOf(value) !== -1 ? value : '';
}

/** A typed code as it is compared: capitals, without white space and hyphens. */
function normalizeCode(value) {
  return text(value)
    .toUpperCase()
    .replace(/[\s\-‐‑‒–—−]/g, '');
}

/** Whether `code` (normalized) has the form of a code: CODE_LENGTH signs of the alphabet. */
function isCode(code) {
  if (typeof code !== 'string' || code.length !== CODE_LENGTH) {
    return false;
  }
  for (var i = 0; i < code.length; i++) {
    if (CODE_ALPHABET.indexOf(code.charAt(i)) === -1) {
      return false;
    }
  }
  return true;
}

/** A normalized code in groups for the page: "ABCD-EFGH". */
function formatCode(code) {
  var signs = text(code);
  var groups = [];
  for (var i = 0; i < signs.length; i += CODE_GROUP) {
    groups.push(signs.slice(i, i + CODE_GROUP));
  }
  return groups.join('-');
}

/** Body { code }: { code } normalized, or { problem: 'code' } (the neutral answer) for anything else. */
function codeInput(body) {
  var code = normalizeCode(isObject(body) ? body.code : '');
  return isCode(code) ? { code: code } : { problem: 'code' };
}

/** Milliseconds of a PocketBase date ("2026-10-04 08:00:00.000Z"), NaN for '' and nonsense. */
function toMs(value) {
  var raw = text(value);
  return raw === '' ? NaN : Date.parse(raw.replace(' ', 'T'));
}

/** A PocketBase date of `ms`. */
function toDate(ms) {
  return new Date(ms).toISOString().replace('T', ' ');
}

/**
 * The status of a code { expires_at, used_at, revoked_at } at `now`: 'used', 'revoked', 'expired' or
 * 'open'. Only an open code lets someone join.
 */
function inviteStatus(invite, now) {
  if (text(invite.used_at) !== '') {
    return 'used';
  }
  if (text(invite.revoked_at) !== '') {
    return 'revoked';
  }
  var expires = toMs(invite.expires_at);
  return !(expires > now) ? 'expired' : 'open';
}

/** When a code ended (used, revoked or expired), in ms; NaN while it is open. */
function endedAt(invite, now) {
  var status = inviteStatus(invite, now);
  if (status === 'used') {
    return toMs(invite.used_at);
  }
  if (status === 'revoked') {
    return toMs(invite.revoked_at);
  }
  return status === 'expired' ? toMs(invite.expires_at) : NaN;
}

/** Whether the page lists a code: open, or ended within ENDED_LISTED_MS. */
function isListed(invite, now) {
  var ended = endedAt(invite, now);
  return isNaN(ended) ? inviteStatus(invite, now) === 'open' : now - ended <= ENDED_LISTED_MS;
}

/** Whether a code may go from the database: ended more than ENDED_KEPT_MS ago. */
function isStale(invite, now) {
  var ended = endedAt(invite, now);
  return !isNaN(ended) && now - ended > ENDED_KEPT_MS;
}

/** One code of the list of the page; never the code itself or its hash. */
function inviteView(invite, now, names) {
  var known = names || {};
  return {
    id: text(invite.id),
    status: inviteStatus(invite, now),
    created: text(invite.created),
    expires: text(invite.expires_at),
    ended: isNaN(endedAt(invite, now)) ? '' : toDate(endedAt(invite, now)),
    createdBy: text(known[text(invite.created_by)]),
    usedBy: text(known[text(invite.used_by)])
  };
}

/** One member of the list of the page: name, role and rights (every one for the owner). */
function memberView(member, selfId) {
  return {
    id: text(member.id),
    user: text(member.user),
    name: text(member.name),
    role: member.role === OWNER ? OWNER : MEMBER,
    rights: effectiveRights(member.role, member.rights),
    self: text(member.id) === text(selfId)
  };
}

/** Answer of a refused request: { status, body } with reason "invalid" and the problem. */
function problemBody(problem) {
  var known = Object.prototype.hasOwnProperty.call(PROBLEMS, problem) ? problem : 'format';
  var status = STATUS_OF_PROBLEM[known] || 400;
  return {
    status: status,
    body: { status: status, message: PROBLEMS[known], reason: 'invalid', problem: known }
  };
}

module.exports = {
  RIGHTS: RIGHTS,
  RETENTIONS: RETENTIONS,
  OWNER: OWNER,
  MEMBER: MEMBER,
  NAME_MAX: NAME_MAX,
  CODE_ALPHABET: CODE_ALPHABET,
  CODE_LENGTH: CODE_LENGTH,
  INVITE_VALID_MS: INVITE_VALID_MS,
  OPEN_INVITES_MAX: OPEN_INVITES_MAX,
  ENDED_LISTED_MS: ENDED_LISTED_MS,
  ENDED_KEPT_MS: ENDED_KEPT_MS,
  PROBLEMS: PROBLEMS,
  normalizeName: normalizeName,
  nameProblem: nameProblem,
  nameInput: nameInput,
  effectiveRights: effectiveRights,
  may: may,
  rightsInput: rightsInput,
  changedRights: changedRights,
  rightsProblem: rightsProblem,
  removeProblem: removeProblem,
  transferProblem: transferProblem,
  leaveProblem: leaveProblem,
  mayPurge: mayPurge,
  retentionInput: retentionInput,
  retentionOf: retentionOf,
  normalizeCode: normalizeCode,
  isCode: isCode,
  formatCode: formatCode,
  codeInput: codeInput,
  toMs: toMs,
  toDate: toDate,
  inviteStatus: inviteStatus,
  endedAt: endedAt,
  isListed: isListed,
  isStale: isStale,
  inviteView: inviteView,
  memberView: memberView,
  problemBody: problemBody
};
