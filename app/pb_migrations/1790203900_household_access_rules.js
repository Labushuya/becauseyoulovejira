/// <reference path="../pb_data/types.d.ts" />
// Access to household records only through the current membership (ADR-0058 §5, E7-2). Only API
// rules change; no record is touched.
//
// Since 1790200900 a record was visible to its owner OR to the members of its household. Whoever
// left a household or was removed from it kept every household record he had created: list, view,
// update, delete and realtime. Now the owner branch holds for private records only
// (household = ""); a household record is reached through the membership alone. The same for what
// is visible through its ticket (comments, history, read rows on create).
//
// Every rule is changed by replacing exactly the owner branch, so the conditions of later
// migrations (trash, delete guards) stay as they are. A rule that does not contain the branch
// (changed in the admin UI) stays untouched. Down: the branch as before.
var COLLECTIONS = [
  'projects',
  'tags',
  'recurrence_rules',
  'tickets',
  'inbox_items',
  'connections',
  'dependencies',
  'comments',
  'ticket_history',
  'ticket_reads'
];
var RULES = ['listRule', 'viewRule', 'createRule', 'updateRule', 'deleteRule'];
// [before, after] of the owner branch of a record and of a record through its ticket.
var BRANCHES = [
  ['(owner = @request.auth.id || (household != ""', '((owner = @request.auth.id && household = "") || (household != ""'],
  [
    '(ticket.owner = @request.auth.id || (ticket.household != ""',
    '((ticket.owner = @request.auth.id && ticket.household = "") || (ticket.household != ""'
  ]
];

function replaceAll(text, from, to) {
  return text.split(from).join(to);
}

// from = 0 replaces the old branch by the new one, from = 1 the way back.
function rewrite(app, from) {
  var to = 1 - from;
  for (var i = 0; i < COLLECTIONS.length; i++) {
    var collection = app.findCollectionByNameOrId(COLLECTIONS[i]);
    var changed = false;
    for (var r = 0; r < RULES.length; r++) {
      var value = collection[RULES[r]];
      if (value === null || value === undefined) {
        continue;
      }
      // The rule is a *string in the JSVM; String() gives its text.
      var text = String(value);
      var next = text;
      for (var b = 0; b < BRANCHES.length; b++) {
        next = replaceAll(next, BRANCHES[b][from], BRANCHES[b][to]);
      }
      if (next !== text) {
        collection[RULES[r]] = next;
        changed = true;
      }
    }
    if (changed) {
      app.save(collection);
    }
  }
}

migrate(
  function (app) {
    rewrite(app, 0);
  },
  function (app) {
    rewrite(app, 1);
  }
);
