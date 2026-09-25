/// <reference path="../pb_data/types.d.ts" />
// E4 plan, package 10: connections of the channels that run in the server (ADR-0016 section 2,
// ADR-0018). Additive: a new collection, no change to existing records. Access data are never
// stored, only the names of Windows user environment variables (`secret_env`, and for Telegram
// `settings.allowed_env`). cursor, last_*, running_since and scope are written by the server only;
// app/pb_hooks/connections.pb.js refuses client changes. The API rules are those of tickets.
migrate(
  function (app) {
    var users = app.findCollectionByNameOrId('users');
    var households = app.findCollectionByNameOrId('households');

    var AUTH = '@request.auth.id != ""';
    function member(ref, alias) {
      var join = '@collection.household_members' + (alias ? ':' + alias : '');
      return join + '.household ?= ' + ref + ' && ' + join + '.user ?= @request.auth.id';
    }
    var OWNED =
      AUTH + ' && (owner = @request.auth.id || (household != "" && ' + member('household') + '))';
    var BODY_HOUSEHOLD_ALLOWED =
      '(@request.body.household:isset = false || @request.body.household = "" || (' +
      member('@request.body.household', 'target') +
      '))';

    var connections = new Collection({
      type: 'base',
      name: 'connections',
      listRule: OWNED,
      viewRule: OWNED,
      createRule: AUTH + ' && @request.body.owner = @request.auth.id && ' + BODY_HOUSEHOLD_ALLOWED,
      updateRule: OWNED + ' && @request.body.owner:changed = false && ' + BODY_HOUSEHOLD_ALLOWED,
      deleteRule: OWNED,
      fields: [
        {
          type: 'select',
          name: 'type',
          required: true,
          values: ['calendar', 'telegram', 'notion', 'mail'],
          maxSelect: 1
        },
        { type: 'text', name: 'label', required: true, max: 100 },
        { type: 'bool', name: 'enabled' },
        { type: 'text', name: 'secret_env', required: true, max: 64, pattern: '^BYL_[A-Z0-9_]{1,60}$' },
        { type: 'json', name: 'settings', maxSize: 20000 },
        { type: 'text', name: 'cursor', max: 200 },
        { type: 'date', name: 'last_run_at' },
        { type: 'date', name: 'last_ok_at' },
        { type: 'text', name: 'last_error', max: 1000 },
        { type: 'text', name: 'last_hint', max: 1000 },
        { type: 'date', name: 'running_since' },
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
        'CREATE INDEX idx_connections_owner ON connections (owner)',
        'CREATE INDEX idx_connections_type_enabled ON connections (type, enabled)'
      ]
    });
    app.save(connections);
  },
  function (app) {
    app.delete(app.findCollectionByNameOrId('connections'));
  }
);
