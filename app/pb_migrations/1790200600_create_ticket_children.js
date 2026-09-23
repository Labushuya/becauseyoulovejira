/// <reference path="../pb_data/types.d.ts" />
// E1 plan, package 3, step 6: comments, ticket_history and dependencies (OF-4, OF-5, OF-6).
// All three cascade with their ticket. comments and ticket_history carry no owner/household;
// their visibility follows the ticket (OF-5).
// All API rules stay null (superuser only) until package 4.
migrate(
  function (app) {
    var users = app.findCollectionByNameOrId('users');
    var households = app.findCollectionByNameOrId('households');
    var tickets = app.findCollectionByNameOrId('tickets');

    function ticketRelation(name) {
      return {
        type: 'relation',
        name: name,
        required: true,
        collectionId: tickets.id,
        cascadeDelete: true,
        maxSelect: 1
      };
    }

    var comments = new Collection({
      type: 'base',
      name: 'comments',
      listRule: null,
      viewRule: null,
      createRule: null,
      updateRule: null,
      deleteRule: null,
      fields: [
        ticketRelation('ticket'),
        {
          type: 'relation',
          name: 'author',
          required: true,
          collectionId: users.id,
          cascadeDelete: false,
          maxSelect: 1
        },
        { type: 'text', name: 'body', required: true, max: 20000 },
        { type: 'autodate', name: 'created', onCreate: true, onUpdate: false },
        { type: 'autodate', name: 'updated', onCreate: true, onUpdate: true }
      ],
      indexes: ['CREATE INDEX idx_comments_ticket_created ON comments (ticket, created)']
    });
    app.save(comments);

    // old_value/new_value hold whole descriptions (max 100000, OF-10), hence the same limit.
    var history = new Collection({
      type: 'base',
      name: 'ticket_history',
      listRule: null,
      viewRule: null,
      createRule: null,
      updateRule: null,
      deleteRule: null,
      fields: [
        ticketRelation('ticket'),
        { type: 'text', name: 'field', required: true, max: 50 },
        { type: 'text', name: 'old_value', max: 100000 },
        { type: 'text', name: 'new_value', max: 100000 },
        {
          type: 'relation',
          name: 'user',
          required: false,
          collectionId: users.id,
          cascadeDelete: false,
          maxSelect: 1
        },
        { type: 'autodate', name: 'created', onCreate: true, onUpdate: false }
      ],
      indexes: ['CREATE INDEX idx_ticket_history_ticket_created ON ticket_history (ticket, created)']
    });
    app.save(history);

    var dependencies = new Collection({
      type: 'base',
      name: 'dependencies',
      listRule: null,
      viewRule: null,
      createRule: null,
      updateRule: null,
      deleteRule: null,
      fields: [
        ticketRelation('blocker'),
        ticketRelation('blocked'),
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
        'CREATE UNIQUE INDEX idx_dependencies_blocker_blocked ON dependencies (blocker, blocked)'
      ]
    });
    app.save(dependencies);
  },
  function (app) {
    app.delete(app.findCollectionByNameOrId('dependencies'));
    app.delete(app.findCollectionByNameOrId('ticket_history'));
    app.delete(app.findCollectionByNameOrId('comments'));
  }
);
