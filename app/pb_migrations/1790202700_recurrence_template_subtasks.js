/// <reference path="../pb_data/types.d.ts" />
// Sub-tasks in the template of a rule (plan "Wiederholungen: Werte von Folgetickets", WV-3;
// ADR-0022 addendum 10): every next ticket of a series gets them as new, open sub-tasks.
//
// - recurrence_rules.template_subtasks (json, not required): a list of at most 20 entries
//   { title, priority }. The hook checks and normalizes it (lib/recurrence-rules.js
//   templateSubtasksCheck: title required, at most 200 characters, priority low | medium | high |
//   urgent); maxSize only guards the column (20 titles of 200 characters, even escaped).
//
// Additive: no row changes. An empty value means "no sub-tasks", the behaviour of before; the hooks
// and the SPA read it that way. The down migration removes the field with its values; the tickets
// and sub-tasks made meanwhile stay as they are.
migrate(
  function (app) {
    var rules = app.findCollectionByNameOrId('recurrence_rules');
    rules.fields.add(new JSONField({ name: 'template_subtasks', required: false, maxSize: 40000 }));
    app.save(rules);
  },
  function (app) {
    var rules = app.findCollectionByNameOrId('recurrence_rules');
    rules.fields.removeByName('template_subtasks');
    app.save(rules);
  }
);
