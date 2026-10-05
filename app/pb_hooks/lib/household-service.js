// Managing a household (ADR-0058, E7-2): found it, rename it, invitation codes, join with a code,
// rights of the members, hand the household to another member, remove a member, leave. CommonJS
// module, ES5 only, Goja runtime only; the rules are pure in lib/household-rules.js.
//
// - Every route acts on the household of the signed-in account (at most one per account for now,
//   the data model stays N:M) and works on every device, also in the home network: nothing here
//   acts on the machine of the app.
// - Every change runs in one transaction with every check before the first write. Writing through
//   the Record API stays locked (all write rules of households, household_members and
//   household_invites are null).
// - After the commit the topic byl/household (no data) goes to the open tabs of every account whose
//   membership or household changed; the page reads the household again, and a tab that lost or
//   gained the membership loads anew (the API rules hide the household records at once).
// - Invitation codes are never stored, logged or answered twice: only their SHA-256 is kept, and
//   only the answer of "Code erzeugen" carries the code, with Cache-Control: no-store.
'use strict';

var rules = require(__hooks + '/lib/household-rules.js');

var HOUSEHOLDS = 'households';
var MEMBERS = 'household_members';
var INVITES = 'household_invites';
var USERS = 'users';
var TOPIC = 'byl/household';
var AREA = 'byl-household';
// Transient key of the account behind a membership that ends (the same as in lib/ticket-service.js);
// the hook of assignees.pb.js names it in the history of the tickets it clears (ADR-0068 §6).
var ACTOR_KEY = '@actor';
var UNAVAILABLE = 'Der Haushalt steht nach dem nächsten Neustart der App bereit (neu-starten.bat).';
// Attempts at a fresh code whose hash is taken (31^8 codes: practically never more than one).
var CODE_ATTEMPTS = 5;

function userOf(e) {
  return e.auth ? String(e.auth.id) : '';
}

/** Whether the migration 1790203800 ran (household_invites and household_members.rights exist). */
function ready(app) {
  try {
    app.findCollectionByNameOrId(INVITES);
    return !!app.findCollectionByNameOrId(MEMBERS).fields.getByName('rights');
  } catch (err) {
    return false;
  }
}

function listOf(found) {
  var list = [];
  for (var i = 0; i < found.length; i++) {
    list.push(found[i]);
  }
  return list;
}

function stringsOf(slice) {
  var list = [];
  if (slice) {
    for (var i = 0; i < slice.length; i++) {
      list.push(String(slice[i]));
    }
  }
  return list;
}

/** The membership as the rules see it: { id, role, rights, user, household }. */
function plain(record) {
  return {
    id: record.id,
    role: record.getString('role'),
    rights: stringsOf(record.getStringSlice('rights')),
    user: record.getString('user'),
    household: record.getString('household')
  };
}

/** The membership of `userId` (the oldest one, should the admin UI have added more), or null. */
function membershipOf(app, userId) {
  var found = app.findRecordsByFilter(MEMBERS, 'user = {:user}', 'created,id', 1, 0, { user: userId });
  return found.length > 0 ? found[0] : null;
}

function membersOf(app, householdId) {
  return listOf(app.findRecordsByFilter(MEMBERS, 'household = {:household}', 'created,id', 0, 0, { household: householdId }));
}

function memberIn(app, householdId, memberId) {
  if (typeof memberId !== 'string' || memberId === '') {
    return null;
  }
  var found = app.findRecordsByFilter(MEMBERS, 'id = {:id} && household = {:household}', '', 1, 0, {
    id: memberId,
    household: householdId
  });
  return found.length > 0 ? found[0] : null;
}

function invitesOf(app, householdId) {
  return listOf(app.findRecordsByFilter(INVITES, 'household = {:household}', '-created,id', 0, 0, { household: householdId }));
}

