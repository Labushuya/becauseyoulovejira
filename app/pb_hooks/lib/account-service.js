// Accounts and the administrator of the app (ADR-0056, E7-1). CommonJS module, ES5 only, Goja
// runtime only; the rules are pure in lib/account-rules.js.
//
// - isInstanceAdmin: the one check of the right "Verwalter der App" (pages System, Sicherung,
//   Speicher, Sicherheit and Konten through check of lib/system-service.js, channels with access
//   data). Before the migration 1790203700 the account created first counts, as before (ADR-0043 §3).
// - Hooks of users: the first account becomes administrator when there is none, one active
//   administrator always stays, disabling ends the sessions (new token key), a disabled account
//   cannot sign in, and no client changes the right, the switch or the visibility of its e-mail.
// - Routes of the page "Einstellungen → Konten": list, create with a start password, reset the
//   password, disable and enable, give and take the right. They check like the page "Speicher"
//   (signed in, this machine, the address of the app, an administrator, rate limit) and log every
//   action and refusal without e-mail addresses and passwords.
'use strict';

var rules = require(__hooks + '/lib/account-rules.js');
var errors = require(__hooks + '/lib/errors.js');

var USERS = 'users';
var AREA = 'byl-accounts';
var UNAVAILABLE = 'Die Konten stehen nach dem nächsten Neustart der App bereit (neu-starten.bat).';
var READ = { local: true, anyPlatform: true, kind: 'read' };
var CHANGE = { local: true, anyPlatform: true, kind: 'change' };

function system() {
  return require(__hooks + '/lib/system-service.js');
}

/** Whether users has the fields of the migration 1790203700. */
function hasAdminField(app) {
  try {
    return !!app.findCollectionByNameOrId(USERS).fields.getByName('instance_admin');
  } catch (err) {
    return false;
  }
}

/** The app account created first (smallest created, then smallest ID): the owner before E7. */
function firstAccountId(app) {
  var found = app.findRecordsByFilter(USERS, 'id != ""', 'created,id', 1, 0);
  return found.length > 0 ? String(found[0].id) : '';
}

function findUser(app, id) {
  if (typeof id !== 'string' || id === '') {
    return null;
  }
  try {
    return app.findRecordById(USERS, id);
  } catch (err) {
    return null;
  }
}

/**
 * Whether the app account `userId` is an active administrator of the app. Before the migration the
 * account created first counts (the rule of ADR-0043 §3).
 */
function isInstanceAdmin(app, userId) {
  if (typeof userId !== 'string' || userId === '') {
    return false;
  }
  if (!hasAdminField(app)) {
    return userId === firstAccountId(app);
  }
  var record = findUser(app, userId);
  return record !== null && rules.isActiveAdmin(record.getBool('instance_admin'), record.getBool('disabled'));
}

/** Number of active administrators other than `id`. */
function otherActiveAdmins(app, id) {
  return app.countRecords(
    USERS,
    $dbx.hashExp({ instance_admin: true, disabled: false }),
    $dbx.not($dbx.hashExp({ id: String(id || '') }))
  );
}

function flagsOf(record) {
  return { admin: record.getBool('instance_admin'), disabled: record.getBool('disabled') };
}

// --- Hooks of users ----------------------------------------------------------------------------------

/**
 * onRecordCreate of users (every way, also the admin UI): without an active administrator the new
 * account becomes one, so the first account of a new installation manages it (ADR-0002, ADR-0056).
 */
function bootstrapAdmin(e) {
  if (!hasAdminField(e.app) || e.record.getBool('instance_admin') || e.record.getBool('disabled')) {
    return;
  }
  if (otherActiveAdmins(e.app, e.record.id) === 0) {
    e.record.set('instance_admin', true);
  }
}

/**
 * onRecordUpdate of users (every way, also the admin UI): no change takes the last active
 * administrator away; disabling renews the token key, so every session of the account ends (also its
 * realtime connection, PocketBase drops the auth of clients with an old key).
 */
function keepAnAdmin(e) {
  if (!hasAdminField(e.app)) {
    return;
  }
  var before = flagsOf(e.record.original());
  var after = flagsOf(e.record);
  if (rules.takesLastAdmin(before, after, otherActiveAdmins(e.app, e.record.id))) {
    var field = before.admin !== after.admin ? 'instance_admin' : 'disabled';
    throw errors.fieldFailure(field, 'validation_account_last_admin', rules.MESSAGES.validation_account_last_admin);
  }
  if (!before.disabled && after.disabled) {
    e.record.refreshTokenKey();
  }
}

/**
 * onRecordDelete of users (only the superuser deletes accounts, in the admin UI): the last active
 * administrator goes only together with the last account.
 */
