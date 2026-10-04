/// <reference path="../pb_data/types.d.ts" />
// Duplicate detection after moving between the areas (E7-4b, ADR-0061, addendum E7-4b).
//
// Fingerprints are unique per area (`UNIQUE (scope, fingerprint)` of inbox_items, ADR-0014 §3). An
// entry that leaves its area (POST /api/byl/area/move) took its fingerprint along, so the next run of
// its channel, a full scan of the mailbox or a file import created the same object again in the area
// it came from. inbox_moved_fingerprints keeps, per area, the fingerprint of every entry that moved
// out of it: scope (the area the entry left), fingerprint, created. The duplicate check of
// lib/inbox-service.js reads it after inbox_items, so such an object counts as "already there"
// (state `moved`). A row is independent of the entry: it stays when the entry moves on, comes back or
// is deleted with its household; only dissolving a household removes the rows of that household.
// Every API rule is null: only the hooks read and write it.
//
// Additive: a new collection, no existing row changes. Down: the collection goes.
migrate(
  function (app) {
    var moved = new Collection({
      type: 'base',
      name: 'inbox_moved_fingerprints',
      listRule: null,
      viewRule: null,
      createRule: null,
      updateRule: null,
      deleteRule: null,
      fields: [
        { type: 'text', name: 'scope', required: true, max: 100 },
        { type: 'text', name: 'fingerprint', required: true, max: 100 },
        { type: 'autodate', name: 'created', onCreate: true, onUpdate: false }
      ],
      indexes: [
        'CREATE UNIQUE INDEX idx_inbox_moved_fingerprints_scope_fingerprint ON inbox_moved_fingerprints (scope, fingerprint)'
      ]
    });
    app.save(moved);
  },
  function (app) {
    app.delete(app.findCollectionByNameOrId('inbox_moved_fingerprints'));
  }
);
