/// <reference path="../pb_data/types.d.ts" />
// E4 plan, package 10: the relation inbox_items.connection of ADR-0014 section 1, left out in
// 1790201200 because `connections` did not exist yet. Additive and optional: existing items keep
// every value and get no connection. Without cascade: deleting a connection keeps its items
// (PocketBase empties the reference), so their duplicate keys stay.
migrate(
  function (app) {
    var connections = app.findCollectionByNameOrId('connections');
    var inbox = app.findCollectionByNameOrId('inbox_items');
    inbox.fields.add(
      new RelationField({
        name: 'connection',
        required: false,
        collectionId: connections.id,
        cascadeDelete: false,
        maxSelect: 1
      })
    );
    app.save(inbox);
  },
  function (app) {
    var inbox = app.findCollectionByNameOrId('inbox_items');
    inbox.fields.removeByName('connection');
    app.save(inbox);
  }
);
