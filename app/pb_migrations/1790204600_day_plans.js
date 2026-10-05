/// <reference path="../pb_data/types.d.ts" />
// The day plan (TP-1, ADR-0065): the bridge between the tasks of a day and long-running projects.
//
// - tickets.kind: "Aufgabe" (`task`, the default) or "Laufendes Vorhaben" (`ongoing`). The kind alone
//   decides what a check mark in the plan means. Every ticket of before becomes a task (plain SQL, so
//   `updated` and the history stay); the hooks give every new ticket `task` unless it names a kind.
// - day_plans: one plan per area and day (scope, date `YYYY-MM-DD`; unique), private per account or
//   shared per household like every record with an area (owner, household, scope; ADR-0058/0059).
//   `dismissed` lists the tickets removed from the plan that day, so a source does not bring them
//   back. Created lazily by the routes (lib/day-plan-service.js), never by a client.
// - day_plan_items: one entry per plan and ticket (unique) with its position, where it came from
//   (`origin`), whether it was checked for the day (`done_today`, `done_at`) and who added and who
//   checked it. A ticket deleted for good takes its entries along (cascade), so does a plan.
// - day_plan_settings: the modes of the sources of suggestions per area (JSON `sources`, unique per
//   scope); missing sources keep their defaults (lib/day-plan-rules.js).
//
// Reading follows the rule of the area (the plan for its entries); every write goes through the routes
// of app/pb_hooks/day-plans.pb.js (create, update and delete rules null). A household that goes takes
// its plans and settings along (cascade). Down: the three collections and the field go; only the
// plans, their settings and the kinds are lost.
var ORIGINS = ['manual', 'due_today', 'overdue', 'recurrence', 'leftover', 'in_progress', 'ongoing'];

migrate(
  function (app) {
    var users = app.findCollectionByNameOrId('users');
    var households = app.findCollectionByNameOrId('households');
    var tickets = app.findCollectionByNameOrId('tickets');

    tickets.fields.add(new SelectField({ name: 'kind', required: false, values: ['task', 'ongoing'], maxSelect: 1 }));
    app.save(tickets);
    app.db().newQuery("UPDATE tickets SET kind = 'task' WHERE kind = '' OR kind IS NULL").execute();

    var AUTH = '@request.auth.id != ""';
    function member(ref) {
      return '@collection.household_members.household ?= ' + ref + ' && @collection.household_members.user ?= @request.auth.id';
    }
    var OWNED = AUTH + ' && ((owner = @request.auth.id && household = "") || (household != "" && ' + member('household') + '))';
    var PLAN_VISIBLE =
      AUTH +
      ' && ((plan.owner = @request.auth.id && plan.household = "") || (plan.household != "" && ' +
      member('plan.household') +
      '))';

    function areaFields() {
      return [
        { type: 'text', name: 'scope', required: true, max: 100 },
        { type: 'relation', name: 'owner', required: true, collectionId: users.id, cascadeDelete: false, maxSelect: 1 },
        { type: 'relation', name: 'household', required: false, collectionId: households.id, cascadeDelete: true, maxSelect: 1 }
      ];
    }
    var autodates = [
      { type: 'autodate', name: 'created', onCreate: true, onUpdate: false },
      { type: 'autodate', name: 'updated', onCreate: true, onUpdate: true }
    ];

    var plans = new Collection({
      type: 'base',
      name: 'day_plans',
      listRule: OWNED,
      viewRule: OWNED,
      createRule: null,
      updateRule: null,
      deleteRule: null,
      fields: [
        { type: 'text', name: 'date', required: true, min: 10, max: 10, pattern: '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' },
        { type: 'json', name: 'dismissed', maxSize: 200000 }
      ]
        .concat(areaFields())
        .concat(autodates),
      indexes: [
        'CREATE UNIQUE INDEX idx_day_plans_scope_date ON day_plans (scope, date)',
        'CREATE INDEX idx_day_plans_owner ON day_plans (owner)',
        'CREATE INDEX idx_day_plans_household ON day_plans (household)'
      ]
    });
    app.save(plans);

    var items = new Collection({
      type: 'base',
      name: 'day_plan_items',
      listRule: PLAN_VISIBLE,
      viewRule: PLAN_VISIBLE,
      createRule: null,
      updateRule: null,
      deleteRule: null,
      fields: [
        { type: 'relation', name: 'plan', required: true, collectionId: plans.id, cascadeDelete: true, maxSelect: 1 },
        { type: 'relation', name: 'ticket', required: true, collectionId: tickets.id, cascadeDelete: true, maxSelect: 1 },
        { type: 'number', name: 'position', required: false, onlyInt: true, min: 0 },
        { type: 'select', name: 'origin', required: true, values: ORIGINS, maxSelect: 1 },
        { type: 'bool', name: 'done_today' },
        { type: 'date', name: 'done_at' },
        { type: 'relation', name: 'added_by', required: false, collectionId: users.id, cascadeDelete: false, maxSelect: 1 },
        { type: 'relation', name: 'checked_by', required: false, collectionId: users.id, cascadeDelete: false, maxSelect: 1 }
      ].concat(autodates),
      indexes: [
        'CREATE UNIQUE INDEX idx_day_plan_items_plan_ticket ON day_plan_items (plan, ticket)',
        'CREATE INDEX idx_day_plan_items_ticket ON day_plan_items (ticket)'
      ]
    });
    app.save(items);

    var settings = new Collection({
      type: 'base',
      name: 'day_plan_settings',
      listRule: OWNED,
      viewRule: OWNED,
      createRule: null,
      updateRule: null,
      deleteRule: null,
      fields: [{ type: 'json', name: 'sources', maxSize: 2000 }].concat(areaFields()).concat(autodates),
      indexes: ['CREATE UNIQUE INDEX idx_day_plan_settings_scope ON day_plan_settings (scope)']
    });
    app.save(settings);
  },
  function (app) {
    var names = ['day_plan_settings', 'day_plan_items', 'day_plans'];
    for (var i = 0; i < names.length; i++) {
      app.delete(app.findCollectionByNameOrId(names[i]));
    }
    var tickets = app.findCollectionByNameOrId('tickets');
    tickets.fields.removeByName('kind');
    app.save(tickets);
  }
);
