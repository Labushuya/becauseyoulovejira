/// <reference path="../pb_data/types.d.ts" />
// Own inbox with access keys (ADR-0038; plan eigener-eingang-whatsapp-web, EI-1).
//
// - inbox_keys: name, token_hash (SHA-256 of the key, hidden: the API never delivers it, not even
//   to its owner), token_hint (the first 8 characters, e.g. "byl_AbCd"), last_used_at and owner.
//   The owner lists and revokes (deletes) his keys; nobody creates or changes one through the
//   Record API (createRule and updateRule null): POST /api/byl/inbox/keys creates it
//   (app/pb_hooks/inbox-keys.pb.js). A deleted user takes his keys with him.
// - inbox_items.channel and tickets.source get the values "api" and "whatsapp-web".
//
// Additive: no existing row changes.
//
// Down: entries and tickets of the new channels keep their content and get the nearest old
// channel ("whatsapp-web" -> "whatsapp", "api" -> "manual"); the keyword lists of the new channels
// leave users.import_keywords, whose old check would refuse them. The numbers go to the log. Then
// the values and the collection follow; the keys are gone.
var NEW_CHANNELS = ['api', 'whatsapp-web'];
var OLD_CHANNELS = ['manual', 'quick', 'clipboard', 'link', 'eml', 'mail', 'ics', 'calendar', 'whatsapp', 'telegram', 'notion'];
var FALLBACK = { api: 'manual', 'whatsapp-web': 'whatsapp' };
var CHANNEL_FIELDS = [
  ['inbox_items', 'channel'],
  ['tickets', 'source']
];
var KEYWORD_LISTS =
  "json_valid(import_keywords) AND json_type(import_keywords) = 'object' AND " +
  "(json_type(import_keywords, '$.api') IS NOT NULL OR json_type(import_keywords, '$.\"whatsapp-web\"') IS NOT NULL)";

function setChannels(app, values) {
  for (var i = 0; i < CHANNEL_FIELDS.length; i++) {
    var collection = app.findCollectionByNameOrId(CHANNEL_FIELDS[i][0]);
    collection.fields.getByName(CHANNEL_FIELDS[i][1]).values = values;
    app.save(collection);
  }
}

function count(app, sql) {
  var result = new DynamicModel({ n: 0 });
  app.db().newQuery(sql).one(result);
  return result.n;
}

migrate(
  function (app) {
    var users = app.findCollectionByNameOrId('users');
    var OWN = '@request.auth.id != "" && owner = @request.auth.id';
    var keys = new Collection({
      type: 'base',
      name: 'inbox_keys',
      listRule: OWN,
      viewRule: OWN,
      createRule: null,
      updateRule: null,
      deleteRule: OWN,
      fields: [
        { type: 'text', name: 'name', required: true, max: 60 },
        { type: 'text', name: 'token_hash', required: true, max: 64, pattern: '^[0-9a-f]{64}$', hidden: true },
        { type: 'text', name: 'token_hint', required: true, max: 20 },
        { type: 'date', name: 'last_used_at' },
        {
          type: 'relation',
          name: 'owner',
          required: true,
          collectionId: users.id,
          cascadeDelete: true,
          maxSelect: 1
        },
        { type: 'autodate', name: 'created', onCreate: true, onUpdate: false },
        { type: 'autodate', name: 'updated', onCreate: true, onUpdate: true }
      ],
      indexes: [
        'CREATE UNIQUE INDEX idx_inbox_keys_token_hash ON inbox_keys (token_hash)',
        'CREATE INDEX idx_inbox_keys_owner ON inbox_keys (owner)'
      ]
    });
    app.save(keys);

    setChannels(app, OLD_CHANNELS.concat(NEW_CHANNELS));
  },
  function (app) {
    for (var i = 0; i < NEW_CHANNELS.length; i++) {
      var channel = NEW_CHANNELS[i];
      for (var j = 0; j < CHANNEL_FIELDS.length; j++) {
        var table = CHANNEL_FIELDS[j][0];
        var column = CHANNEL_FIELDS[j][1];
        var where = ' WHERE ' + column + ' = {:channel}';
        var n = new DynamicModel({ n: 0 });
        app.db().newQuery('SELECT COUNT(*) AS n FROM ' + table + where).bind({ channel: channel }).one(n);
        if (n.n > 0) {
          app
            .db()
            .newQuery('UPDATE ' + table + ' SET ' + column + ' = {:fallback}' + where)
            .bind({ channel: channel, fallback: FALLBACK[channel] })
            .execute();
          app.logger().warn('Rückweg „Eigener Eingang“: Kanal ersetzt', 'table', table, 'from', channel, 'to', FALLBACK[channel], 'rows', n.n);
        }
      }
    }
    var lists = count(app, 'SELECT COUNT(*) AS n FROM users WHERE ' + KEYWORD_LISTS);
    if (lists > 0) {
      app
        .db()
        .newQuery("UPDATE users SET import_keywords = json_remove(import_keywords, '$.api', '$.\"whatsapp-web\"') WHERE " + KEYWORD_LISTS)
        .execute();
      app.logger().warn('Rückweg „Eigener Eingang“: Stichwörter der neuen Kanäle entfernt', 'users', lists);
    }

    setChannels(app, OLD_CHANNELS);
    app.delete(app.findCollectionByNameOrId('inbox_keys'));
  }
);