function inviteFields(record) {
  return {
    id: record.id,
    created: record.getString('created'),
    created_by: record.getString('created_by'),
    expires_at: record.getString('expires_at'),
    used_at: record.getString('used_at'),
    used_by: record.getString('used_by'),
    revoked_at: record.getString('revoked_at')
  };
}

/** Display names of the members (never an e-mail address), by user ID. */
function namesOf(app, members) {
  var names = {};
  for (var i = 0; i < members.length; i++) {
    var id = members[i].getString('user');
    try {
      names[id] = app.findRecordById(USERS, id).getString('name');
    } catch (err) {
      names[id] = '';
    }
  }
  return names;
}

/** The answer of GET /api/byl/household for `userId` at `now`: the household, the members and, with "invite", the codes. */
function stateFor(app, userId, now) {
  var own = membershipOf(app, userId);
  if (own === null) {
    return { household: null };
  }
  var householdId = own.getString('household');
  var household = app.findRecordById(HOUSEHOLDS, householdId);
  var members = membersOf(app, householdId);
  var names = namesOf(app, members);
  // The owner first, then the members in the order they joined.
  var owners = [];
  var others = [];
  for (var i = 0; i < members.length; i++) {
    var member = plain(members[i]);
    member.name = names[member.user] || '';
    var memberView = rules.memberView(member, own.id);
    (memberView.role === rules.OWNER ? owners : others).push(memberView);
  }
  var memberViews = owners.concat(others);
  var me = plain(own);
  var invites = null;
  if (rules.may(me, 'invite')) {
    invites = [];
    var found = invitesOf(app, householdId);
    for (var j = 0; j < found.length; j++) {
      var fields = inviteFields(found[j]);
      if (rules.isListed(fields, now)) {
        invites.push(rules.inviteView(fields, now, names));
      }
    }
  }
  return {
    household: {
      id: household.id,
      name: household.getString('name'),
      created: household.getString('created'),
      // Retention of its trash (E7-3); '' for the default of 30 days, also before the migration.
      trash_retention: rules.retentionOf(household.getString('trash_retention'))
    },
    me: { member: own.id, role: me.role === rules.OWNER ? rules.OWNER : rules.MEMBER, rights: rules.effectiveRights(me.role, me.rights) },
    members: memberViews,
    invites: invites
  };
}

// --- Realtime ---------------------------------------------------------------------------------------

/**
 * After the commit: the topic byl/household to the open tabs of these accounts. Never throws. The
 * message carries no data, except `{ dissolved: true }` when the household was dissolved (E7-4), so a
 * tab can say so instead of "nicht mehr Mitglied".
 */
function notify(app, userIds, data) {
  if (userIds.length === 0) {
    return;
  }
  try {
    var clients = app.subscriptionsBroker().clients();
    var message = new SubscriptionMessage({ name: TOPIC, data: JSON.stringify(data || {}) });
    for (var id in clients) {
      var client = clients[id];
      if (!client || client.isDiscarded() || !client.hasSubscription(TOPIC)) {
        continue;
      }
      var auth = client.get('auth');
      if (!auth || auth.collection().name !== USERS || userIds.indexOf(String(auth.id)) === -1) {
        continue;
      }
      client.send(message);
    }
  } catch (err) {
    app.logger().warn(AREA + ': Hinweis an offene Tabs nicht gesendet', 'error', String(err));
  }
}

function userIdsOf(members) {
  var ids = [];
  for (var i = 0; i < members.length; i++) {
    var id = members[i].getString('user');
    if (ids.indexOf(id) === -1) {
      ids.push(id);
    }
  }
  return ids;
}

function withUser(ids, userId) {
  return ids.indexOf(userId) === -1 ? ids.concat([userId]) : ids;
}

// --- Answers ------------------------------------------------------------------------------------------

function refuse(e, action, problem) {
  e.app.logger().warn(AREA + ': Anfrage abgelehnt', 'action', action, 'problem', problem, 'user', userOf(e));
  var answer = rules.problemBody(problem);
  return e.json(answer.status, answer.body);
}

