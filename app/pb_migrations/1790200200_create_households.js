/// <reference path="../pb_data/types.d.ts" />
// E1 plan, package 3, step 2: households and household_members (OF-6, OF-7).
// All API rules stay null (superuser only) until package 4.
migrate(
  function (app) {
    var users = app.findCollectionByNameOrId('users');

    var households = new Collection({
      type: 'base',
      name: 'households',
      listRule: null,
      viewRule: null,
      createRule: null,
      updateRule: null,
      deleteRule: null,
      fields: [
        { type: 'text', name: 'name', required: true, max: 100 },
        { type: 'autodate', name: 'created', onCreate: true, onUpdate: false },
        { type: 'autodate', name: 'updated', onCreate: true, onUpdate: true }
      ]
    });
    app.save(households);

    var members = new Collection({
      type: 'base',
      name: 'household_members',
      listRule: null,
      viewRule: null,
      createRule: null,
      updateRule: null,
      deleteRule: null,
      fields: [
        {
          type: 'relation',
          name: 'user',
          required: true,
          collectionId: users.id,
          cascadeDelete: true,
          maxSelect: 1
        },
        {
          type: 'relation',
          name: 'household',
          required: true,
          collectionId: households.id,
          cascadeDelete: true,
          maxSelect: 1
        },
        { type: 'select', name: 'role', required: true, values: ['owner', 'member'], maxSelect: 1 },
        { type: 'autodate', name: 'created', onCreate: true, onUpdate: false },
        { type: 'autodate', name: 'updated', onCreate: true, onUpdate: true }
      ],
      indexes: [
        'CREATE UNIQUE INDEX idx_household_members_household_user ON household_members (household, user)'
      ]
    });
    app.save(members);
  },
  function (app) {
    app.delete(app.findCollectionByNameOrId('household_members'));
    app.delete(app.findCollectionByNameOrId('households'));
  }
);
