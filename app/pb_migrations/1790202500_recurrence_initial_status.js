/// <reference path="../pb_data/types.d.ts" />
// "Status beim Anlegen" of the template of a rule (plan "Wiederholungen: Werte von Folgetickets",
// WV; ADR-0022 addendum 8): the status the next tickets of a series start with, instead of always
// "open".
//
// - recurrence_rules.initial_status (select backlog | open | in_progress | waiting, not required).
//   "done" is no value: a new ticket that is done at once would never be an open instance.
//
// Additive: no row changes. An empty value means "open", the behaviour of before; the hooks and
// the SPA read it that way (lib/recurrence-rules.js initialStatusOf, domain/series-template.ts),
// and the create hook stores "open" for new rules. The down migration removes the field; the
// tickets made meanwhile keep their status, the rules go back to "open" for their next tickets.
var STATUSES = ['backlog', 'open', 'in_progress', 'waiting'];

migrate(
  function (app) {
    var rules = app.findCollectionByNameOrId('recurrence_rules');
    rules.fields.add(new SelectField({ name: 'initial_status', required: false, values: STATUSES, maxSelect: 1 }));
    app.save(rules);
  },
  function (app) {
    var rules = app.findCollectionByNameOrId('recurrence_rules');
    rules.fields.removeByName('initial_status');
    app.save(rules);
  }
);
