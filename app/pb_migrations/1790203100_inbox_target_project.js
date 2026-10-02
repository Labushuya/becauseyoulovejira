/// <reference path="../pb_data/types.d.ts" />
// Target project of a way into the inbox (ADR-0049, package 1 "Standardprojekt je Verbindung"):
// - inbox_items.target_project: the project an entry got when it came in (relation to projects, at
//   most one, no cascade). Only the server sets it (lib/target-project-service.js); converting the
//   entry chooses it in advance. The index serves the filter of the inbox and the lookup PocketBase
//   runs on every deleted project for records that point to it (it empties the relation then).
// - connections.target_project: the target of a connection (calendar, Telegram, mailbox, Notion);
//   the connection hook accepts only an active project of the same area.
// - users.inbox_targets: the targets of the cards without a connection record, per user like their
//   keywords: { "api": "<id>", "whatsapp-web": "<id>", "files": "<id>" } (lib/user-service.js).
//
// Additive: no row changes, no rule changes. Entries and connections of before have no target and
// behave as before. The down migration removes index and fields; only the targets are lost.
migrate(
  function (app) {
    var projects = app.findCollectionByNameOrId('projects');

    var items = app.findCollectionByNameOrId('inbox_items');
    items.fields.add(
      new RelationField({
        name: 'target_project',
        required: false,
        collectionId: projects.id,
        cascadeDelete: false,
        maxSelect: 1
      })
    );
    items.addIndex('idx_inbox_items_target_project', false, 'target_project', '');
    app.save(items);

    var connections = app.findCollectionByNameOrId('connections');
    connections.fields.add(
      new RelationField({
        name: 'target_project',
        required: false,
        collectionId: projects.id,
        cascadeDelete: false,
        maxSelect: 1
      })
    );
    app.save(connections);

    var users = app.findCollectionByNameOrId('users');
    users.fields.add(new JSONField({ name: 'inbox_targets', required: false, maxSize: 2000 }));
    app.save(users);
  },
  function (app) {
    var users = app.findCollectionByNameOrId('users');
    users.fields.removeByName('inbox_targets');
    app.save(users);

    var connections = app.findCollectionByNameOrId('connections');
    connections.fields.removeByName('target_project');
    app.save(connections);

    var items = app.findCollectionByNameOrId('inbox_items');
    items.removeIndex('idx_inbox_items_target_project');
    items.fields.removeByName('target_project');
    app.save(items);
  }
);
