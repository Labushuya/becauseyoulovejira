// Moving records between the areas Privat and Haushalt and dissolving a household (E7-4, ADR-0061).
// CommonJS module, ES5 only, Goja runtime only; the pure rules are in lib/area-move-rules.js.
//
// - POST /api/byl/area/move: a ticket (with its sub-tasks), a project (with its sub projects and
//   every ticket), a rule or an entry of the inbox, also several of one kind, into the household of
//   the account or into its private area. Comments and history follow their ticket (they have no area
//   of their own); the sources of a moved ticket come along. With `preview` nothing changes: the
//   answer counts what would move and names every conflict with the choices it needs. Otherwise the
//   move runs in one transaction with every check before the first write: all or nothing.
// - Every moved ticket gets a new key in the counter of the target; the history keeps the old one
//   ("vorher PRIV-12"). IDs stay, so links keep working and switch the area of a tab (ADR-0059 §7).
// - The writes carry MOVE_KEY (tickets, projects, inbox entries; rules the system key of the
//   recurrence service), so the model hooks leave scope, key, history and series alone; this module
//   writes them itself. Tags are mapped by name, never moved.
// - A change that hides a record reaches no realtime client (PocketBase checks the rule with the new
//   state). Before the first write the module notes which subscription of which tab sees each moved
//   record; after the commit every one of them that no longer sees it gets the "delete" a hard delete
//   would have sent, marked `moved`. Tabs that see the record now get the update of PocketBase.
// - Since E7-4b the area an entry of the inbox leaves keeps its fingerprint
//   (inbox_moved_fingerprints, lib/inbox-service.js), so its channel does not bring it there again,
//   and the targets of repositories and folders in the settings of GitHub and folder connections
//   never point across the border either (ADR-0061, addendum E7-4b).
// - Since QT-1 (ADR-0067) a link of a source or follow-up ticket to a ticket that stays behind is a
//   conflict like a dependency, with its own choice (`ticket_sources`: take the other ticket along, or
//   release the link with its history); links between moved tickets stay as they are.
// - Since MV-2 (ADR-0061, addendum MV-2) `series` moves a series as a whole: the rule of every moved
//   ticket of a series comes along, and every moved rule brings its open occurrences and, with
//   `series_done`, its done ones, each with its cascade, until nothing more joins (also across the
//   choice "mitnehmen"). An occurrence that moves with its rule stays in the series; one that stays
//   behind leaves it as before. The preview counts series, open and done occurrences apart and offers
//   the choice whenever a record of the plan belongs to a series (`series_offer`).
// - POST /api/byl/household/dissolve: only the owner; `adopt` moves everything of the household with
//   the same rules into his private area (codes taken there get a suffix), `delete` deletes it for
//   good after the name of the household is typed. Then the memberships, the codes and the household
//   go, and the topic byl/household tells the tabs of every former member. The same deleting
//   (deleteHousehold) serves the administrator of the app for an orphaned household (E7-4c).
'use strict';

var rules = require(__hooks + '/lib/area-move-rules.js');
var householdRules = require(__hooks + '/lib/household-rules.js');
var ticketKey = require(__hooks + '/lib/ticket-key.js');
var counters = require(__hooks + '/lib/counters.js');
var trashRules = require(__hooks + '/lib/trash-rules.js');

var TICKETS = 'tickets';
var PROJECTS = 'projects';
var RULES = 'recurrence_rules';
var ITEMS = 'inbox_items';
var TAGS = 'tags';
var DEPENDENCIES = 'dependencies';
var CONNECTIONS = 'connections';
var MEMBERS = 'household_members';
var HOUSEHOLDS = 'households';
var INVITES = 'household_invites';
var AREA = 'byl-area';
var PRIVATE_NAME = 'Privat';

// The collection of each kind of a move.
var COLLECTION_OF = { ticket: TICKETS, project: PROJECTS, rule: RULES, item: ITEMS };
// The sets of a plan, in the order of their collections.
var SET_OF = { ticket: 'tickets', project: 'projects', rule: 'rules', item: 'items' };

function userOf(e) {
  return e.auth ? String(e.auth.id) : '';
}

