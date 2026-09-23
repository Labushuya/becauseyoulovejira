/// <reference path="../pb_data/types.d.ts" />
// E1 plan, package 3, step 3: projects and tags (OF-6, OF-8, OF-10).
// scope is set by hooks (package 5). The reserved project code TASK (OF-14) cannot be expressed
// with the RE2 pattern and is rejected by the project hook.
// All API rules stay null (superuser only) until package 4.
migrate(
  function (app) {
    var users = app.findCollectionByNameOrId('users');
    var households = app.findCollectionByNameOrId('households');

    function ownershipFields() {
      return [
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
        { type: 'text', name: 'scope' },
        { type: 'autodate', name: 'created', onCreate: true, onUpdate: false },
        { type: 'autodate', name: 'updated', onCreate: true, onUpdate: true }
      ];
    }

    var projects = new Collection({
      type: 'base',
      name: 'projects',
      listRule: null,
      viewRule: null,
      createRule: null,
      updateRule: null,
      deleteRule: null,
      fields: [
        { type: 'text', name: 'name', required: true, max: 100 },
        { type: 'text', name: 'code', required: true, max: 6, pattern: '^[A-Z]{2,6}$' },
        { type: 'bool', name: 'archived' }
      ].concat(ownershipFields()),
      indexes: [
        'CREATE UNIQUE INDEX idx_projects_scope_code ON projects (scope, code)',
        'CREATE INDEX idx_projects_owner ON projects (owner)'
      ]
    });
    app.save(projects);

    var tags = new Collection({
      type: 'base',
      name: 'tags',
      listRule: null,
      viewRule: null,
      createRule: null,
      updateRule: null,
      deleteRule: null,
      fields: [{ type: 'text', name: 'name', required: true, max: 50 }].concat(ownershipFields()),
      indexes: ['CREATE UNIQUE INDEX idx_tags_scope_name ON tags (scope, name COLLATE NOCASE)']
    });
    app.save(tags);
  },
  function (app) {
    app.delete(app.findCollectionByNameOrId('tags'));
    app.delete(app.findCollectionByNameOrId('projects'));
  }
);