function audit(e, action, householdId, memberId) {
  e.app
    .logger()
    .info(AREA + ': Aktion ausgeführt', 'action', action, 'user', userOf(e), 'household', String(householdId), 'member', String(memberId || ''));
}

/** 503 before the migration; true when the answer is written. */
function unavailable(e) {
  if (ready(e.app)) {
    return false;
  }
  e.json(503, { status: 503, message: UNAVAILABLE, reason: 'missing' });
  return true;
}

function answerState(e, status) {
  e.response.header().set('Cache-Control', 'no-store');
  return e.json(status, stateFor(e.app, userOf(e), Date.now()));
}

function bodyOf(e) {
  return e.requestInfo().body;
}

/**
 * Runs `change(txApp, outcome)` in one transaction. `change` checks first and sets outcome.problem
 * to refuse (nothing is written then), else it writes and names the accounts to tell in
 * outcome.notify. Writes the answer: the problem, or the new state with `status`.
 */
function run(e, action, status, change) {
  var outcome = { problem: '', notify: [], household: '', member: '' };
  e.app.runInTransaction(function (txApp) {
    change(txApp, outcome);
  });
  if (outcome.problem !== '') {
    return refuse(e, action, outcome.problem);
  }
  audit(e, action, outcome.household, outcome.member);
  notify(e.app, outcome.notify);
  return answerState(e, status);
}

/** The membership of the signed-in account in the transaction, or the problem 'no-household'. */
function actorIn(txApp, e, outcome) {
  var own = membershipOf(txApp, userOf(e));
  if (own === null) {
    outcome.problem = 'no-household';
    return null;
  }
  outcome.household = own.getString('household');
  return own;
}

// --- Routes -------------------------------------------------------------------------------------------

/** GET /api/byl/household: the household of the account, or { household: null }. */
function view(e) {
  if (unavailable(e)) {
    return;
  }
  return answerState(e, 200);
}

/** POST /api/byl/household { name }: founds a household; the account becomes its owner. */
function create(e) {
  if (unavailable(e)) {
    return;
  }
  var input = rules.nameInput(bodyOf(e));
  if (input.problem) {
    return refuse(e, 'create', input.problem);
  }
  return run(e, 'create', 201, function (txApp, outcome) {
    if (membershipOf(txApp, userOf(e)) !== null) {
      outcome.problem = 'already-member';
      return;
    }
    var household = new Record(txApp.findCollectionByNameOrId(HOUSEHOLDS));
    household.set('name', input.name);
    txApp.save(household);
    var member = new Record(txApp.findCollectionByNameOrId(MEMBERS));
    member.set('household', household.id);
    member.set('user', userOf(e));
    member.set('role', rules.OWNER);
    member.set('rights', []);
    txApp.save(member);
    outcome.household = household.id;
    outcome.member = member.id;
    outcome.notify = [userOf(e)];
  });
}

/** POST /api/byl/household/rename { name }: with the right "rename". */
function rename(e) {
  if (unavailable(e)) {
    return;
  }
  var input = rules.nameInput(bodyOf(e));
  if (input.problem) {
    return refuse(e, 'rename', input.problem);
  }
  return run(e, 'rename', 200, function (txApp, outcome) {
    var own = actorIn(txApp, e, outcome);
    if (own === null) {
      return;
    }
    if (!rules.may(plain(own), 'rename')) {
      outcome.problem = 'right';
      return;
    }
    var household = txApp.findRecordById(HOUSEHOLDS, outcome.household);
    household.set('name', input.name);
    txApp.save(household);
    outcome.notify = userIdsOf(membersOf(txApp, outcome.household));
  });
}

/**
 * POST /api/byl/household/invites: a new code with the right "invite", valid for 7 days and once.
 * The answer carries the code, once, next to the new state; long ended codes of the household go.
 */
