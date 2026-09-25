/// <reference path="../pb_data/types.d.ts" />
// E4 plan, package 1: the inbox (ADR-0014 section 1). Additive: a new collection, no change to
// existing records. scope and fingerprint are set by the hook in app/pb_hooks/inbox.pb.js before
// validation, so they are required from the start (as in 1790201000_require_hook_fields.js): a
// record without them fails loudly instead of slipping past the unique index.
// The relation `connection` (ADR-0016) follows with the collection `connections` (package 10).
// API rules stay null until 1790201220_inbox_api_rules.js.
// The value lists are mirrored in app/pb_hooks/lib/source.js (tests/unit/source.test.mjs).
migrate(
  function (app) {
    var users = app.findCollectionByNameOrId('users');
    var households = app.findCollectionByNameOrId('households');
    var tickets = app.findCollectionByNameOrId('tickets');

    var inbox = new Collection({
      type: 'base',
      name: 'inbox_items',
      listRule: null,
      viewRule: null,
      createRule: null,
      updateRule: null,
      deleteRule: null,
      fields: [
        {
          type: 'select',
          name: 'channel',
          required: true,
          values: [
            'manual',
            'quick',
            'clipboard',
            'link',
            'eml',
            'mail',
            'ics',
            'calendar',
            'whatsapp',
            'telegram',
            'notion'
          ],
          maxSelect: 1
        },
        {
          type: 'select',
          name: 'kind',
          required: true,
          values: ['todo', 'task', 'project_task', 'mail', 'event', 'message', 'link'],
          maxSelect: 1
        },
        { type: 'text', name: 'title', required: true, max: 200 },
        { type: 'text', name: 'body', max: 100000 },
        { type: 'text', name: 'source_url', max: 2000 },
        { type: 'text', name: 'source_ref', max: 500 },
        { type: 'date', name: 'source_date' },
        { type: 'json', name: 'source_meta', maxSize: 20000 },
        {
          type: 'file',
          name: 'original',
          maxSelect: 1,
          maxSize: 10485760,
          protected: true
        },
        { type: 'text', name: 'fingerprint', required: true, max: 100 },
        {
          type: 'select',
          name: 'state',
          required: true,
          values: ['new', 'converted', 'discarded'],
          maxSelect: 1
        },
        {
          type: 'relation',
          name: 'ticket',
          required: false,
          collectionId: tickets.id,
          cascadeDelete: false,
          maxSelect: 1
        },
        { type: 'date', name: 'handled_at' },
        { type: 'text', name: 'scope', required: true },
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
        'CREATE UNIQUE INDEX idx_inbox_items_scope_fingerprint ON inbox_items (scope, fingerprint)',
        'CREATE INDEX idx_inbox_items_owner_state ON inbox_items (owner, state)',
        'CREATE INDEX idx_inbox_items_ticket ON inbox_items (ticket)'
      ]
    });
    app.save(inbox);
  },
  function (app) {
    app.delete(app.findCollectionByNameOrId('inbox_items'));
  }
);