function keepAdminOnDelete(e) {
  if (!hasAdminField(e.app) || !rules.isActiveAdmin(e.record.getBool('instance_admin'), e.record.getBool('disabled'))) {
    return;
  }
  if (otherActiveAdmins(e.app, e.record.id) > 0) {
    return;
  }
  if (e.app.countRecords(USERS, $dbx.not($dbx.hashExp({ id: String(e.record.id) }))) > 0) {
    throw errors.fieldFailure('instance_admin', 'validation_account_last_admin', rules.MESSAGES.validation_account_last_admin);
  }
}

/**
 * onRecordUpdateRequest of users for an app account (its own record, the update rule): the right,
 * the switch and the visibility of the e-mail stay; a new name must be valid and is stored trimmed.
 * The superuser stays free (admin UI).
 */
function guardClientUpdate(e) {
  if (e.hasSuperuserAuth() || !hasAdminField(e.app)) {
    return;
  }
  var original = e.record.original();
  var before = {};
  var after = {};
  for (var i = 0; i < rules.LOCKED_FIELDS.length; i++) {
    var name = rules.LOCKED_FIELDS[i];
    before[name] = original.getBool(name);
    after[name] = e.record.getBool(name);
  }
  var locked = rules.lockedChange(before, after);
  if (locked !== '') {
    throw errors.fieldFailure(locked, 'validation_account_locked', rules.MESSAGES.validation_account_locked);
  }
  var newName = e.record.getString('name');
  if (newName === original.getString('name')) {
    return;
  }
  var problem = rules.nameProblem(newName);
  if (problem !== '') {
    var code = problem === 'name-long' ? 'validation_account_name_max' : 'validation_account_name';
    throw errors.fieldFailure('name', code, rules.MESSAGES[code]);
  }
  e.record.set('name', rules.normalizeName(newName));
}

/** onRecordAuthRequest of users: a disabled account does not sign in (after the right password). */
function guardSignIn(e) {
  if (e.record && hasAdminField(e.app) && e.record.getBool('disabled')) {
    throw new ForbiddenError(rules.DISABLED_MESSAGE);
  }
}

// --- Routes of the page "Einstellungen → Konten" --------------------------------------------------

function refuse(e, name, context) {
  system().refuse(e, name, context.refused, context.retryAfterSeconds, AREA);
}

function problem(e, name, which) {
  e.app.logger().warn(AREA + ': Eingabe abgelehnt', 'action', name, 'problem', which, 'user', system().userOf(e));
  var answer = rules.problemBody(which);
  e.json(answer.status, answer.body);
}

function audit(e, action, accountId) {
  e.app.logger().info(AREA + ': Aktion ausgeführt', 'action', action, 'user', system().userOf(e), 'account', String(accountId));
}

/** The checks of every route; true when it refused (the answer is written), false to go on. */
function refused(e, name, method, options) {
  var context = system().check(e, name, method, options);
  if (context.refused) {
    refuse(e, name, context);
    return true;
  }
  if (!hasAdminField(e.app)) {
    e.json(503, { status: 503, message: UNAVAILABLE, reason: 'missing' });
    return true;
  }
  return false;
}

function viewOf(record, selfId) {
  return rules.accountView(
    {
      id: record.id,
      name: record.getString('name'),
      email: record.getString('email'),
      admin: record.getBool('instance_admin'),
      disabled: record.getBool('disabled'),
      created: record.getString('created')
    },
    selfId
  );
}

function newPassword() {
  return rules.formatPassword($security.randomStringWithAlphabet(rules.PASSWORD_RAW_LENGTH, rules.PASSWORD_ALPHABET));
}

/** The minimum length of a password of users (PocketBase: 8). */
function passwordMin(app) {
  try {
    var field = app.findCollectionByNameOrId(USERS).fields.getByName('password');
    return field && Number(field.min) > 0 ? Number(field.min) : 8;
  } catch (err) {
    return 8;
  }
}

function emailTaken(app, email) {
  var result = new DynamicModel({ n: 0 });
  app.db().newQuery('SELECT COUNT(*) AS n FROM users WHERE LOWER(email) = LOWER({:email})').bind({ email: email }).one(result);
  return Number(result.n) > 0;
}

/** Answer with a password: never cached by the browser, shown once by the page. */
function withPassword(e, status, body) {
  e.response.header().set('Cache-Control', 'no-store');
  e.json(status, body);
}

var MEMBERS = 'household_members';
var HOUSEHOLDS = 'households';

/**
 * The households as the page "Konten" needs them (E7-4, ADR-0060 §6): which account owns which
 * household (`owns`, by account ID, for the hint before disabling an owner), and the households
 * without an active owner (owner disabled, or deleted in the admin UI) with their other members.
 */