function createInvite(e) {
  if (unavailable(e)) {
    return;
  }
  var code = '';
  var inviteId = '';
  var outcome = { problem: '', notify: [], household: '', member: '' };
  var now = Date.now();
  e.app.runInTransaction(function (txApp) {
    var own = actorIn(txApp, e, outcome);
    if (own === null) {
      return;
    }
    if (!rules.may(plain(own), 'invite')) {
      outcome.problem = 'right';
      return;
    }
    var found = invitesOf(txApp, outcome.household);
    var open = 0;
    for (var i = 0; i < found.length; i++) {
      var fields = inviteFields(found[i]);
      if (rules.inviteStatus(fields, now) === 'open') {
        open += 1;
      }
    }
    if (open >= rules.OPEN_INVITES_MAX) {
      outcome.problem = 'invites-full';
      return;
    }
    for (var s = 0; s < found.length; s++) {
      if (rules.isStale(inviteFields(found[s]), now)) {
        txApp.delete(found[s]);
      }
    }
    var collection = txApp.findCollectionByNameOrId(INVITES);
    for (var attempt = 0; attempt < CODE_ATTEMPTS && code === ''; attempt++) {
      var candidate = $security.randomStringWithAlphabet(rules.CODE_LENGTH, rules.CODE_ALPHABET);
      var hash = $security.sha256(candidate);
      if (txApp.findRecordsByFilter(INVITES, 'code_hash = {:hash}', '', 1, 0, { hash: hash }).length > 0) {
        continue;
      }
      var invite = new Record(collection);
      invite.set('household', outcome.household);
      invite.set('code_hash', hash);
      invite.set('created_by', userOf(e));
      invite.set('expires_at', rules.toDate(now + rules.INVITE_VALID_MS));
      txApp.save(invite);
      code = candidate;
      inviteId = invite.id;
    }
    if (code === '') {
      throw new Error('Kein freier Code gefunden.');
    }
    outcome.notify = userIdsOf(membersOf(txApp, outcome.household));
  });
  if (outcome.problem !== '') {
    return refuse(e, 'invite-create', outcome.problem);
  }
  audit(e, 'invite-create', outcome.household, '');
  notify(e.app, outcome.notify);
  var state = stateFor(e.app, userOf(e), Date.now());
  e.response.header().set('Cache-Control', 'no-store');
  return e.json(201, { code: rules.formatCode(code), invite: inviteId, state: state });
}

/** POST /api/byl/household/invites/{id}/revoke: ends an open code, with the right "invite". */
function revokeInvite(e) {
  if (unavailable(e)) {
    return;
  }
  var id = String(e.request.pathValue('id') || '');
  return run(e, 'invite-revoke', 200, function (txApp, outcome) {
    var own = actorIn(txApp, e, outcome);
    if (own === null) {
      return;
    }
    if (!rules.may(plain(own), 'invite')) {
      outcome.problem = 'right';
      return;
    }
    var found = txApp.findRecordsByFilter(INVITES, 'id = {:id} && household = {:household}', '', 1, 0, {
      id: id,
      household: outcome.household
    });
    if (found.length === 0) {
      outcome.problem = 'invite';
      return;
    }
    var now = Date.now();
    if (rules.inviteStatus(inviteFields(found[0]), now) !== 'open') {
      outcome.problem = 'invite-closed';
      return;
    }
    found[0].set('revoked_at', rules.toDate(now));
    txApp.save(found[0]);
    outcome.notify = userIdsOf(membersOf(txApp, outcome.household));
  });
}

/**
 * POST /api/byl/household/join { code }: joins the household of an open code as a member without
 * rights and uses the code up. An unknown, expired, used or revoked code gets one neutral answer
 * (400 "code"); the route is limited by the rate limiter (5 per 300 s, ADR-0058 §3). The code never
 * reaches the log.
 */
