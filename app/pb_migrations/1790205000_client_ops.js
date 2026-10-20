/// <reference path="../pb_data/types.d.ts" />
// The outbox of the SPA at the server (OF-1, ADR-0074). Additive: a new collection and new optional
// fields, no existing row changes.
//
// - client_ops: one row per action an account sent with an identifier (`op_id`), written by the hooks
//   in the transaction of the change (lib/client-ops.js): user (cascade), op (16 to 64 characters
//   [A-Za-z0-9_-]), kind (the six actions of the first stage), record (the ID of the record the action
//   wrote: ticket, comment, entry of the inbox or of the day plan), result (only the routes of the day
//   plan: what their answer names besides the records, e.g. { action, previous_status }) and created.
//   Unique per (user, op), so an identifier belongs to one account. Every API rule is null: only the
//   hooks read and write it. The cron byl-client-ops-cleanup removes rows after 30 days.
// - ticket_history.offline and .device_at, comments.offline and .device_at: an entry or comment that
//   came from the outbox, and the time of the device when the server kept it (at most 5 minutes in
//   the future, at most 48 hours back). `created` stays the time of the server. Only the hooks write
//   them; rows of before stay false and empty.
//
// Down: the collection and the four fields go; only the notes and the marks are lost.
var KINDS = ['ticket.create', 'ticket.update', 'comment.create', 'inbox.create', 'dayplan.check', 'dayplan.uncheck'];
var MARKED = ['ticket_history', 'comments'];

migrate(
  function (app) {
    var users = app.findCollectionByNameOrId('users');
    var ops = new Collection({
      type: 'base',
      name: 'client_ops',
      listRule: null,
      viewRule: null,
      createRule: null,
      updateRule: null,
      deleteRule: null,
      fields: [
        { type: 'relation', name: 'user', required: true, collectionId: users.id, cascadeDelete: true, maxSelect: 1 },
        { type: 'text', name: 'op', required: true, min: 16, max: 64, pattern: '^[A-Za-z0-9_-]+$' },
        { type: 'select', name: 'kind', required: true, values: KINDS, maxSelect: 1 },
        { type: 'text', name: 'record', required: true, max: 50 },
        { type: 'json', name: 'result', required: false, maxSize: 2000 },
        { type: 'autodate', name: 'created', onCreate: true, onUpdate: false }
      ],
      indexes: [
        'CREATE UNIQUE INDEX idx_client_ops_user_op ON client_ops (user, op)',
        'CREATE INDEX idx_client_ops_created ON client_ops (created)'
      ]
    });
    app.save(ops);

    for (var i = 0; i < MARKED.length; i++) {
      var collection = app.findCollectionByNameOrId(MARKED[i]);
      collection.fields.add(new BoolField({ name: 'offline', required: false }));
      collection.fields.add(new DateField({ name: 'device_at', required: false }));
      app.save(collection);
    }
  },
  function (app) {
    for (var i = MARKED.length - 1; i >= 0; i--) {
      var collection = app.findCollectionByNameOrId(MARKED[i]);
      collection.fields.removeByName('device_at');
      collection.fields.removeByName('offline');
      app.save(collection);
    }
    app.delete(app.findCollectionByNameOrId('client_ops'));
  }
);
