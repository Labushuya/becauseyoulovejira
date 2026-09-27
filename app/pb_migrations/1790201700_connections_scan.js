/// <reference path="../pb_data/types.d.ts" />
// Full scan of the inbox of mailboxes (user decision of 2026-09-27; ADR-0020, addendum 3).
//
// 1. Additive: the JSON field connections.scan with the state of the scan (written only by the
//    server: the status route of byl-mail.exe and "Abbrechen"; connection-rules.SERVER_FIELDS).
// 2. match_body is on by default now ("Betreff, Absender, Kopfzeilen und Text durchsuchen"): every
//    existing mail connection without it gets settings.match_body = true, and its scan the mark
//    { "match_body_before": false }, so the down migration can switch exactly these off again.
//    Nothing else of the settings changes, and no data is lost. Written with plain UPDATEs of
//    these two columns, so `updated` and the hooks stay untouched.
//
// The down migration switches match_body off where the mark says it was off and the setting is
// still on, then removes the field.
migrate(
  function (app) {
    var connections = app.findCollectionByNameOrId('connections');
    connections.fields.add(new JSONField({ name: 'scan', required: false, maxSize: 2000 }));
    app.save(connections);

    // json_type only on valid JSON (it fails on anything else); SQLite does not promise to
    // short-circuit AND and OR, so every check sits in its own CASE.
    app
      .db()
      .newQuery(
        "UPDATE connections SET scan = json_object('match_body_before', json('false')), " +
          "settings = json_set(CASE WHEN json_valid(settings) THEN CASE WHEN json_type(settings) = 'object' " +
          "THEN settings ELSE '{}' END ELSE '{}' END, '$.match_body', json('true')) " +
          "WHERE type = 'mail' AND COALESCE(CASE WHEN json_valid(settings) THEN json_type(settings, '$.match_body') END, '') != 'true'"
      )
      .execute();
  },
  function (app) {
    app
      .db()
      .newQuery(
        "UPDATE connections SET settings = json_set(settings, '$.match_body', json('false')) " +
          "WHERE type = 'mail' " +
          "AND COALESCE(CASE WHEN json_valid(scan) THEN json_type(scan, '$.match_body_before') END, '') = 'false' " +
          "AND COALESCE(CASE WHEN json_valid(settings) THEN json_type(settings, '$.match_body') END, '') = 'true'"
      )
      .execute();
    var connections = app.findCollectionByNameOrId('connections');
    connections.fields.removeByName('scan');
    app.save(connections);
  }
);