function householdsOf(app) {
  var memberships = app.findRecordsByFilter(MEMBERS, 'id != ""', 'created,id', 0, 0);
  var byHousehold = {};
  for (var i = 0; i < memberships.length; i++) {
    var householdId = memberships[i].getString('household');
    (byHousehold[householdId] = byHousehold[householdId] || []).push(memberships[i]);
  }
  var owns = {};
  var orphaned = [];
  var households = app.findRecordsByFilter(HOUSEHOLDS, 'id != ""', 'created,id', 0, 0);
  for (var h = 0; h < households.length; h++) {
    var household = households[h];
    var rows = byHousehold[household.id] || [];
    var owner = null;
    var members = [];
    for (var m = 0; m < rows.length; m++) {
      var user = findUser(app, rows[m].getString('user'));
      if (user === null) {
        continue;
      }
      if (rows[m].getString('role') === 'owner') {
        owner = user;
      } else {
        members.push({ id: rows[m].id, user: user.id, name: user.getString('name'), disabled: user.getBool('disabled') });
      }
    }
    var view = { id: household.id, name: household.getString('name') };
    if (owner !== null) {
      owns[owner.id] = view;
    }
    if (owner === null || owner.getBool('disabled')) {
      orphaned.push({
        id: household.id,
        name: household.getString('name'),
        owner: owner === null ? null : { id: owner.id, name: owner.getString('name') },
        members: members
      });
    }
  }
  return { owns: owns, orphaned: orphaned };
}

/** The answer of the list: every account (with the household it owns), and the households without an active owner. */
function listAnswer(e) {
  var selfId = system().userOf(e);
  var found = e.app.findRecordsByFilter(USERS, 'id != ""', 'created,id', 0, 0);
  var households = householdsOf(e.app);
  var accounts = [];
  for (var i = 0; i < found.length; i++) {
    var account = viewOf(found[i], selfId);
    account.owns = households.owns[found[i].id] || null;
    accounts.push(account);
  }
  return { accounts: accounts, passwordMin: passwordMin(e.app), households: households.orphaned };
}

/** GET /api/byl/accounts: every account with name, e-mail, right, switch and creation. */
function list(e) {
  if (refused(e, 'accounts', 'GET', READ)) {
    return;
  }
  e.json(200, listAnswer(e));
}

/**
 * POST /api/byl/accounts/households/{id}/owner { member } (E7-4, ADR-0060 §6): the administrator of
 * the app makes an active member the owner of a household whose owner is disabled or gone. The old
 * owner stays a member with every right set, like handing the household on (ADR-0058 §4). Answers the
 * list; the tabs of the members read their household again.
 */
function setHouseholdOwner(e) {
  var name = 'accounts-household-owner';
  if (refused(e, name, 'POST', CHANGE)) {
    return;
  }
  var body = e.requestInfo().body;
  var memberId = body !== null && typeof body === 'object' && typeof body.member === 'string' ? body.member : '';
  if (memberId === '') {
    problem(e, name, 'format');
    return;
  }
  var householdId = String(e.request.pathValue('id') || '');
  var outcome = { problem: '', notify: [] };
  e.app.runInTransaction(function (txApp) {
    var found = txApp.findRecordsByFilter(HOUSEHOLDS, 'id = {:id}', '', 1, 0, { id: householdId });
    if (found.length === 0) {
      outcome.problem = 'household-missing';
      return;
    }
    var rows = txApp.findRecordsByFilter(MEMBERS, 'household = {:h}', 'created,id', 0, 0, { h: householdId });
    var owner = null;
    var target = null;
    for (var i = 0; i < rows.length; i++) {
      if (rows[i].getString('role') === 'owner') {
        owner = rows[i];
      } else if (rows[i].id === memberId) {
        target = rows[i];
      }
      outcome.notify.push(rows[i].getString('user'));
    }
    var ownerUser = owner === null ? null : findUser(txApp, owner.getString('user'));
    if (ownerUser !== null && !ownerUser.getBool('disabled')) {
      outcome.problem = 'owner-active';
      return;
    }
    if (target === null) {
      outcome.problem = 'member';
      return;
    }
    var targetUser = findUser(txApp, target.getString('user'));
    if (targetUser === null || targetUser.getBool('disabled')) {
      outcome.problem = 'member-disabled';
      return;
    }
    if (owner !== null) {
      owner.set('role', 'member');
      owner.set('rights', require(__hooks + '/lib/household-rules.js').RIGHTS.slice());
      txApp.save(owner);
    }
    target.set('role', 'owner');
    target.set('rights', []);
    txApp.save(target);
  });
  if (outcome.problem !== '') {
    problem(e, name, outcome.problem);
    return;
  }
  require(__hooks + '/lib/household-service.js').notify(e.app, outcome.notify);
  audit(e, 'household-owner', householdId);
  e.json(200, listAnswer(e));
}

