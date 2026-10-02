/// <reference path="../pb_data/types.d.ts" />
// Folder channel (ADR-0051, plan beobachtete-quellen, package 3):
// - connections.type gets "folder"; inbox_items.channel and tickets.source get "folder".
// - inbox_items.kind gets "file" (a file of a watched folder; its changes are "change", the kind of
//   GitHub).
// - connections.secret_env is no longer required: a folder connection has no access data. The hook
//   requires a valid name for every other kind, as before (connection-rules.secretViolation).
// - connections.watch (hidden) holds up to 8 MB instead of 1 MB: the state of up to 10 folders with
//   2 000 files each (size, time and SHA-256 per file).
//
// Additive: no existing row changes.
//
// Down: entries and tickets of the channel keep their content and become manual ones ("folder" ->
// "manual", the kind "file" -> "todo"; a reference to a file on this machine has no address on the
// web). Folder connections are removed and their entries lose the reference to them. The numbers go
// to the log. Then secret_env is required again, watch holds 1 MB again, and the values go.
var NEW_CHANNEL = 'folder';
var NEW_KIND = 'file';
var OLD_CHANNELS = ['manual', 'quick', 'clipboard', 'link', 'eml', 'mail', 'ics', 'calendar', 'whatsapp', 'telegram', 'notion', 'api', 'whatsapp-web', 'github'];
var OLD_KINDS = ['todo', 'task', 'project_task', 'mail', 'event', 'message', 'link', 'change', 'pull_request', 'release'];
var OLD_TYPES = ['calendar', 'telegram', 'notion', 'mail', 'github'];
var WATCH_MAX_BEFORE = 1048576;
var WATCH_MAX = 8 * 1048576;
var CHANNEL_FIELDS = [
  ['inbox_items', 'channel'],
  ['tickets', 'source']
];

function setValues(app, collectionName, fieldName, values) {
  var collection = app.findCollectionByNameOrId(collectionName);
  collection.fields.getByName(fieldName).values = values;
  app.save(collection);
}

function setConnectionFields(app, secretRequired, watchMax) {
  var connections = app.findCollectionByNameOrId('connections');
  connections.fields.getByName('secret_env').required = secretRequired;
  connections.fields.getByName('watch').maxSize = watchMax;
  app.save(connections);
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
    setValues(app, 'inbox_items', 'kind', OLD_KINDS.concat([NEW_KIND]));
    setValues(app, 'connections', 'type', OLD_TYPES.concat([NEW_CHANNEL]));
    setConnectionFields(app, false, WATCH_MAX);
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
          .newQuery('UPDATE ' + table + ' SET ' + column + " = 'manual'" + where)
          .bind({ channel: NEW_CHANNEL })
          .execute();
        app.logger().warn('Rückweg „Ordner-Kanal“: Kanal ersetzt', 'table', table, 'from', NEW_CHANNEL, 'to', 'manual', 'rows', rows);
      }
    }
    var kindRows = count(app, 'SELECT COUNT(*) AS n FROM inbox_items WHERE kind = {:kind}', { kind: NEW_KIND });
    if (kindRows > 0) {
      app.db().newQuery("UPDATE inbox_items SET kind = 'todo' WHERE kind = {:kind}").bind({ kind: NEW_KIND }).execute();
      app.logger().warn('Rückweg „Ordner-Kanal“: Art ersetzt', 'from', NEW_KIND, 'to', 'todo', 'rows', kindRows);
    }
    var connectionRows = count(app, 'SELECT COUNT(*) AS n FROM connections WHERE type = {:type}', { type: NEW_CHANNEL });
    if (connectionRows > 0) {
      app
        .db()
        .newQuery("UPDATE inbox_items SET connection = '' WHERE connection IN (SELECT id FROM connections WHERE type = {:type})")
        .bind({ type: NEW_CHANNEL })
        .execute();
      app.db().newQuery('DELETE FROM connections WHERE type = {:type}').bind({ type: NEW_CHANNEL }).execute();
      app.logger().warn('Rückweg „Ordner-Kanal“: Verbindungen entfernt', 'connections', connectionRows);
    }

    setConnectionFields(app, true, WATCH_MAX_BEFORE);
    setValues(app, 'connections', 'type', OLD_TYPES);
    setValues(app, 'inbox_items', 'kind', OLD_KINDS);
    for (var j = 0; j < CHANNEL_FIELDS.length; j++) {
      setValues(app, CHANNEL_FIELDS[j][0], CHANNEL_FIELDS[j][1], OLD_CHANNELS);
    }
  }
);
