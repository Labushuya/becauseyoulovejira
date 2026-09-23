/// <reference path="../pb_data/types.d.ts" />
// E1 plan, package 3, step 5: tickets (CLAUDE.md section 5, OF-6, OF-10, OF-11).
// number, key, scope and completed_at are maintained by hooks (packages 5 and 6); the default
// of blocks_parent (true) is set by the create hook because bool fields have no default.
// The self relation parent needs the collection id, so it is added after the first save.
// All API rules stay null (superuser only) until package 4.
migrate(
  function (app) {
    var users = app.findCollectionByNameOrId('users');
    var households = app.findCollectionByNameOrId('households');
    var projects = app.findCollectionByNameOrId('projects');
    var tags = app.findCollectionByNameOrId('tags');
    var rules = app.findCollectionByNameOrId('recurrence_rules');

    var tickets = new Collection({
      type: 'base',
      name: 'tickets',
      listRule: null,
      viewRule: null,
      createRule: null,
      updateRule: null,
      deleteRule: null,
      fields: [
        { type: 'number', name: 'number', onlyInt: true, min: 1 },
        { type: 'text', name: 'key' },
        { type: 'text', name: 'title', required: true, max: 200 },
        { type: 'text', name: 'description', max: 100000 },
        {
          type: 'select',
          name: 'status',
          required: true,
          values: ['backlog', 'open', 'in_progress', 'waiting', 'done'],
          maxSelect: 1
        },
        {
          type: 'select',
          name: 'priority',
          required: true,
          values: ['low', 'medium', 'high', 'urgent'],
          maxSelect: 1
        },
        { type: 'date', name: 'due' },
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
        { type: 'date', name: 'completed_at' },
        { type: 'bool', name: 'blocks_parent' },
        {
          type: 'relation',
          name: 'recurrence',
          required: false,
          collectionId: rules.id,
          cascadeDelete: false,
          maxSelect: 1
        },
        { type: 'text', name: 'scope' },
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
        'CREATE UNIQUE INDEX idx_tickets_scope_key ON tickets (scope, key)',
        'CREATE INDEX idx_tickets_owner ON tickets (owner)',
        'CREATE INDEX idx_tickets_project ON tickets (project)',
        'CREATE INDEX idx_tickets_status ON tickets (status)',
        'CREATE INDEX idx_tickets_due ON tickets (due)'
      ]
    });
    app.save(tickets);

    tickets.fields.add(
      new RelationField({
        name: 'parent',
        required: false,
        collectionId: tickets.id,
        cascadeDelete: false,
        maxSelect: 1
      })
    );
    tickets.addIndex('idx_tickets_parent', false, 'parent', '');
    app.save(tickets);
  },
  function (app) {
    app.delete(app.findCollectionByNameOrId('tickets'));
  }
);
