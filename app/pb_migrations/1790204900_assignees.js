/// <reference path="../pb_data/types.d.ts" />
// "Zuständig" in the household (E7-5, ADR-0068). Additive: new fields, no row changes.
//
// - tickets.assignee: the one account that takes care of a ticket of a household, or none. Only a
//   current member of the household of the ticket; a private ticket never has one (the hooks of
//   lib/assignee-service.js check it for every writer). The index serves the card "Mir zugewiesen",
//   the filter "Zuständig" and the cleanup when a membership ends.
// - tickets.assigned_at: when another account than the assignee gave the ticket to him. Only the
//   hooks write it; with it a ticket counts as new for its assignee again ("neu", ADR-0015), also
//   when it was created before his base line.
// - recurrence_rules.assignee_mode (`fixed` | `rotate`, empty = none), assignees (the person of
//   `fixed`, the ordered list of `rotate`) and assignee_next (index of the person of the next new
//   occurrence in that list, the stored pointer of the rotation): every new ticket of a rule of a
//   household gets its person by the mode.
// - day_plan_items.origin: the new source "Mir zugewiesen" (`assigned`) of the day plan (ADR-0065).
//
// Down: the fields and the index go, entries of the day plan that came from the new source become
// "manual" (the way back of its value); only the assignments and rotations are lost.
var ORIGINS_BEFORE = ['manual', 'due_today', 'overdue', 'recurrence', 'leftover', 'in_progress', 'ongoing'];
var ASSIGNED = 'assigned';
// At most this many people in a rotation (lib/assignee-rules.js ASSIGNEES_MAX).
var ASSIGNEES_MAX = 10;

function setOrigins(app, values) {
  var items = app.findCollectionByNameOrId('day_plan_items');
  items.fields.getByName('origin').values = values;
  app.save(items);
}

migrate(
  function (app) {
    var users = app.findCollectionByNameOrId('users');

    var tickets = app.findCollectionByNameOrId('tickets');
    tickets.fields.add(
      new RelationField({ name: 'assignee', required: false, collectionId: users.id, cascadeDelete: false, maxSelect: 1 })
    );
    tickets.fields.add(new DateField({ name: 'assigned_at', required: false }));
    tickets.addIndex('idx_tickets_assignee', false, 'assignee', '');
    app.save(tickets);

    var rules = app.findCollectionByNameOrId('recurrence_rules');
    rules.fields.add(new SelectField({ name: 'assignee_mode', required: false, values: ['fixed', 'rotate'], maxSelect: 1 }));
    rules.fields.add(
      new RelationField({
        name: 'assignees',
        required: false,
        collectionId: users.id,
        cascadeDelete: false,
        maxSelect: ASSIGNEES_MAX
      })
    );
    rules.fields.add(new NumberField({ name: 'assignee_next', required: false, onlyInt: true, min: 0 }));
    app.save(rules);

    setOrigins(app, ORIGINS_BEFORE.concat([ASSIGNED]));
  },
  function (app) {
    app.db().newQuery('UPDATE day_plan_items SET origin = {:manual} WHERE origin = {:origin}').bind({ manual: 'manual', origin: ASSIGNED }).execute();
    setOrigins(app, ORIGINS_BEFORE.slice());

    var rules = app.findCollectionByNameOrId('recurrence_rules');
    rules.fields.removeByName('assignee_next');
    rules.fields.removeByName('assignees');
    rules.fields.removeByName('assignee_mode');
    app.save(rules);

    var tickets = app.findCollectionByNameOrId('tickets');
    tickets.removeIndex('idx_tickets_assignee');
    tickets.fields.removeByName('assigned_at');
    tickets.fields.removeByName('assignee');
    app.save(tickets);
  }
);