function findById(app, collection, id) {
  if (typeof id !== 'string' || id === '') {
    return null;
  }
  var found = app.findRecordsByFilter(collection, 'id = {:id}', '', 1, 0, { id: id });
  return found.length > 0 ? found[0] : null;
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

function isTrashed(ticket) {
  return trashRules.isTrashed(ticket.getString('deleted_at'));
}

// --- Areas of the account ------------------------------------------------------------------------

/** The household of `userId` as the move needs it ({ id, name, role, rights }), or null. */
function householdOf(app, userId) {
  var found = app.findRecordsByFilter(MEMBERS, 'user = {:user}', 'created,id', 1, 0, { user: userId });
  if (found.length === 0) {
    return null;
  }
  var household = findById(app, HOUSEHOLDS, found[0].getString('household'));
  if (household === null) {
    return null;
  }
  return {
    id: household.id,
    name: household.getString('name'),
    member: found[0],
    role: found[0].getString('role'),
    rights: stringsOf(found[0].getStringSlice('rights'))
  };
}

function privateArea(userId) {
  return { kind: 'private', scope: ticketKey.scopeOf(userId, ''), household: '', name: PRIVATE_NAME };
}

function householdArea(household) {
  return { kind: 'household', scope: ticketKey.scopeOf('', household.id), household: household.id, name: household.name };
}

// --- The plan of a move ----------------------------------------------------------------------------

function newPlan(actor, from, to, moveOut, dissolved) {
  return {
    actor: actor,
    from: from,
    to: to,
    direction: to.kind,
    moveOut: moveOut === true,
    dissolved: dissolved === true,
    sets: { tickets: {}, projects: {}, rules: {}, items: {}, dependencies: {}, connections: {} },
    order: { tickets: [], projects: [], rules: [], items: [], dependencies: [], connections: [] },
    crossing: [],
    // Tickets as sources (QT-1, ADR-0067): links between moved tickets (they stay as they are) and
    // links to a ticket that stays behind (`{ link, inside }`, the choice "mitnehmen" or "lösen").
    linkCount: 0,
    crossingLinks: [],
    // "Ganze Serie verschieben" (MV-2): rules take their occurrences along (`series`), the done ones
    // only with `seriesDone`; `offer` is what the whole series of the plan would hold.
    series: false,
    seriesDone: false,
    offer: { rules: 0, open: 0, done: 0 },
    analysis: null,
    finalCodes: {},
    targetProject: null
  };
}

function has(plan, set, id) {
  return Object.prototype.hasOwnProperty.call(plan.sets[set], id);
}

function put(plan, set, record) {
  if (has(plan, set, record.id)) {
    return false;
  }
  plan.sets[set][record.id] = record;
  plan.order[set].push(record.id);
  return true;
}

function recordsOf(plan, set) {
  var list = [];
  for (var i = 0; i < plan.order[set].length; i++) {
    list.push(plan.sets[set][plan.order[set][i]]);
  }
  return list;
}

// A ticket and its sub-tasks (ADR-0033: they always follow their parent).
function addTicket(txApp, plan, ticket) {
  if (!put(plan, 'tickets', ticket)) {
    return;
  }
  var children = txApp.findRecordsByFilter(TICKETS, "parent = {:id} && deleted_at = ''", 'created,id', 0, 0, { id: ticket.id });
  for (var i = 0; i < children.length; i++) {
    if (children[i].getString('scope') === plan.from.scope) {
      addTicket(txApp, plan, children[i]);
    }
  }
}

// A project and its sub projects (ADR-0034).
function addProject(txApp, plan, project) {
  if (!put(plan, 'projects', project)) {
    return;
  }
  var children = txApp.findRecordsByFilter(PROJECTS, 'parent = {:id}', 'created,id', 0, 0, { id: project.id });
  for (var i = 0; i < children.length; i++) {
    if (children[i].getString('scope') === plan.from.scope) {
      addProject(txApp, plan, children[i]);
    }
  }
}

// Every live ticket of the moved projects comes along.
function addProjectTickets(txApp, plan) {
  for (var i = 0; i < plan.order.projects.length; i++) {
    var found = txApp.findRecordsByFilter(TICKETS, "project = {:id} && deleted_at = ''", 'created,id', 0, 0, {
      id: plan.order.projects[i]
    });
    for (var j = 0; j < found.length; j++) {
      if (found[j].getString('scope') === plan.from.scope) {
        addTicket(txApp, plan, found[j]);
      }
    }
  }
}

function dependenciesOf(txApp, ticketId) {
  return txApp.findRecordsByFilter(DEPENDENCIES, 'blocker = {:id} || blocked = {:id}', 'created,id', 0, 0, { id: ticketId });
}

function otherEnd(dependency, ticketId) {
  return dependency.getString('blocker') === ticketId ? dependency.getString('blocked') : dependency.getString('blocker');
}

// The links of tickets as sources (QT-1, ADR-0067); none before their migration.
function ticketLinks() {
  return require(__hooks + '/lib/ticket-source-service.js');
}

// "Mitnehmen": the other ticket of every dependency (`take.dependencies`) and of every link of a
// source or follow-up ticket (`take.sources`, QT-1) comes along with its sub-tasks, until none of the
// chosen kinds leads outside (the list grows while it is read, so both kinds close over each other).
// `cursor.links` is the first ticket not looked at yet (closeOver calls it again for new tickets).
function takeLinked(txApp, plan, take, cursor) {
  var links = ticketLinks();
  var sources = take.sources && links.ready(txApp);
  for (; cursor.links < plan.order.tickets.length; cursor.links++) {
    var id = plan.order.tickets[cursor.links];
    var others = [];
    var j;
    if (take.dependencies) {
      var found = dependenciesOf(txApp, id);
      for (j = 0; j < found.length; j++) {
        others.push(otherEnd(found[j], id));
      }
    }
    if (sources) {
      var linked = links.linksOfTicket(txApp, id);
      for (j = 0; j < linked.length; j++) {
        others.push(links.otherEnd(linked[j], id));
      }
    }
    for (j = 0; j < others.length; j++) {
      if (has(plan, 'tickets', others[j])) {
        continue;
      }
      var record = findById(txApp, TICKETS, others[j]);
      if (record !== null && !isTrashed(record) && record.getString('scope') === plan.from.scope) {
        addTicket(txApp, plan, record);
      }
    }
  }
}

// The live occurrences of a rule, oldest first: the open ones, with `done` also the done ones. The
// trash holds none (it clears `recurrence`, ADR-0037).
function occurrencesOf(txApp, ruleId, done) {
  var filter = "recurrence = {:rule} && deleted_at = ''" + (done ? '' : " && status != 'done'");
  return txApp.findRecordsByFilter(TICKETS, filter, 'created,id', 0, 0, { rule: ruleId });
}

// "Ganze Serie verschieben" (MV-2): the rule of every moved ticket of a series joins the plan, and
// every rule of the plan brings its open occurrences and, with `plan.seriesDone`, its done ones, each
// with its sub-tasks; only records of the area the move leaves. `cursor.tickets` and `cursor.rules`
// are the first ticket and rule not looked at yet.
function addSeries(txApp, plan, cursor) {
  for (; cursor.tickets < plan.order.tickets.length; cursor.tickets++) {
    var ruleId = plan.sets.tickets[plan.order.tickets[cursor.tickets]].getString('recurrence');
    if (ruleId === '' || has(plan, 'rules', ruleId)) {
      continue;
    }
    var rule = findById(txApp, RULES, ruleId);
    if (rule !== null && rule.getString('scope') === plan.from.scope) {
      put(plan, 'rules', rule);
    }
  }
  for (; cursor.rules < plan.order.rules.length; cursor.rules++) {
    var found = occurrencesOf(txApp, plan.order.rules[cursor.rules], plan.seriesDone);
    for (var i = 0; i < found.length; i++) {
      if (found[i].getString('scope') === plan.from.scope) {
        addTicket(txApp, plan, found[i]);
      }
    }
  }
}

// The cascade beyond the roots: whole series (MV-2) and "mitnehmen" of linked tickets (E7-4, QT-1),
// again and again until neither adds a ticket or a rule. Each looks only at what is new to it.
function closeOver(txApp, plan, take) {
  var cursor = { tickets: 0, rules: 0, links: 0 };
  var size = -1;
  while (size !== plan.order.tickets.length + plan.order.rules.length) {
    size = plan.order.tickets.length + plan.order.rules.length;
    if (plan.series) {
      addSeries(txApp, plan, cursor);
    }
    if (take.dependencies || take.sources) {
      takeLinked(txApp, plan, take, cursor);
    }
  }
}

/**
 * What "Ganze Serie verschieben" covers for the plan (MV-2), for the choice and its number in the
 * dialog: the rules of its records of a series (the moved rules and the rules of the moved tickets)
 * and their open and done occurrences in the area the move leaves. The same with and without the
 * choice, as far as the plan is the same.
 */
function seriesOffer(txApp, plan) {
  var offer = { rules: 0, open: 0, done: 0 };
  var ids = plan.order.rules.slice();
  var seen = {};
  var i;
  for (i = 0; i < ids.length; i++) {
    seen[ids[i]] = true;
  }
  for (i = 0; i < plan.order.tickets.length; i++) {
    var ruleId = plan.sets.tickets[plan.order.tickets[i]].getString('recurrence');
    if (ruleId !== '' && !seen[ruleId]) {
      seen[ruleId] = true;
      ids.push(ruleId);
    }
  }
  for (i = 0; i < ids.length; i++) {
    var rule = has(plan, 'rules', ids[i]) ? plan.sets.rules[ids[i]] : findById(txApp, RULES, ids[i]);
    if (rule === null || rule.getString('scope') !== plan.from.scope) {
      continue;
    }
    offer.rules += 1;
    var found = occurrencesOf(txApp, ids[i], true);
    for (var j = 0; j < found.length; j++) {
      if (found[j].getString('scope') !== plan.from.scope) {
        continue;
      }
      if (found[j].getString('status') === 'done') {
        offer.done += 1;
      } else {
        offer.open += 1;
      }
    }
  }
  return offer;
}

// Links between moved tickets stay as they are (they have no area of their own); a link to a ticket
// that stays behind, also one in the trash, crosses the border and needs the choice (QT-1).
function classifyTicketLinks(txApp, plan) {
  var links = ticketLinks();
  if (!links.ready(txApp)) {
    return;
  }
  var seen = {};
  for (var i = 0; i < plan.order.tickets.length; i++) {
    var id = plan.order.tickets[i];
    var found = links.linksOfTicket(txApp, id);
    for (var j = 0; j < found.length; j++) {
      if (seen[found[j].id]) {
        continue;
      }
      seen[found[j].id] = true;
      if (has(plan, 'tickets', links.otherEnd(found[j], id))) {
        plan.linkCount += 1;
      } else {
        plan.crossingLinks.push({ link: found[j], inside: id });
      }
    }
  }
}

// Dependencies between moved tickets move along; the others cross the border and need a choice.
function classifyDependencies(txApp, plan) {
  var seen = {};
  for (var i = 0; i < plan.order.tickets.length; i++) {
    var id = plan.order.tickets[i];
    var found = dependenciesOf(txApp, id);
    for (var j = 0; j < found.length; j++) {
      var dependency = found[j];
      if (seen[dependency.id]) {
        continue;
      }
      seen[dependency.id] = true;
      if (has(plan, 'tickets', otherEnd(dependency, id))) {
        put(plan, 'dependencies', dependency);
      } else {
        plan.crossing.push({ dependency: dependency, inside: id });
      }
    }
  }
}

// The sources of the moved tickets (inbox entries bound to them, the main source) come along.
function addSources(txApp, plan) {
  for (var i = 0; i < plan.order.tickets.length; i++) {
    var ticket = plan.sets.tickets[plan.order.tickets[i]];
    var found = txApp.findRecordsByFilter(ITEMS, 'ticket = {:id}', 'created,id', 0, 0, { id: ticket.id });
    for (var j = 0; j < found.length; j++) {
      if (found[j].getString('scope') === plan.from.scope) {
        put(plan, 'items', found[j]);
      }
    }
    var main = findById(txApp, ITEMS, ticket.getString('source_item'));
    if (main !== null && main.getString('scope') === plan.from.scope) {
      put(plan, 'items', main);
    }
  }
}

function isPrimarySource(txApp, itemId) {
  return txApp.findRecordsByFilter(TICKETS, 'source_item = {:id}', '', 1, 0, { id: itemId }).length > 0;
}

/**
 * The records a move starts from, each checked: visible in the area it leaves (else 'missing', or
 * 'area' when it lies in the target already), a ticket not in the trash, an entry of the inbox not
 * bound to a ticket ('linked'). Returns '' or the problem.
 */
function addRoots(txApp, plan, kind, ids) {
  for (var i = 0; i < ids.length; i++) {
    var record = findById(txApp, COLLECTION_OF[kind], ids[i]);
    if (record === null || (kind === 'ticket' && isTrashed(record))) {
      return 'missing';
    }
    var scope = record.getString('scope');
    if (scope !== plan.from.scope) {
      return scope === plan.to.scope ? 'area' : 'missing';
    }
    if (kind === 'item' && (record.getString('ticket') !== '' || isPrimarySource(txApp, record.id))) {
      return 'linked';
    }
    if (kind === 'ticket') {
      addTicket(txApp, plan, record);
    } else if (kind === 'project') {
      addProject(txApp, plan, record);
    } else {
      put(plan, SET_OF[kind], record);
    }
  }
  return '';
}

/**
 * Collects the cascade of a move (ADR-0061 §1). `take.dependencies`: dependencies take their other
 * ticket along; `take.sources`: links of source and follow-up tickets do (QT-1, ADR-0067);
 * `plan.series`: whole series (MV-2).
 */
function collect(txApp, plan, kind, ids, take) {
  var problem = addRoots(txApp, plan, kind, ids);
  if (problem !== '') {
    return problem;
  }
  addProjectTickets(txApp, plan);
  closeOver(txApp, plan, take);
  classifyDependencies(txApp, plan);
  classifyTicketLinks(txApp, plan);
  addSources(txApp, plan);
  plan.offer = seriesOffer(txApp, plan);
  return '';
}

/** Everything of a household (dissolving, ADR-0061 §5): live and trashed tickets, all records. */
function collectHousehold(txApp, plan) {
  var scope = plan.from.scope;
  var lists = [
    ['tickets', TICKETS],
    ['projects', PROJECTS],
    ['rules', RULES],
    ['items', ITEMS]
  ];
  for (var i = 0; i < lists.length; i++) {
    var found = txApp.findRecordsByFilter(lists[i][1], 'scope = {:scope}', 'created,id', 0, 0, { scope: scope });
    for (var j = 0; j < found.length; j++) {
      put(plan, lists[i][0], found[j]);
    }
  }
  var byHousehold = [
    ['dependencies', DEPENDENCIES],
    ['connections', CONNECTIONS]
  ];
  for (var k = 0; k < byHousehold.length; k++) {
    var rows = txApp.findRecordsByFilter(byHousehold[k][1], 'household = {:h}', 'created,id', 0, 0, { h: plan.from.household });
    for (var m = 0; m < rows.length; m++) {
      put(plan, byHousehold[k][0], rows[m]);
    }
  }
}

// --- Analysis: rights, conflicts, choices -----------------------------------------------------------

function labelOf(set, record) {
  if (set === 'tickets') {
    return record.getString('key');
  }
  if (set === 'projects') {
    return record.getString('code');
  }
  return record.getString('title');
}

/** The first record of the plan the actor may not move (ADR-0061 §4), as { label }, or null. */
function rightViolation(plan) {
  var sets = ['tickets', 'projects', 'rules', 'items'];
  for (var i = 0; i < sets.length; i++) {
    var records = recordsOf(plan, sets[i]);
    for (var j = 0; j < records.length; j++) {
      var record = records[j];
      var place = { owner: record.getString('owner'), household: record.getString('household') };
      if (!rules.mayMove(plan.direction, place, plan.actor, plan.moveOut)) {
        return { label: labelOf(sets[i], record) };
      }
    }
  }
  return null;
}

function codesIn(txApp, scope) {
  var codes = [];
  var found = txApp.findRecordsByFilter(PROJECTS, 'scope = {:scope}', '', 0, 0, { scope: scope });
  for (var i = 0; i < found.length; i++) {
    codes.push(found[i].getString('code'));
  }
  return codes;
}

function tagNamesIn(txApp, scope) {
  var names = {};
  var found = txApp.findRecordsByFilter(TAGS, 'scope = {:scope}', '', 0, 0, { scope: scope });
  for (var i = 0; i < found.length; i++) {
    names[found[i].getString('name').toLowerCase()] = found[i].id;
  }
  return names;
}

function fingerprintTaken(txApp, scope, fingerprint) {
  return (
    fingerprint !== '' &&
    txApp.findRecordsByFilter(ITEMS, 'scope = {:scope} && fingerprint = {:fp}', '', 1, 0, { scope: scope, fp: fingerprint })
      .length > 0
  );
}

/**
 * What the move changes besides the area (ADR-0061 §2), read before the first write: projects that
 * stay behind, parents that stay, codes taken in the target, tickets leaving their series, tags by
 * name, notes of the entries, references from outside to moved projects and rules.
 */
function analyse(txApp, plan) {
  var analysis = {
    staying: [],
    stayingTickets: 0,
    stayingRules: 0,
    parents: [],
    projectParents: [],
    codes: [],
    series: [],
    ruleTickets: [],
    rulesProject: [],
    tags: { reused: [], created: [] },
    tagIds: [],
    items: {},
    itemCounts: { connection: 0, target: 0, duplicate: 0 },
    outsideItems: [],
    outsideConnections: [],
    userTargets: [],
    unitTargets: [],
    unitTargetCount: 0,
    comments: 0
  };
  var stayingSeen = {};
  var tickets = recordsOf(plan, 'tickets');
  var moved = recordsOf(plan, 'rules');
  var i;
  function staying(projectId) {
    if (stayingSeen[projectId]) {
      return;
    }
    stayingSeen[projectId] = true;
    var project = findById(txApp, PROJECTS, projectId);
    if (project !== null) {
      analysis.staying.push(project);
    }
  }
  var tagIds = [];
  function noteTags(record) {
    var ids = stringsOf(record.getStringSlice('tags'));
    for (var t = 0; t < ids.length; t++) {
      if (tagIds.indexOf(ids[t]) === -1) {
        tagIds.push(ids[t]);
      }
    }
  }
  for (i = 0; i < tickets.length; i++) {
    var ticket = tickets[i];
    var projectId = ticket.getString('project');
    if (projectId !== '' && !has(plan, 'projects', projectId)) {
      staying(projectId);
      analysis.stayingTickets += 1;
    }
    var parentId = ticket.getString('parent');
    if (parentId !== '' && !has(plan, 'tickets', parentId)) {
      var parent = findById(txApp, TICKETS, parentId);
      analysis.parents.push({ ticket: ticket, parentKey: parent ? parent.getString('key') : '' });
    }
    var ruleId = ticket.getString('recurrence');
    if (ruleId !== '' && !has(plan, 'rules', ruleId)) {
      analysis.series.push(ticket);
    }
    noteTags(ticket);
    analysis.comments += txApp.countRecords('comments', $dbx.hashExp({ ticket: ticket.id }));
  }
  for (i = 0; i < moved.length; i++) {
    var rule = moved[i];
    var ruleProject = rule.getString('project');
    if (ruleProject !== '' && !has(plan, 'projects', ruleProject)) {
      staying(ruleProject);
      analysis.stayingRules += 1;
    }
    noteTags(rule);
    var instances = txApp.findRecordsByFilter(TICKETS, 'recurrence = {:rule}', 'created,id', 0, 0, { rule: rule.id });
    for (var r = 0; r < instances.length; r++) {
      if (!has(plan, 'tickets', instances[r].id)) {
        analysis.ruleTickets.push(instances[r]);
      }
    }
  }
  var projects = recordsOf(plan, 'projects');
  var targetCodes = codesIn(txApp, plan.to.scope);
  for (i = 0; i < projects.length; i++) {
    var project = projects[i];
    var parentProject = project.getString('parent');
    if (parentProject !== '' && !has(plan, 'projects', parentProject)) {
      var above = findById(txApp, PROJECTS, parentProject);
      analysis.projectParents.push({ project: project, parentCode: above ? above.getString('code') : '' });
    }
    if (targetCodes.indexOf(project.getString('code')) !== -1) {
      analysis.codes.push(project);
    }
    var outsideRules = txApp.findRecordsByFilter(RULES, 'project = {:id}', 'created,id', 0, 0, { id: project.id });
    for (var o = 0; o < outsideRules.length; o++) {
      if (!has(plan, 'rules', outsideRules[o].id)) {
        analysis.rulesProject.push(outsideRules[o]);
      }
    }
    var outsideItems = txApp.findRecordsByFilter(ITEMS, 'target_project = {:id}', 'created,id', 0, 0, { id: project.id });
    for (var n = 0; n < outsideItems.length; n++) {
      if (!has(plan, 'items', outsideItems[n].id)) {
        analysis.outsideItems.push(outsideItems[n]);
      }
    }
    var outsideConnections = txApp.findRecordsByFilter(CONNECTIONS, 'target_project = {:id}', 'created,id', 0, 0, { id: project.id });
    for (var c = 0; c < outsideConnections.length; c++) {
      if (!has(plan, 'connections', outsideConnections[c].id)) {
        analysis.outsideConnections.push(outsideConnections[c]);
      }
    }
  }
  analysis.codes.sort(function (a, b) {
    return a.getString('code') < b.getString('code') ? -1 : 1;
  });
  // Targets of repositories and folders in the settings of GitHub and folder connections (E7-4b).
  if (plan.order.projects.length > 0 || plan.order.connections.length > 0) {
    var units = txApp.findRecordsByFilter(CONNECTIONS, "type = 'github' || type = 'folder'", 'created,id', 0, 0);
    for (i = 0; i < units.length; i++) {
      noteUnitTargets(txApp, plan, analysis, units[i]);
    }
  }
  // The cards of the own inbox and of the files keep their target per account (ADR-0049 §4): only
  // the projects of the private area of the actor can be there.
  if (plan.direction === 'household') {
    var user = findById(txApp, 'users', plan.actor);
    var cards = user ? parsedObject(user.getString('inbox_targets')) : null;
    if (cards !== null) {
      for (var card in cards) {
        if (Object.prototype.hasOwnProperty.call(cards, card) && typeof cards[card] === 'string' && has(plan, 'projects', cards[card])) {
          analysis.userTargets.push(card);
        }
      }
    }
  }
  // Tags by name (the target keeps its own, a missing one is created).
  var names = [];
  for (i = 0; i < tagIds.length; i++) {
    var tag = findById(txApp, TAGS, tagIds[i]);
    if (tag !== null) {
      names.push(tag.getString('name'));
    }
  }
  var targetNames = [];
  var known = tagNamesIn(txApp, plan.to.scope);
  for (var lower in known) {
    if (Object.prototype.hasOwnProperty.call(known, lower)) {
      targetNames.push(lower);
    }
  }
  analysis.tags = rules.tagMapping(names, targetNames);
  analysis.tagIds = tagIds;
  // Entries of the inbox: a connection of another area and a target project that stays are cleared,
  // a fingerprint the target has already gets one of its own (both entries stay).
  var items = recordsOf(plan, 'items');
  for (i = 0; i < items.length; i++) {
    var item = items[i];
    var note = { connection: false, target: false, duplicate: false };
    var connectionId = item.getString('connection');
    if (connectionId !== '' && !has(plan, 'connections', connectionId)) {
      var connection = findById(txApp, CONNECTIONS, connectionId);
      note.connection = connection === null || connection.getString('scope') !== plan.to.scope;
    }
    var target = item.getString('target_project');
    note.target = target !== '' && !has(plan, 'projects', target);
    note.duplicate = fingerprintTaken(txApp, plan.to.scope, item.getString('fingerprint'));
    analysis.items[item.id] = note;
    analysis.itemCounts.connection += note.connection ? 1 : 0;
    analysis.itemCounts.target += note.target ? 1 : 0;
    analysis.itemCounts.duplicate += note.duplicate ? 1 : 0;
  }
  plan.analysis = analysis;
  return analysis;
}

/**
 * The targets of the repositories or folders of `connection` (ADR-0049 §3) that would cross the border
 * after the move (E7-4b, ADR-0061 addendum E7-4b): a moved project named by a connection that stays,
 * or, when a household is dissolved, a project that stays named by a connection that moves along. A
 * target of a deleted project stays as it is (the card names it "gibt es nicht mehr").
 */
function noteUnitTargets(txApp, plan, analysis, connection) {
  var moves = has(plan, 'connections', connection.id);
  var connectionScope = moves ? plan.to.scope : connection.getString('scope');
  var result = rules.clearedUnitTargets(connection.getString('type'), parsedObject(connection.getString('settings')), function (target) {
    if (has(plan, 'projects', target)) {
      return plan.to.scope !== connectionScope;
    }
    if (!moves) {
      return false;
    }
    var project = findById(txApp, PROJECTS, target);
    return project !== null && project.getString('scope') !== connectionScope;
  });
  if (result.settings !== null) {
    analysis.unitTargets.push({ id: connection.id, settings: result.settings });
    analysis.unitTargetCount += result.cleared;
  }
}

// The settings of a connection with its cleared targets (noteUnitTargets), or null.
function unitSettingsOf(plan, connectionId) {
  var list = plan.analysis.unitTargets;
  for (var i = 0; i < list.length; i++) {
    if (list[i].id === connectionId) {
      return list[i].settings;
    }
  }
  return null;
}

function parsedObject(raw) {
  if (raw === '' || raw === 'null') {
    return null;
  }
  try {
    var value = JSON.parse(raw);
    return value !== null && typeof value === 'object' ? value : null;
  } catch (err) {
    return null;
  }
}

/**
 * The codes of the moved projects in the target: a taken one needs a new code, chosen by the user
 * (`chosen`, by project ID) or, when a household is dissolved, made with a suffix. Returns '' and sets
 * plan.finalCodes, or the problem with the project as params.
 */
function decideCodes(txApp, plan, chosen) {
  var targetCodes = codesIn(txApp, plan.to.scope);
  var projects = recordsOf(plan, 'projects');
  var collides = {};
  var i;
  for (i = 0; i < plan.analysis.codes.length; i++) {
    collides[plan.analysis.codes[i].id] = true;
  }
  for (i = 0; i < projects.length; i++) {
    if (!collides[projects[i].id]) {
      plan.finalCodes[projects[i].id] = projects[i].getString('code');
    }
  }
  for (i = 0; i < projects.length; i++) {
    var project = projects[i];
    if (!collides[project.id]) {
      continue;
    }
    var taken = targetCodes.slice();
    for (var id in plan.finalCodes) {
      if (Object.prototype.hasOwnProperty.call(plan.finalCodes, id) && id !== project.id) {
        taken.push(plan.finalCodes[id]);
      }
    }
    var code = plan.dissolved ? rules.suffixedCode(project.getString('code'), taken) : chosen[project.id];
    if (rules.codeProblem(code, taken) !== '') {
      return { problem: 'code', params: { project: project.id, code: project.getString('code') } };
    }
    plan.finalCodes[project.id] = code;
  }
  return null;
}

/** The suggestions for taken codes in the preview (a suffix, like dissolving does). */
function codeSuggestions(txApp, plan) {
  var taken = codesIn(txApp, plan.to.scope);
  var projects = recordsOf(plan, 'projects');
  var i;
  for (i = 0; i < projects.length; i++) {
    taken.push(projects[i].getString('code'));
  }
  var list = [];
  for (i = 0; i < plan.analysis.codes.length; i++) {
    var project = plan.analysis.codes[i];
    var suggestion = rules.suffixedCode(project.getString('code'), taken);
    taken.push(suggestion);
    list.push({ id: project.id, code: project.getString('code'), name: project.getString('name'), suggestion: suggestion });
  }
  return list;
}

/** The choices of the user against the plan; null when they are complete, else the problem. */
function choiceProblem(txApp, plan, input) {
  if (plan.analysis.staying.length > 0 && input.project === undefined) {
    return { problem: 'project-choice' };
  }
  if (input.project !== undefined && input.project !== '') {
    var target = findById(txApp, PROJECTS, input.project);
    if (target === null || target.getString('scope') !== plan.to.scope || target.getBool('archived')) {
      return { problem: 'project' };
    }
    plan.targetProject = target;
  }
  if (plan.crossing.length > 0 && input.dependencies === undefined) {
    return { problem: 'dependencies-choice' };
  }
  if (plan.crossingLinks.length > 0 && input.ticket_sources === undefined) {
    return { problem: 'ticket-sources-choice' };
  }
  return decideCodes(txApp, plan, input.codes);
}

function ticketRef(ticket) {
  return ticket === null ? null : { id: ticket.id, key: ticket.getString('key'), title: ticket.getString('title') };
}

// The active projects of the target, for the choice of the project (the tab knows only its own area).
function targetProjects(txApp, plan) {
  var found = txApp.findRecordsByFilter(PROJECTS, 'scope = {:scope} && archived = false', 'name,id', 0, 0, { scope: plan.to.scope });
  var list = [];
  for (var i = 0; i < found.length; i++) {
    list.push({ id: found[i].id, code: found[i].getString('code'), name: found[i].getString('name') });
  }
  return list;
}

/** The answer of a preview and of a move (ADR-0061 §1). */
function summaryOf(txApp, plan, input) {
  var analysis = plan.analysis;
  var tickets = recordsOf(plan, 'tickets');
  var subtasks = 0;
  // Occurrences that move with their rule and stay in their series (MV-2), open and done apart.
  var occurrences = { open: 0, done: 0 };
  var i;
  for (i = 0; i < tickets.length; i++) {
    if (tickets[i].getString('parent') !== '' && has(plan, 'tickets', tickets[i].getString('parent'))) {
      subtasks += 1;
    }
    if (tickets[i].getString('recurrence') !== '' && has(plan, 'rules', tickets[i].getString('recurrence'))) {
      occurrences[tickets[i].getString('status') === 'done' ? 'done' : 'open'] += 1;
    }
  }
  var staying = [];
  for (i = 0; i < analysis.staying.length; i++) {
    var project = analysis.staying[i];
    staying.push({ id: project.id, code: project.getString('code'), name: project.getString('name') });
  }
  var dependencies = [];
  for (i = 0; i < plan.crossing.length; i++) {
    var entry = plan.crossing[i];
    dependencies.push({
      ticket: ticketRef(plan.sets.tickets[entry.inside] || null),
      other: ticketRef(findById(txApp, TICKETS, otherEnd(entry.dependency, entry.inside)))
    });
  }
  // QT-1: `relation` from the moved ticket: `source` (it stems from the other) or `follow_up`.
  var ticketSources = [];
  for (i = 0; i < plan.crossingLinks.length; i++) {
    var crossing = plan.crossingLinks[i];
    var other = findById(txApp, TICKETS, ticketLinks().otherEnd(crossing.link, crossing.inside));
    ticketSources.push({
      ticket: ticketRef(plan.sets.tickets[crossing.inside] || null),
      other: ticketRef(other),
      relation: crossing.link.getString('ticket') === crossing.inside ? 'source' : 'follow_up',
      trashed: other !== null && isTrashed(other)
    });
  }
  var parents = [];
  for (i = 0; i < analysis.parents.length; i++) {
    parents.push({ id: analysis.parents[i].ticket.id, key: analysis.parents[i].ticket.getString('key'), parent: analysis.parents[i].parentKey });
  }
  var projectParents = [];
  for (i = 0; i < analysis.projectParents.length; i++) {
    projectParents.push({
      id: analysis.projectParents[i].project.id,
      code: analysis.projectParents[i].project.getString('code'),
      parent: analysis.projectParents[i].parentCode
    });
  }
  var series = [];
  for (i = 0; i < analysis.series.length; i++) {
    series.push({ id: analysis.series[i].id, key: analysis.series[i].getString('key') });
  }
  var rulesProject = [];
  for (i = 0; i < analysis.rulesProject.length; i++) {
    rulesProject.push({ id: analysis.rulesProject[i].id, title: analysis.rulesProject[i].getString('title') });
  }
  var codes = codeSuggestions(txApp, plan);
  var needCodes = [];
  for (i = 0; i < codes.length; i++) {
    needCodes.push(codes[i].id);
  }
  return {
    preview: input.preview === true,
    kind: input.kind,
    to: plan.direction,
    scope: plan.to.scope,
    from_name: plan.from.name,
    to_name: plan.to.name,
    counts: {
      tickets: tickets.length,
      subtasks: subtasks,
      projects: plan.order.projects.length,
      rules: plan.order.rules.length,
      items: plan.order.items.length,
      comments: analysis.comments,
      dependencies: plan.order.dependencies.length,
      ticket_sources: plan.linkCount,
      // Rules that move as whole series (MV-2), and their occurrences.
      series: plan.series ? plan.order.rules.length : 0,
      occurrences: occurrences
    },
    series_offer: plan.offer,
    conflicts: {
      project:
        staying.length === 0
          ? null
          : { projects: staying, tickets: analysis.stayingTickets, rules: analysis.stayingRules, targets: targetProjects(txApp, plan) },
      tags: analysis.tags,
      dependencies: dependencies,
      ticket_sources: ticketSources,
      parents: parents,
      project_parents: projectParents,
      codes: codes,
      series: series,
      rule_tickets: analysis.ruleTickets.length,
      rules_project: rulesProject,
      items: analysis.itemCounts,
      targets: analysis.outsideItems.length + analysis.outsideConnections.length + analysis.userTargets.length,
      unit_targets: analysis.unitTargetCount
    },
    needs: {
      project: staying.length > 0,
      dependencies: plan.crossing.length > 0 && input.dependencies === undefined,
      ticket_sources: plan.crossingLinks.length > 0 && input.ticket_sources === undefined,
      codes: needCodes
    }
  };
}

// --- Writing --------------------------------------------------------------------------------------

/** Owner, household and scope of the target; into the private area the actor becomes the owner. */
function place(plan, record) {
  if (plan.direction === 'private') {
    record.set('owner', plan.actor);
  }
  record.set('household', plan.to.household);
  record.set('scope', ticketKey.scopeOf(record.getString('owner'), plan.to.household));
}

function historyEntry(txApp, ticketId, field, oldValue, newValue, actor) {
  var entry = new Record(txApp.findCollectionByNameOrId('ticket_history'));
  entry.set('ticket', ticketId);
  entry.set('field', field);
  entry.set('old_value', oldValue);
  entry.set('new_value', newValue);
  entry.set('user', actor);
  txApp.save(entry);
}

// A new key in the counter of the target; a key that exists there already (an old ticket of the
// trash with the same code) is skipped, so the unique index never fails the move.
function assignKey(txApp, ticket, scope, project, code) {
  var counter = ticketKey.counterKey(scope, project ? project.id : '');
  for (var attempt = 0; attempt < 1000; attempt++) {
    var number = counters.nextValue(txApp, counter);
    var key = ticketKey.formatKey(code, number);
    if (txApp.findRecordsByFilter(TICKETS, 'scope = {:scope} && key = {:key}', '', 1, 0, { scope: scope, key: key }).length === 0) {
      ticket.set('number', number);
      ticket.set('key', key);
      return key;
    }
  }
  throw new Error('Kein freier Key im Ziel gefunden.');
}

// The tags of the target by name, created on demand (owner the actor, in the area of the target).
function tagMapper(txApp, plan) {
  return tagMapperIn(txApp, plan.to.scope, plan.to.household, plan.actor);
}

/**
 * Maps a tag ID to the tag of the same name (case aside) in the area `scope`, creating a missing one
 * there with `owner` and `household` on first use; '' for a tag that no longer exists. Moving
 * (ADR-0061 §2) and duplicating into another area (ADR-0045, addendum MV-2) map tags this way.
 */
function tagMapperIn(txApp, scope, household, owner) {
  var byName = tagNamesIn(txApp, scope);
  var byId = {};
  return function (tagId) {
    if (Object.prototype.hasOwnProperty.call(byId, tagId)) {
      return byId[tagId];
    }
    var tag = findById(txApp, TAGS, tagId);
    if (tag === null) {
      byId[tagId] = '';
      return '';
    }
    var lower = tag.getString('name').toLowerCase();
    if (!Object.prototype.hasOwnProperty.call(byName, lower)) {
      var created = new Record(txApp.findCollectionByNameOrId(TAGS));
      created.set('owner', owner);
      created.set('household', household);
      created.set('name', tag.getString('name'));
      txApp.save(created);
      byName[lower] = created.id;
    }
    byId[tagId] = byName[lower];
    return byId[tagId];
  };
}

function mappedTags(record, mapTag) {
  var ids = stringsOf(record.getStringSlice('tags'));
  var result = [];
  for (var i = 0; i < ids.length; i++) {
    var mapped = mapTag(ids[i]);
    if (mapped !== '' && result.indexOf(mapped) === -1) {
      result.push(mapped);
    }
  }
  return result;
}

function projectName(txApp, id) {
  var project = findById(txApp, PROJECTS, id);
  return project === null ? '' : project.getString('name');
}

// An open ticket that leaves its series is released like "Aus der Serie lösen" (ADR-0023 §6): the
// date counts as skipped, "nach Erledigung" waits as if done today.
function releaseFromSeries(txApp, ticket, nowMs) {
  require(__hooks + '/lib/recurrence-service.js').prepareTicketDelete(txApp, ticket, nowMs);
}

function eachReady(txApp) {
  return require(__hooks + '/lib/recurrence-service.js').eachReady(txApp);
}

function moveProjects(txApp, plan) {
  var projects = recordsOf(plan, 'projects');
  for (var i = 0; i < projects.length; i++) {
    var project = projects[i];
    place(plan, project);
    project.set('code', plan.finalCodes[project.id]);
    if (project.getString('parent') !== '' && !has(plan, 'projects', project.getString('parent'))) {
      project.set('parent', '');
    }
    project.set(rules.MOVE_KEY, true);
    txApp.save(project);
  }
}

// The project of a moved record in the target: its own if it moves too, else the choice.
function finalProject(plan, projectId) {
  if (projectId === '') {
    return null;
  }
  if (has(plan, 'projects', projectId)) {
    return plan.sets.projects[projectId];
  }
  return plan.targetProject;
}

function moveRules(txApp, plan, mapTag) {
  var recurrence = require(__hooks + '/lib/recurrence-service.js');
  var assignees = require(__hooks + '/lib/assignee-service.js');
  for (var i = 0; i < plan.order.rules.length; i++) {
    // Read again: releasing an open instance saved the rule (next_due) in this transaction.
    var rule = findById(txApp, RULES, plan.order.rules[i]);
    place(plan, rule);
    var project = finalProject(plan, rule.getString('project'));
    rule.set('project', project ? project.id : '');
    rule.set('tags', mappedTags(rule, mapTag));
    // The private area knows no assignment of its tickets (ADR-0068 §7): the rotation goes.
    if (plan.direction === 'private') {
      assignees.dropRuleAssignment(txApp, rule);
    }
    rule.set(recurrence.SYSTEM_KEY, true);
    txApp.save(rule);
  }
}

// A ticket that leaves the household for the private area loses its assignee (ADR-0068 §7); returns
// the one it had for the history ('' for none or another direction).
function dropAssignee(plan, ticket) {
  if (plan.direction !== 'private') {
    return '';
  }
  return require(__hooks + '/lib/assignee-service.js').dropAssignee(ticket);
}

// "Zuständigkeit entfernt" in the history of a moved ticket, after its entry `area_move`.
function assigneeHistory(txApp, plan, ticketId, previous) {
  require(__hooks + '/lib/assignee-service.js').clearedHistory(txApp, ticketId, previous, plan.actor);
}

// Tickets in the order of their project and their number, so the new numbers follow the old ones.
function orderedTickets(plan) {
  var tickets = recordsOf(plan, 'tickets');
  tickets.sort(function (a, b) {
    var pa = a.getString('project');
    var pb = b.getString('project');
    if (pa !== pb) {
      return pa < pb ? -1 : 1;
    }
    return a.getInt('number') - b.getInt('number');
  });
  return tickets;
}

// A ticket of the trash (dissolving only): its project is empty there, the snapshot keeps it. The key
// follows the project of the snapshot if it moves too (with its final code), so restoring keeps it.
function moveTrashedTicket(txApp, plan, ticket, mapTag) {
  var snapshot = trashRules.readSnapshot(ticket.getString('trash'));
  var previous = ticket.getString('key');
  var project = snapshot.project !== '' && has(plan, 'projects', snapshot.project) ? plan.sets.projects[snapshot.project] : null;
  place(plan, ticket);
  ticket.set('tags', mappedTags(ticket, mapTag));
  var assignee = dropAssignee(plan, ticket);
  var key = assignKey(txApp, ticket, plan.to.scope, project, project ? plan.finalCodes[project.id] : ticketKey.TASK);
  if (project !== null) {
    snapshot.project_code = plan.finalCodes[project.id];
    ticket.set('trash', snapshot);
  }
  ticket.set(rules.MOVE_KEY, true);
  txApp.save(ticket);
  historyEntry(txApp, ticket.id, rules.HISTORY_FIELD, previous, rules.historyValue({ to: plan.direction, key: key, dissolved: true }), plan.actor);
  assigneeHistory(txApp, plan, ticket.id, assignee);
}

function moveTickets(txApp, plan, mapTag) {
  var each = eachReady(txApp);
  var tickets = orderedTickets(plan);
  for (var i = 0; i < tickets.length; i++) {
    var ticket = tickets[i];
    if (isTrashed(ticket)) {
      moveTrashedTicket(txApp, plan, ticket, mapTag);
      continue;
    }
    var previous = ticket.getString('key');
    var projectBefore = ticket.getString('project');
    var project = finalProject(plan, projectBefore);
    var projectChange = null;
    if ((project ? project.id : '') !== projectBefore) {
      projectChange = { from: projectName(txApp, projectBefore), to: project ? project.getString('name') : '' };
    }
    var parentKey = '';
    var parentId = ticket.getString('parent');
    if (parentId !== '' && !has(plan, 'tickets', parentId)) {
      var parent = findById(txApp, TICKETS, parentId);
      parentKey = parent ? parent.getString('key') : '';
      ticket.set('parent', '');
    }
    var leaves = ticket.getString('recurrence') !== '' && !has(plan, 'rules', ticket.getString('recurrence'));
    if (leaves) {
      ticket.set('recurrence', '');
      if (each) {
        ticket.set('occurrence', '');
      }
    }
    place(plan, ticket);
    ticket.set('project', project ? project.id : '');
    ticket.set('tags', mappedTags(ticket, mapTag));
    var assignee = dropAssignee(plan, ticket);
    var key = assignKey(txApp, ticket, plan.to.scope, project, project ? plan.finalCodes[project.id] || project.getString('code') : ticketKey.TASK);
    ticket.set(rules.MOVE_KEY, true);
    txApp.save(ticket);
    historyEntry(
      txApp,
      ticket.id,
      rules.HISTORY_FIELD,
      previous,
      rules.historyValue({
        to: plan.direction,
        key: key,
        project: projectChange,
        parent: parentKey,
        series: leaves,
        dissolved: plan.dissolved
      }),
      plan.actor
    );
    assigneeHistory(txApp, plan, ticket.id, assignee);
  }
}

// Tickets that stay behind while their rule moves lose the rule (they keep their history).
function detachStayingInstances(txApp, plan) {
  var each = eachReady(txApp);
  for (var i = 0; i < plan.analysis.ruleTickets.length; i++) {
    var ticket = findById(txApp, TICKETS, plan.analysis.ruleTickets[i].id);
    var ruleId = ticket.getString('recurrence');
    ticket.set('recurrence', '');
    if (each) {
      ticket.set('occurrence', '');
    }
    ticket.set(rules.MOVE_KEY, true);
    txApp.save(ticket);
    historyEntry(txApp, ticket.id, 'recurrence', ruleId, '', plan.actor);
  }
}

function moveItems(txApp, plan) {
  var inbox = require(__hooks + '/lib/inbox-service.js');
  var items = recordsOf(plan, 'items');
  for (var i = 0; i < items.length; i++) {
    var item = items[i];
    var note = plan.analysis.items[item.id];
    // The area it leaves keeps its fingerprint, so its channel does not bring the same object again
    // (E7-4b). A dissolved household is gone and keeps nothing.
    if (!plan.dissolved) {
      inbox.rememberMovedAway(txApp, plan.from.scope, item.getString('fingerprint'));
    }
    place(plan, item);
    if (note.connection) {
      item.set('connection', '');
    }
    if (note.target) {
      item.set('target_project', '');
    }
    if (note.duplicate) {
      item.set('fingerprint', String($security.sha256('moved|' + item.getString('fingerprint') + '|' + $security.randomString(24))));
    }
    item.set(rules.MOVE_KEY, true);
    txApp.save(item);
  }
}

// References from outside to moved projects go (ADR-0061 §2: no reference crosses the border).
function clearOutsideReferences(txApp, plan) {
  var recurrence = require(__hooks + '/lib/recurrence-service.js');
  var analysis = plan.analysis;
  var i;
  for (i = 0; i < analysis.rulesProject.length; i++) {
    var rule = findById(txApp, RULES, analysis.rulesProject[i].id);
    rule.set('project', '');
    rule.set(recurrence.SYSTEM_KEY, true);
    txApp.save(rule);
  }
  for (i = 0; i < analysis.outsideItems.length; i++) {
    var item = findById(txApp, ITEMS, analysis.outsideItems[i].id);
    item.set('target_project', '');
    item.set(rules.MOVE_KEY, true);
    txApp.save(item);
  }
  for (i = 0; i < analysis.outsideConnections.length; i++) {
    var connection = findById(txApp, CONNECTIONS, analysis.outsideConnections[i].id);
    connection.set('target_project', '');
    txApp.save(connection);
  }
  // Targets of repositories and folders of connections that stay (E7-4b); those that move along
  // took theirs in moveConnections.
  for (i = 0; i < analysis.unitTargets.length; i++) {
    if (has(plan, 'connections', analysis.unitTargets[i].id)) {
      continue;
    }
    var unitConnection = findById(txApp, CONNECTIONS, analysis.unitTargets[i].id);
    unitConnection.set('settings', analysis.unitTargets[i].settings);
    txApp.save(unitConnection);
  }
  if (analysis.userTargets.length > 0) {
    var user = findById(txApp, 'users', plan.actor);
    var cards = parsedObject(user.getString('inbox_targets')) || {};
    for (i = 0; i < analysis.userTargets.length; i++) {
      cards[analysis.userTargets[i]] = '';
    }
    user.set('inbox_targets', cards);
    txApp.save(user);
  }
}

// Dependencies between moved tickets move; those across the border are released (the choice), or,
// with "mitnehmen", only those whose other ticket could not come along (in the trash).
function settleDependencies(txApp, plan) {
  var moving = recordsOf(plan, 'dependencies');
  var i;
  for (i = 0; i < moving.length; i++) {
    // A dependency has owner and household, no scope (its hook reads the area from both).
    if (plan.direction === 'private') {
      moving[i].set('owner', plan.actor);
    }
    moving[i].set('household', plan.to.household);
    txApp.save(moving[i]);
  }
  for (i = 0; i < plan.crossing.length; i++) {
    var dependency = findById(txApp, DEPENDENCIES, plan.crossing[i].dependency.id);
    if (dependency !== null) {
      txApp.delete(dependency);
    }
  }
}

// Links of source and follow-up tickets across the border go, with "Quelle entfernt" and "Folge-Ticket
// entfernt" in the history of both tickets (QT-1, ADR-0067): all of them with "lösen", with
// "mitnehmen" those whose other ticket could not come along (in the trash). Links between moved
// tickets stay; they have no area of their own.
function settleTicketLinks(txApp, plan) {
  if (plan.crossingLinks.length === 0) {
    return;
  }
  var links = ticketLinks();
  for (var i = 0; i < plan.crossingLinks.length; i++) {
    var record = findById(txApp, 'ticket_sources', plan.crossingLinks[i].link.id);
    if (record !== null) {
      links.unlink(txApp, record, plan.actor);
    }
  }
}

// Connections of a dissolved household (only the admin UI ever made one, ADR-0059 §5) go to the owner.
function moveConnections(txApp, plan) {
  var connections = recordsOf(plan, 'connections');
  for (var i = 0; i < connections.length; i++) {
    var connection = connections[i];
    place(plan, connection);
    var target = connection.getString('target_project');
    if (target !== '' && !has(plan, 'projects', target)) {
      connection.set('target_project', '');
    }
    var settings = unitSettingsOf(plan, connection.id);
    if (settings !== null) {
      connection.set('settings', settings);
    }
    txApp.save(connection);
  }
}

/** All writes of a move in the transaction of the caller, after every check (ADR-0061 §1). */
function execute(txApp, plan, nowMs) {
  var i;
  for (i = 0; i < plan.analysis.series.length; i++) {
    releaseFromSeries(txApp, plan.analysis.series[i], nowMs);
  }
  for (i = 0; i < plan.analysis.ruleTickets.length; i++) {
    releaseFromSeries(txApp, plan.analysis.ruleTickets[i], nowMs);
  }
  moveProjects(txApp, plan);
  var mapTag = tagMapper(txApp, plan);
  moveRules(txApp, plan, mapTag);
  moveTickets(txApp, plan, mapTag);
  detachStayingInstances(txApp, plan);
  moveItems(txApp, plan);
  moveConnections(txApp, plan);
  clearOutsideReferences(txApp, plan);
  settleDependencies(txApp, plan);
  settleTicketLinks(txApp, plan);
  // A pin stays while its account still sees the ticket (ADR-0064); the others go.
  require(__hooks + '/lib/pin-service.js').releaseUnseen(txApp, plan.order.tickets.slice());
}

// --- Realtime ---------------------------------------------------------------------------------------

/**
 * Before the first write: every subscription of a tab that sees a record of the plan now (the rule
 * of a record of an area and the filter of the subscription, like trash-service broadcastRemoved).
 */
function watchersOf(app, txApp, plan) {
  var trash = require(__hooks + '/lib/trash-service.js');
  var watchers = [];
  var sets = [
    ['tickets', TICKETS],
    ['projects', PROJECTS],
    ['rules', RULES],
    ['items', ITEMS]
  ];
  try {
    var targets = trash.signedInClients(app);
    for (var t = 0; t < targets.length; t++) {
      var info = new RequestInfo({ auth: targets[t].auth });
      for (var s = 0; s < sets.length; s++) {
        var collection = sets[s][1];
        var subscriptions = targets[t].client.subscriptions(collection + '/');
        var names = [];
        for (var name in subscriptions) {
          names.push(name);
        }
        if (names.length === 0) {
          continue;
        }
        var records = recordsOf(plan, sets[s][0]);
        for (var r = 0; r < records.length; r++) {
          var record = records[r];
          if (!txApp.canAccessRecord(record, info, trash.VISIBLE_RULE)) {
            continue;
          }
          for (var n = 0; n < names.length; n++) {
            var base = names[n].split('?')[0];
            var subscribed = base === collection + '/*' || base === collection + '/' + record.id;
            if (subscribed && trash.matchesSubscription(txApp, record, info, names[n])) {
              watchers.push({ client: targets[t].client, auth: targets[t].auth, name: names[n], collection: collection, id: record.id });
            }
          }
        }
      }
    }
  } catch (err) {
    app.logger().warn(AREA + ': Abos vor dem Verschieben nicht gelesen', 'error', String(err));
  }
  return watchers;
}

/**
 * After the commit: the "delete" (marked `moved`) to every subscription that saw a moved record
 * before and does not see it now; PocketBase sends the update to those that see it now. Never throws.
 */
function sendLeft(app, watchers) {
  var trash = require(__hooks + '/lib/trash-service.js');
  for (var i = 0; i < watchers.length; i++) {
    var watcher = watchers[i];
    try {
      if (watcher.client.isDiscarded()) {
        continue;
      }
      var record = findById(app, watcher.collection, watcher.id);
      var info = new RequestInfo({ auth: watcher.auth });
      var still =
        record !== null && app.canAccessRecord(record, info, trash.VISIBLE_RULE) && trash.matchesSubscription(app, record, info, watcher.name);
      if (still) {
        continue;
      }
      var collectionId = record !== null ? record.collection().id : app.findCollectionByNameOrId(watcher.collection).id;
      watcher.client.send(
        new SubscriptionMessage({
          name: watcher.name,
          data: JSON.stringify({
            action: 'delete',
            record: { id: watcher.id, collectionId: collectionId, collectionName: watcher.collection, moved: true }
          })
        })
      );
    } catch (err) {
      app.logger().warn(AREA + ': Realtime-Hinweis nicht gesendet', 'error', String(err));
    }
  }
}

// --- Answers ------------------------------------------------------------------------------------------

function refuse(e, action, problem, params) {
  e.app.logger().warn(AREA + ': Anfrage abgelehnt', 'action', action, 'problem', problem, 'user', userOf(e));
  var answer = rules.problemBody(problem, params);
  e.response.header().set('Cache-Control', 'no-store');
  return e.json(answer.status, answer.body);
}

function audit(e, action, counts) {
  e.app
    .logger()
    .info(
      AREA + ': Aktion ausgeführt',
      'action',
      action,
      'user',
      userOf(e),
      'tickets',
      counts.tickets,
      'projects',
      counts.projects,
      'rules',
      counts.rules,
      'items',
      counts.items
    );
}

/** The result of a move: the new keys of the moved tickets and the codes of the moved projects. */
function movedOf(plan, previous) {
  var tickets = [];
  for (var i = 0; i < plan.order.tickets.length; i++) {
    var ticket = plan.sets.tickets[plan.order.tickets[i]];
    tickets.push({ id: ticket.id, key: ticket.getString('key'), previous: previous[ticket.id] || '' });
  }
  var projects = [];
  for (var j = 0; j < plan.order.projects.length; j++) {
    var project = plan.sets.projects[plan.order.projects[j]];
    projects.push({ id: project.id, code: project.getString('code') });
  }
  return { tickets: tickets, projects: projects, rules: plan.order.rules.slice(), items: plan.order.items.slice() };
}

/**
 * POST /api/byl/area/move (ADR-0061 §1): the preview, or the move in one transaction. Answers the
 * summary (with `moved` after a move) or a refusal { reason: "invalid", problem, params }.
 */
function move(e) {
  var input = rules.moveInput(e.requestInfo().body);
  if (input.problem) {
    return refuse(e, 'move', input.problem);
  }
  var actor = userOf(e);
  var outcome = { problem: '', params: null, summary: null, plan: null, watchers: [], previous: {} };
  var nowMs = Date.now();
  e.app.runInTransaction(function (txApp) {
    var household = householdOf(txApp, actor);
    if (household === null) {
      outcome.problem = 'no-household';
      return;
    }
    var mine = privateArea(actor);
    var shared = householdArea(household);
    var plan =
      input.to === 'household'
        ? newPlan(actor, mine, shared, false, false)
        : newPlan(actor, shared, mine, householdRules.may({ role: household.role, rights: household.rights }, 'move_out'), false);
    plan.series = input.series;
    plan.seriesDone = input.series_done;
    var problem = collect(txApp, plan, input.kind, input.ids, {
      dependencies: input.dependencies === 'take',
      sources: input.ticket_sources === 'take'
    });
    if (problem !== '') {
      outcome.problem = problem;
      return;
    }
    var violation = rightViolation(plan);
    if (violation !== null) {
      outcome.problem = 'right';
      outcome.params = violation;
      return;
    }
    analyse(txApp, plan);
    outcome.summary = summaryOf(txApp, plan, input);
    if (input.preview) {
      return;
    }
    var choice = choiceProblem(txApp, plan, input);
    if (choice !== null) {
      outcome.problem = choice.problem;
      outcome.params = choice.params || null;
      return;
    }
    for (var i = 0; i < plan.order.tickets.length; i++) {
      outcome.previous[plan.order.tickets[i]] = plan.sets.tickets[plan.order.tickets[i]].getString('key');
    }
    outcome.watchers = watchersOf(e.app, txApp, plan);
    execute(txApp, plan, nowMs);
    outcome.plan = plan;
  });
  if (outcome.problem !== '') {
    return refuse(e, 'move', outcome.problem, outcome.params);
  }
  var summary = outcome.summary;
  if (outcome.plan !== null) {
    sendLeft(e.app, outcome.watchers);
    summary.moved = movedOf(outcome.plan, outcome.previous);
    audit(e, 'move-' + input.kind + '-' + input.to, summary.counts);
  }
  e.response.header().set('Cache-Control', 'no-store');
  return e.json(200, summary);
}

// --- Dissolving a household (ADR-0061 §5) -------------------------------------------------------------

function namesOf(app, members, actor) {
  var list = [];
  for (var i = 0; i < members.length; i++) {
    var user = findById(app, 'users', members[i].getString('user'));
    list.push({
      name: user ? user.getString('name') : '',
      role: members[i].getString('role') === householdRules.OWNER ? householdRules.OWNER : householdRules.MEMBER,
      self: members[i].getString('user') === actor
    });
  }
  return list;
}

function countIn(txApp, collection, filter, params) {
  return txApp.findRecordsByFilter(collection, filter, '', 0, 0, params).length;
}

/** What a household holds, for the preview of dissolving. */
function householdCounts(txApp, householdId) {
  var scope = ticketKey.scopeOf('', householdId);
  var params = { scope: scope, h: householdId };
  var tickets = txApp.findRecordsByFilter(TICKETS, 'scope = {:scope}', '', 0, 0, params);
  var live = 0;
  var comments = 0;
  for (var i = 0; i < tickets.length; i++) {
    if (!isTrashed(tickets[i])) {
      live += 1;
    }
    comments += txApp.countRecords('comments', $dbx.hashExp({ ticket: tickets[i].id }));
  }
  return {
    tickets: live,
    trash: tickets.length - live,
    projects: countIn(txApp, PROJECTS, 'scope = {:scope}', params),
    rules: countIn(txApp, RULES, 'scope = {:scope}', params),
    items: countIn(txApp, ITEMS, 'scope = {:scope}', params),
    tags: countIn(txApp, TAGS, 'household = {:h}', params),
    connections: countIn(txApp, CONNECTIONS, 'household = {:h}', params),
    comments: comments
  };
}

// Deletes everything of a household for good, in an order the hooks accept: dependencies and entries
// first, sub-tasks before their tickets, sub projects before their projects.
function deleteHouseholdRecords(txApp, householdId) {
  var scope = ticketKey.scopeOf('', householdId);
  var steps = [
    [DEPENDENCIES, 'household = {:h}'],
    [ITEMS, 'scope = {:scope}'],
    [TICKETS, "scope = {:scope} && parent != ''"],
    [TICKETS, 'scope = {:scope}'],
    [RULES, 'scope = {:scope}'],
    [PROJECTS, "scope = {:scope} && parent != ''"],
    [PROJECTS, 'scope = {:scope}'],
    [TAGS, 'household = {:h}'],
    [CONNECTIONS, 'household = {:h}']
  ];
  for (var i = 0; i < steps.length; i++) {
    var found = listOf(txApp.findRecordsByFilter(steps[i][0], steps[i][1], 'created,id', 0, 0, { scope: scope, h: householdId }));
    for (var j = 0; j < found.length; j++) {
      txApp.delete(found[j]);
    }
  }
}

// The household itself: its counters, codes, memberships and record. Nothing of it may stay behind:
// PocketBase would only empty the field `household` of a record that still names it.
function removeHousehold(txApp, householdId) {
  txApp
    .db()
    .newQuery('DELETE FROM ticket_counters WHERE key LIKE {:prefix}')
    .bind({ prefix: ticketKey.scopeOf('', householdId) + ':%' })
    .execute();
  // What the household kept of entries that left it (E7-4b); fingerprints its entries left in other
  // areas stay there.
  require(__hooks + '/lib/inbox-service.js').forgetMovedAway(txApp, ticketKey.scopeOf('', householdId));
  var lists = [INVITES, MEMBERS];
  for (var i = 0; i < lists.length; i++) {
    var found = listOf(txApp.findRecordsByFilter(lists[i], 'household = {:h}', 'created,id', 0, 0, { h: householdId }));
    for (var j = 0; j < found.length; j++) {
      txApp.delete(found[j]);
    }
  }
  txApp.delete(txApp.findRecordById(HOUSEHOLDS, householdId));
}

/**
 * Deletes a household for good: everything it holds, then the household itself. One logic for
 * dissolving (after `adopt` moved everything out, or with `delete`) and for the administrator of the
 * app deleting an orphaned household (E7-4c, lib/account-service.js). Runs inside the transaction
 * of the caller.
 */
function deleteHousehold(txApp, householdId) {
  deleteHouseholdRecords(txApp, householdId);
  removeHousehold(txApp, householdId);
}

/**
 * POST /api/byl/household/dissolve { mode, preview?, name? } (ADR-0061 §5): only the owner. The
 * preview names the household, its members, what it holds and, for `adopt`, the codes that get a
 * suffix; `adopt` moves everything into the private area of the owner, `delete` deletes it for good
 * when `name` is the name of the household. Then the household goes with its memberships and codes.
 */
function dissolve(e) {
  var input = rules.dissolveInput(e.requestInfo().body);
  if (input.problem) {
    return refuse(e, 'dissolve', input.problem);
  }
  var actor = userOf(e);
  var outcome = { problem: '', body: null, notify: [], household: '', counts: null };
  e.app.runInTransaction(function (txApp) {
    var household = householdOf(txApp, actor);
    if (household === null) {
      outcome.problem = 'no-household';
      return;
    }
    if (household.role !== householdRules.OWNER) {
      outcome.problem = 'owner-only';
      return;
    }
    outcome.household = household.id;
    var members = listOf(txApp.findRecordsByFilter(MEMBERS, 'household = {:h}', 'created,id', 0, 0, { h: household.id }));
    var plan = newPlan(actor, householdArea(household), privateArea(actor), true, true);
    collectHousehold(txApp, plan);
    analyse(txApp, plan);
    var counts = householdCounts(txApp, household.id);
    outcome.counts = counts;
    outcome.body = {
      preview: input.preview,
      mode: input.mode,
      household: { id: household.id, name: household.name },
      members: namesOf(txApp, members, actor),
      counts: counts,
      codes: input.mode === 'adopt' ? codeSuggestions(txApp, plan) : []
    };
    if (input.preview) {
      return;
    }
    if (input.mode === 'delete') {
      if (!rules.nameConfirmed(input.name, household.name)) {
        outcome.problem = 'dissolve-name';
        return;
      }
    } else {
      var codes = decideCodes(txApp, plan, {});
      if (codes !== null) {
        throw new Error('Kein freier Code für ein Projekt des Haushalts gefunden.');
      }
      execute(txApp, plan, Date.now());
    }
    for (var i = 0; i < members.length; i++) {
      if (outcome.notify.indexOf(members[i].getString('user')) === -1) {
        outcome.notify.push(members[i].getString('user'));
      }
    }
    deleteHousehold(txApp, household.id);
  });
  if (outcome.problem !== '') {
    return refuse(e, 'dissolve', outcome.problem);
  }
  if (!input.preview) {
    var household = require(__hooks + '/lib/household-service.js');
    household.notify(e.app, outcome.notify, { dissolved: true });
    require(__hooks + '/lib/trash-service.js').notifyTrash(e.app, [actor]);
    e.app.logger().info('byl-household: Aktion ausgeführt', 'action', 'dissolve-' + input.mode, 'user', actor, 'household', outcome.household);
  }
  e.response.header().set('Cache-Control', 'no-store');
  return e.json(200, outcome.body);
}

/**
 * The tags of `ids` by name against the area `scope` (MV-2, duplicating into another area), as the
 * preview names them: { reused, created }.
 */
function tagPreviewIn(txApp, ids, scope) {
  var names = [];
  for (var i = 0; i < ids.length; i++) {
    var tag = findById(txApp, TAGS, ids[i]);
    if (tag !== null) {
      names.push(tag.getString('name'));
    }
  }
  var known = tagNamesIn(txApp, scope);
  var targetNames = [];
  for (var lower in known) {
    if (Object.prototype.hasOwnProperty.call(known, lower)) {
      targetNames.push(lower);
    }
  }
  return rules.tagMapping(names, targetNames);
}

module.exports = {
  move: move,
  dissolve: dissolve,
  householdOf: householdOf,
  householdCounts: householdCounts,
  deleteHousehold: deleteHousehold,
  tagMapperIn: tagMapperIn,
  tagPreviewIn: tagPreviewIn
};