/** POST /api/byl/accounts { email, name }: a new account with a start password, shown once. */
function create(e) {
  var name = 'accounts-create';
  if (refused(e, name, 'POST', CHANGE)) {
    return;
  }
  var input = rules.createInput(e.requestInfo().body);
  if (input.problem) {
    problem(e, name, input.problem);
    return;
  }
  if (emailTaken(e.app, input.email)) {
    problem(e, name, 'email-taken');
    return;
  }
  var password = newPassword();
  var record = new Record(e.app.findCollectionByNameOrId(USERS));
  record.set('email', input.email);
  record.set('name', input.name);
  record.setEmailVisibility(false);
  record.setPassword(password);
  try {
    e.app.save(record);
  } catch (err) {
    // A second request with the same address in the meantime (unique index), or PocketBase refused
    // the address.
    problem(e, name, emailTaken(e.app, input.email) ? 'email-taken' : 'email');
    return;
  }
  audit(e, 'create', record.id);
  withPassword(e, 201, { account: viewOf(record, system().userOf(e)), password: password });
}

// The changes of one account through the page: the route, the switch of the body ('' for none),
// what the audit calls it and what it does to the record.
var CHANGES = {
  password: {
    route: 'accounts-password',
    key: '',
    audit: function () {
      return 'password';
    },
    apply: function (record, value, password) {
      // A new password renews the token key in PocketBase, so old tokens stop working.
      record.setPassword(password);
    }
  },
  disable: {
    route: 'accounts-disable',
    key: 'disabled',
    audit: function (value) {
      return value ? 'disable' : 'enable';
    },
    apply: function (record, value) {
      record.set('disabled', value);
    }
  },
  admin: {
    route: 'accounts-admin',
    key: 'admin',
    audit: function (value) {
      return value ? 'admin-on' : 'admin-off';
    },
    apply: function (record, value) {
      record.set('instance_admin', value);
    }
  }
};

/**
 * Changes the account of the address in one transaction, in which the hooks of users count the
 * administrators as well. Writes the answer and returns the saved record, or null after a refusal.
 */
function changeAccount(e, action, password) {
  var spec = CHANGES[action];
  if (refused(e, spec.route, 'POST', CHANGE)) {
    return null;
  }
  var value = true;
  if (spec.key !== '') {
    var input = rules.switchInput(e.requestInfo().body, spec.key);
    if (input.problem) {
      problem(e, spec.route, input.problem);
      return null;
    }
    value = input.value;
  }
  var id = String(e.request.pathValue('id') || '');
  var selfProblem = rules.selfProblem(action, id === system().userOf(e), value);
  if (selfProblem !== '') {
    problem(e, spec.route, selfProblem);
    return null;
  }
  var outcome = { problem: '', record: null };
  e.app.runInTransaction(function (txApp) {
    var record = findUser(txApp, id);
    if (record === null) {
      outcome.problem = 'missing';
      return;
    }
    var before = flagsOf(record);
    spec.apply(record, value, password);
    if (rules.takesLastAdmin(before, flagsOf(record), otherActiveAdmins(txApp, record.id))) {
      outcome.problem = 'last-admin';
      return;
    }
    txApp.save(record);
    outcome.record = record;
  });
  if (outcome.problem !== '') {
    problem(e, spec.route, outcome.problem);
    return null;
  }
  audit(e, spec.audit(value), id);
  return outcome.record;
}

/** POST /api/byl/accounts/{id}/password: a new password, shown once; every session of the account ends. */
function resetPassword(e) {
  var password = newPassword();
  var record = changeAccount(e, 'password', password);
  if (record !== null) {
    withPassword(e, 200, { account: viewOf(record, system().userOf(e)), password: password });
  }
}

/** POST /api/byl/accounts/{id}/disabled { disabled }: disable (its sessions end) or enable. */
function setDisabled(e) {
  var record = changeAccount(e, 'disable', '');
  if (record !== null) {
    e.json(200, { account: viewOf(record, system().userOf(e)) });
  }
}

/** POST /api/byl/accounts/{id}/admin { admin }: give or take the right "Verwalter der App". */
function setAdmin(e) {
  var record = changeAccount(e, 'admin', '');
  if (record !== null) {
    e.json(200, { account: viewOf(record, system().userOf(e)) });
  }
}

module.exports = {
  hasAdminField: hasAdminField,
  firstAccountId: firstAccountId,
  isInstanceAdmin: isInstanceAdmin,
  bootstrapAdmin: bootstrapAdmin,
  keepAnAdmin: keepAnAdmin,
  keepAdminOnDelete: keepAdminOnDelete,
  guardClientUpdate: guardClientUpdate,
  guardSignIn: guardSignIn,
  list: list,
  create: create,
  resetPassword: resetPassword,
  setDisabled: setDisabled,
  setAdmin: setAdmin,
  setHouseholdOwner: setHouseholdOwner
};