function join(e) {
  if (unavailable(e)) {
    return;
  }
  var input = rules.codeInput(bodyOf(e));
  return run(e, 'join', 200, function (txApp, outcome) {
    // An account in a household is told so first; that says nothing about any code.
    if (membershipOf(txApp, userOf(e)) !== null) {
      outcome.problem = 'already-member';
      return;
    }
    if (input.problem) {
      outcome.problem = 'code';
      return;
    }
    var now = Date.now();
    var found = txApp.findRecordsByFilter(INVITES, 'code_hash = {:hash}', '', 1, 0, { hash: $security.sha256(input.code) });
    if (found.length === 0 || rules.inviteStatus(inviteFields(found[0]), now) !== 'open') {
      outcome.problem = 'code';
      return;
    }
    var invite = found[0];
    outcome.household = invite.getString('household');
    var member = new Record(txApp.findCollectionByNameOrId(MEMBERS));
    member.set('household', outcome.household);
    member.set('user', userOf(e));
    member.set('role', rules.MEMBER);
    member.set('rights', []);
    txApp.save(member);
    invite.set('used_at', rules.toDate(now));
    invite.set('used_by', userOf(e));
    txApp.save(invite);
    outcome.member = member.id;
    outcome.notify = userIdsOf(membersOf(txApp, outcome.household));
  });
}

/** The target membership of the address in the household of the actor, or the problem 'member'. */
function targetIn(txApp, e, outcome) {
  var target = memberIn(txApp, outcome.household, String(e.request.pathValue('id') || ''));
  if (target === null) {
    outcome.problem = 'member';
    return null;
  }
  outcome.member = target.id;
  return target;
}

/**
 * POST /api/byl/household/members/{id}/rights { rights }: the new rights of a member, with
 * "delegate"; only rights the actor holds change, never at the owner or oneself.
 */
function setRights(e) {
  if (unavailable(e)) {
    return;
  }
  var input = rules.rightsInput(bodyOf(e));
  if (input.problem) {
    return refuse(e, 'rights', input.problem);
  }
  return run(e, 'rights', 200, function (txApp, outcome) {
    var own = actorIn(txApp, e, outcome);
    if (own === null) {
      return;
    }
    var target = targetIn(txApp, e, outcome);
    if (target === null) {
      return;
    }
    var problem = rules.rightsProblem(plain(own), plain(target), input.rights);
    if (problem !== '') {
      outcome.problem = problem;
      return;
    }
    target.set('rights', input.rights);
    txApp.save(target);
    outcome.notify = userIdsOf(membersOf(txApp, outcome.household));
  });
}

/** POST /api/byl/household/members/{id}/remove: with "remove", never the owner or oneself. */
function removeMember(e) {
  if (unavailable(e)) {
    return;
  }
  return run(e, 'remove', 200, function (txApp, outcome) {
    var own = actorIn(txApp, e, outcome);
    if (own === null) {
      return;
    }
    var target = targetIn(txApp, e, outcome);
    if (target === null) {
      return;
    }
    var problem = rules.removeProblem(plain(own), plain(target));
    if (problem !== '') {
      outcome.problem = problem;
      return;
    }
    var everyone = userIdsOf(membersOf(txApp, outcome.household));
    // The account behind the change, for "Zuständigkeit entfernt" (ADR-0068 §6).
    target.set(ACTOR_KEY, userOf(e));
    txApp.delete(target);
    outcome.notify = everyone;
  });
}

/**
 * POST /api/byl/household/members/{id}/transfer: the owner hands the household to another member.
 * He stays a member with every right set explicitly; the new owner has every right by the role.
 */
