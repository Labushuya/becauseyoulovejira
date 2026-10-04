// Pure rules of the accounts and the administrator of the app (ADR-0056, E7-1): who counts as an
// active administrator, the input of the page "Einstellungen → Konten", the fields only the
// administrator changes, the start passwords and the texts. CommonJS module, ES5 only, no
// dependencies (Goja runtime and Vitest load it the same way); the routes and hooks live in
// lib/account-service.js.
'use strict';

// A display name: shown for comments, history and trash, so short and on one line.
var NAME_MAX = 100;
// RFC 5321 limit of a path; PocketBase checks the form once more.
var EMAIL_MAX = 254;

// Start passwords and resets: 4 groups of 4 from 56 signs without look-alikes (0 O o, 1 l I), about
// 93 bits; easy to read out and to type, well above the minimum of PocketBase (8) and below its
// maximum (71, bcrypt).
var PASSWORD_ALPHABET = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
var PASSWORD_GROUPS = 4;
var PASSWORD_GROUP_LENGTH = 4;
var PASSWORD_RAW_LENGTH = PASSWORD_GROUPS * PASSWORD_GROUP_LENGTH;

// Fields of an account that no client changes through the Record API, not even its owner: the right
// and the switch come only from the routes of an administrator (or the superuser in the admin UI),
// the e-mail stays hidden from other accounts (emailVisibility, ADR-0056 §4).
var LOCKED_FIELDS = ['instance_admin', 'disabled', 'emailVisibility'];

// Texts of the 400/409 answers of the routes; the page names the problem in its own words too.
var PROBLEMS = {
  email: 'Bitte eine gültige E-Mail-Adresse eingeben.',
  'email-taken': 'Für diese E-Mail-Adresse gibt es schon ein Konto.',
  name: 'Bitte einen Namen eingeben.',
  'name-long': 'Höchstens ' + NAME_MAX + ' Zeichen.',
  format: 'Die Angabe fehlt.',
  'self-disable': 'Dein eigenes Konto kannst du nicht deaktivieren.',
  'self-admin': 'Dein eigenes Verwalter-Recht kann dir nur ein anderer Verwalter entziehen.',
  'self-password': 'Dein eigenes Passwort änderst du unter „Konto“.',
  'last-admin': 'Mindestens ein aktives Konto muss Verwalter bleiben. Gib zuerst einem anderen Konto das Recht.',
  missing: 'Dieses Konto gibt es nicht.',
  // A new owner of a household without an active owner (E7-4, ADR-0061 §6).
  'household-missing': 'Diesen Haushalt gibt es nicht mehr.',
  'owner-active': 'Der Haushalt hat einen aktiven Inhaber. Den Inhaber wechselt nur er selbst auf der Seite „Haushalt“.',
  member: 'Dieses Mitglied gibt es im Haushalt nicht mehr.',
  'member-disabled': 'Ein deaktiviertes Konto kann nicht Inhaber werden.',
  // Deleting an orphaned household (E7-4c, ADR-0061 addendum E7-4c).
  'household-not-orphaned':
    'Im Haushalt gibt es noch ein Konto. Löschen lässt sich nur ein Haushalt, in dem kein Mitglied mehr ein Konto hat.',
  'household-name': 'Bitte den Namen des Haushalts genau so eintippen, wie er hier steht.'
};

// Status of the refusals other than 400.
var STATUS_OF_PROBLEM = {
  'last-admin': 409,
  'owner-active': 409,
  'household-not-orphaned': 409,
  missing: 404,
  'household-missing': 404,
  member: 404
};

// Validation codes of the Record API (hooks of users), the same texts in web/src/lib/domain/accounts.ts.
var MESSAGES = {
  validation_account_locked: 'Das ändert nur der Verwalter der App unter „Einstellungen → Konten“.',
  validation_account_last_admin: PROBLEMS['last-admin'],
  validation_account_name: PROBLEMS.name,
  validation_account_name_max: PROBLEMS['name-long']
};

// Answer of a sign-in of a disabled account (only after the right password, so it reveals nothing).
var DISABLED_MESSAGE = 'Dieses Konto ist deaktiviert. Bitte wende dich an den Verwalter der App.';

var EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
var CONTROL = /[\u0000-\u001f\u007f]/;

function text(value) {
  return typeof value === 'string' ? value : '';
}

/** Whether an account with these flags counts as an administrator. */
function isActiveAdmin(admin, disabled) {
  return admin === true && disabled !== true;
}

/** A name as it is stored: without white space at its ends. */
function normalizeName(value) {
  return text(value).replace(/^\s+|\s+$/g, '');
}

/** '' for a valid display name, else the problem ('name' or 'name-long'). */
function nameProblem(value) {
  var name = normalizeName(value);
  if (name === '' || CONTROL.test(name)) {
    return 'name';
  }
  return name.length > NAME_MAX ? 'name-long' : '';
}

