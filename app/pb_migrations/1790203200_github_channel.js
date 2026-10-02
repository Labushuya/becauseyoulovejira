/// <reference path="../pb_data/types.d.ts" />
// GitHub channel and watched sources (ADR-0050, plan beobachtete-quellen, package 2):
// - connections.type gets "github"; inbox_items.channel and tickets.source get "github".
// - inbox_items.kind gets "change" (a watched file changed, is new or was removed),
//   "pull_request" and "release".
// - inbox_items.watch (JSON, at most 2 000 bytes): the status of a watched source, e.g.
//   { "kind": "file", "state": "changed", "since": "…" } or { "kind": "pull", "state": "merged" }.
//   Only the server writes it (lib/inbox-service.js refuses it from clients); it is only shown,
//   a ticket never changes with it (ADR-0050 §5).
// - connections.watch (JSON, hidden, at most 1 MB): what the channel knows of its repositories
//   (ETags, blobs of the watched files, last head, open pull requests, last release, rate limit).
//   Hidden: the API never delivers it; the card reads a summary through a route.
//
// Additive: no existing row changes.
//
// Down: entries and tickets of the channel keep their content and become web links ("github" ->
// "link", the kinds -> "link"; every entry has its address on github.com). GitHub connections are
// removed (the kind no longer exists) and their entries lose the reference to them. The numbers go
// to the log. Then the fields and values follow.
var NEW_CHANNEL = 'github';
var OLD_CHANNELS = ['manual', 'quick', 'clipboard', 'link', 'eml', 'mail', 'ics', 'calendar', 'whatsapp', 'telegram', 'notion', 'api', 'whatsapp-web'];
var NEW_KINDS = ['change', 'pull_request', 'release'];
var OLD_KINDS = ['todo', 'task', 'project_task', 'mail', 'event', 'message', 'link'];
var OLD_TYPES = ['calendar', 'telegram', 'notion', 'mail'];
var CHANNEL_FIELDS = [
  ['inbox_items', 'channel'],
  ['tickets', 'source']
];

function setValues(app, collectionName, fieldName, values) {
  var collection = app.findCollectionByNameOrId(collectionName);
  collection.fields.getByName(fieldName).values = values;
  app.save(collection);
}

function count(app, sql, params) {
  var result = new DynamicModel({ n: 0 });
  app.db().newQuery(sql).bind(params || {}).one(result);
  return result.n;
}

migrate(
  function (app) {
    for (var i = 0; i < CHANNEL_FIELDS.length; i++) {
      setValues(app, CHANNEL_FIELDS[i][0], CHANNEL_FIELDS[i][1], OLD_CHANNELS.concat([NEW_CHANNEL]));
    }
    setValues(app, 'inbox_items', 'kind', OLD_KINDS.concat(NEW_KINDS));
    setValues(app, 'connections', 'type', OLD_TYPES.concat([NEW_CHANNEL]));

    var items = app.findCollectionByNameOrId('inbox_items');
    items.fields.add(new JSONField({ name: 'watch', required: false, maxSize: 2000 }));
    app.save(items);

    var connections = app.findCollectionByNameOrId('connections');
    connections.fields.add(new JSONField({ name: 'watch', required: false, hidden: true, maxSize: 1048576 }));
    app.save(connections);
  },
  function (app) {
    for (var i = 0; i < CHANNEL_FIELDS.length; i++) {
      var table = CHANNEL_FIELDS[i][0];
      var column = CHANNEL_FIELDS[i][1];
      var where = ' WHERE ' + column + ' = {:channel}';
      var rows = count(app, 'SELECT COUNT(*) AS n FROM ' + table + where, { channel: NEW_CHANNEL });
      if (rows > 0) {
        app
          .db()
          .newQuery('UPDATE ' + table + ' SET ' + column + " = 'link'" + where)
          .bind({ channel: NEW_CHANNEL })
          .execute();
        app.logger().warn('Rückweg „GitHub-Kanal“: Kanal ersetzt', 'table', table, 'from', NEW_CHANNEL, 'to', 'link', 'rows', rows);
      }
    }
    var kinds = "('" + NEW_KINDS.join("', '") + "')";
    var kindRows = count(app, 'SELECT COUNT(*) AS n FROM inbox_items WHERE kind IN ' + kinds);
    if (kindRows > 0) {
      app.db().newQuery("UPDATE inbox_items SET kind = 'link' WHERE kind IN " + kinds).execute();
      app.logger().warn('Rückweg „GitHub-Kanal“: Art ersetzt', 'to', 'link', 'rows', kindRows);
    }
    var connectionRows = count(app, "SELECT COUNT(*) AS n FROM connections WHERE type = 'github'");
    if (connectionRows > 0) {
      app
        .db()
        .newQuery("UPDATE inbox_items SET connection = '' WHERE connection IN (SELECT id FROM connections WHERE type = 'github')")
        .execute();
      app.db().newQuery("DELETE FROM connections WHERE type = 'github'").execute();
      app.logger().warn('Rückweg „GitHub-Kanal“: Verbindungen entfernt', 'connections', connectionRows);
    }

    var connections = app.findCollectionByNameOrId('connections');
    connections.fields.removeByName('watch');
    app.save(connections);

    var items = app.findCollectionByNameOrId('inbox_items');
    items.fields.removeByName('watch');
    app.save(items);

    setValues(app, 'connections', 'type', OLD_TYPES);
    setValues(app, 'inbox_items', 'kind', OLD_KINDS);
    for (var j = 0; j < CHANNEL_FIELDS.length; j++) {
      setValues(app, CHANNEL_FIELDS[j][0], CHANNEL_FIELDS[j][1], OLD_CHANNELS);
    }
  }
);