function transfer(e) {
  if (unavailable(e)) {
    return;
  }
  return run(e, 'transfer', 200, function (txApp, outcome) {
    var own = actorIn(txApp, e, outcome);
    if (own === null) {
      return;
    }
    var target = targetIn(txApp, e, outcome);
    if (target === null) {
      return;
    }
    var problem = rules.transferProblem(plain(own), plain(target));
    if (problem !== '') {
      outcome.problem = problem;
      return;
    }
    own.set('role', rules.MEMBER);
    own.set('rights', rules.RIGHTS.slice());
    txApp.save(own);
    target.set('role', rules.OWNER);
    target.set('rights', []);
    txApp.save(target);
    outcome.notify = userIdsOf(membersOf(txApp, outcome.household));
  });
}

/** Whether the migration 1790204100 ran (households.trash_retention exists). */
function retentionReady(app) {
  try {
    return !!app.findCachedCollectionByNameOrId(HOUSEHOLDS).fields.getByName('trash_retention');
  } catch (err) {
    return false;
  }
}

/**
 * The membership of `userId` in `householdId` as the rules see it ({ id, role, rights, user,
 * household }), or null. For the trash of a household (E7-3): who may delete for good there.
 */
function membershipIn(app, userId, householdId) {
  if (userId === '' || householdId === '') {
    return null;
  }
  var found = app.findRecordsByFilter(MEMBERS, 'user = {:user} && household = {:household}', '', 1, 0, {
    user: userId,
    household: householdId
  });
  return found.length > 0 ? plain(found[0]) : null;
}

/** Whether `userId` may delete for good in the trash of `householdId`: the owner or "purge" (E7-3). */
function mayPurgeIn(app, userId, householdId) {
  var member = membershipIn(app, userId, householdId);
  return member !== null && rules.mayPurge(member);
}

/**
 * POST /api/byl/household/retention { retention }: the retention of the trash of the household
 * (E7-3), for the owner and members with "purge". Before the migration 1790204100 503 "missing".
 */
function setRetention(e) {
  if (unavailable(e)) {
    return;
  }
  if (!retentionReady(e.app)) {
    return e.json(503, { status: 503, message: UNAVAILABLE, reason: 'missing' });
  }
  var input = rules.retentionInput(bodyOf(e));
  if (input.problem) {
    return refuse(e, 'retention', input.problem);
  }
  return run(e, 'retention', 200, function (txApp, outcome) {
    var own = actorIn(txApp, e, outcome);
    if (own === null) {
      return;
    }
    if (!rules.mayPurge(plain(own))) {
      outcome.problem = 'right';
      return;
    }
    var household = txApp.findRecordById(HOUSEHOLDS, outcome.household);
    household.set('trash_retention', input.retention);
    txApp.save(household);
    outcome.notify = userIdsOf(membersOf(txApp, outcome.household));
  });
}

/**
 * POST /api/byl/household/leave: every member but the owner leaves at once. The entries of the
 * account stay in the household; the API rules hide every household record from it right away.
 */
function leave(e) {
  if (unavailable(e)) {
    return;
  }
  return run(e, 'leave', 200, function (txApp, outcome) {
    var own = actorIn(txApp, e, outcome);
    if (own === null) {
      return;
    }
    var problem = rules.leaveProblem(plain(own));
    if (problem !== '') {
      outcome.problem = problem;
      return;
    }
    outcome.member = own.id;
    var everyone = withUser(userIdsOf(membersOf(txApp, outcome.household)), userOf(e));
    own.set(ACTOR_KEY, userOf(e));
    txApp.delete(own);
    outcome.notify = everyone;
  });
}

module.exports = {
  TOPIC: TOPIC,
  notify: notify,
  ready: ready,
  stateFor: stateFor,
  view: view,
  create: create,
  rename: rename,
  createInvite: createInvite,
  revokeInvite: revokeInvite,
  join: join,
  setRights: setRights,
  removeMember: removeMember,
  transfer: transfer,
  leave: leave,
  setRetention: setRetention,
  retentionReady: retentionReady,
  membershipIn: membershipIn,
  mayPurgeIn: mayPurgeIn
};