/** An e-mail address as it is stored and compared: without white space at its ends. */
function normalizeEmail(value) {
  return text(value).replace(/^\s+|\s+$/g, '');
}

function emailProblem(value) {
  var email = normalizeEmail(value);
  return email.length > EMAIL_MAX || !EMAIL.test(email) ? 'email' : '';
}

/** Body of "Konto anlegen": { email, name } or { problem }. */
function createInput(body) {
  var value = body !== null && typeof body === 'object' ? body : {};
  var problem = emailProblem(value.email) || nameProblem(value.name);
  if (problem !== '') {
    return { problem: problem };
  }
  return { email: normalizeEmail(value.email), name: normalizeName(value.name) };
}

/** Body of a switch ({ disabled } or { admin }): { value } or { problem: 'format' }. */
function switchInput(body, key) {
  var value = body !== null && typeof body === 'object' ? body[key] : undefined;
  return typeof value === 'boolean' ? { value: value } : { problem: 'format' };
}

/**
 * Body of deleting an orphaned household (E7-4c): { preview, name } or { problem: 'format' }. Both
 * fields are optional, but when given, `preview` is a boolean and `name` a string.
 */
function householdDeleteInput(body) {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    return { problem: 'format' };
  }
  if (body.preview !== undefined && typeof body.preview !== 'boolean') {
    return { problem: 'format' };
  }
  if (body.name !== undefined && typeof body.name !== 'string') {
    return { problem: 'format' };
  }
  return { preview: body.preview === true, name: text(body.name) };
}

/** A start password from PASSWORD_RAW_LENGTH random signs of the alphabet: "abcd-EFGH-2345-wxyz". */
function formatPassword(raw) {
  var signs = text(raw);
  var groups = [];
  for (var i = 0; i < signs.length; i += PASSWORD_GROUP_LENGTH) {
    groups.push(signs.slice(i, i + PASSWORD_GROUP_LENGTH));
  }
  return groups.join('-');
}

/**
 * Whether a change takes the last active administrator away: the account was one, is none after the
 * change, and no other account is one.
 */
function takesLastAdmin(before, after, othersActive) {
  return (
    isActiveAdmin(before.admin, before.disabled) &&
    !isActiveAdmin(after.admin, after.disabled) &&
    othersActive === 0
  );
}

/**
 * The problem of a change of `target` by the administrator `self` through the page, or '':
 * `action` is 'disable', 'admin' or 'password', `value` the new state of the switch.
 */
function selfProblem(action, isSelf, value) {
  if (!isSelf) {
    return '';
  }
  if (action === 'disable' && value === true) {
    return 'self-disable';
  }
  if (action === 'admin' && value === false) {
    return 'self-admin';
  }
  return action === 'password' ? 'self-password' : '';
}

/** The first locked field a client request changes, or ''. `before`/`after` map names to values. */
function lockedChange(before, after) {
  for (var i = 0; i < LOCKED_FIELDS.length; i++) {
    var field = LOCKED_FIELDS[i];
    if ((before[field] === true) !== (after[field] === true)) {
      return field;
    }
  }
  return '';
}

/** One line of the list of the page: never the password, the e-mail only for the administrator. */
function accountView(values, selfId) {
  return {
    id: text(values.id),
    name: text(values.name),
    email: text(values.email),
    admin: values.admin === true,
    disabled: values.disabled === true,
    created: text(values.created),
    self: text(values.id) === text(selfId)
  };
}

/**
 * Answer of a refused input of the routes: 404 for an unknown account, household or member, 409 for
 * the last administrator, a household with an active owner and one that is not orphaned, else 400.
 */
function problemBody(problem) {
  var known = Object.prototype.hasOwnProperty.call(PROBLEMS, problem) ? problem : 'format';
  var status = STATUS_OF_PROBLEM[known] || 400;
  return {
    status: status,
    body: { status: status, message: PROBLEMS[known], reason: 'invalid', problem: known }
  };
}

module.exports = {
  NAME_MAX: NAME_MAX,
  EMAIL_MAX: EMAIL_MAX,
  PASSWORD_ALPHABET: PASSWORD_ALPHABET,
  PASSWORD_RAW_LENGTH: PASSWORD_RAW_LENGTH,
  LOCKED_FIELDS: LOCKED_FIELDS,
  PROBLEMS: PROBLEMS,
  MESSAGES: MESSAGES,
  DISABLED_MESSAGE: DISABLED_MESSAGE,
  isActiveAdmin: isActiveAdmin,
  normalizeName: normalizeName,
  nameProblem: nameProblem,
  normalizeEmail: normalizeEmail,
  emailProblem: emailProblem,
  createInput: createInput,
  switchInput: switchInput,
  householdDeleteInput: householdDeleteInput,
  formatPassword: formatPassword,
  takesLastAdmin: takesLastAdmin,
  selfProblem: selfProblem,
  lockedChange: lockedChange,
  accountView: accountView,
  problemBody: problemBody
};
