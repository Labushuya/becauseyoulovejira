/// <reference path="../pb_data/types.d.ts" />
// E1 plan, package 3, step 4: recurrence_rules with the base fields only. The rule parameters
// follow in E4 as an additive migration (OF-9).
// All API rules stay null (superuser only) until package 4.
migrate(
  function (app) {
    var users = app.findCollectionByNameOrId('users');
    var households = app.findCollectionByNameOrId('households');
    var projects = app.findCollectionByNameOrId('projects');
    var tags = app.findCollectionByNameOrId('tags');

    var rules = new Collection({
      type: 'base',
      name: 'recurrence_rules',
      listRule: null,
      viewRule: null,
      createRule: null,
      updateRule: null,
      deleteRule: null,
      fields: [
        { type: 'text', name: 'title', required: true, max: 200 },
        { type: 'text', name: 'description', max: 100000 },
        {
          type: 'relation',
          name: 'project',
          required: false,
          collectionId: projects.id,
          cascadeDelete: false,
          maxSelect: 1
        },
        {
          type: 'relation',
          name: 'tags',
          required: false,
          collectionId: tags.id,
          cascadeDelete: false,
          maxSelect: 100
        },
        {
          type: 'select',
          name: 'priority',
          required: false,
          values: ['low', 'medium', 'high', 'urgent'],
          maxSelect: 1
        },
        {
          type: 'select',
          name: 'mode',
          required: true,
          values: ['calendar', 'after_completion'],
          maxSelect: 1
        },
        { type: 'date', name: 'next_due' },
        { type: 'date', name: 'last_generated_at' },
        { type: 'bool', name: 'active' },
        {
          type: 'relation',
          name: 'owner',
          required: true,
          collectionId: users.id,
          cascadeDelete: false,
          maxSelect: 1
        },
        {
          type: 'relation',
          name: 'household',
          required: false,
          collectionId: households.id,
          cascadeDelete: false,
          maxSelect: 1
        },
        { type: 'autodate', name: 'created', onCreate: true, onUpdate: false },
        { type: 'autodate', name: 'updated', onCreate: true, onUpdate: true }
      ],
      indexes: [
        'CREATE INDEX idx_recurrence_rules_owner ON recurrence_rules (owner)',
        'CREATE INDEX idx_recurrence_rules_active_next_due ON recurrence_rules (active, next_due)'
      ]
    });
    app.save(rules);
  },
  function (app) {
    app.delete(app.findCollectionByNameOrId('recurrence_rules'));
  }
);
