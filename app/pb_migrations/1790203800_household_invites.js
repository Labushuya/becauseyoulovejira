/// <reference path="../pb_data/types.d.ts" />
// Managing a household (ADR-0058, E7-2; plan docs/plan/e7-haushalt.md §3).
//
// - household_members.rights: the rights a member holds besides the normal use of the household
//   (invite, remove, delegate, rename, purge, move_out). The owner (role "owner") has every right by
//   the role; the field matters for members. Only the routes of app/pb_hooks/household.pb.js write it.
// - household_invites: invitation codes of a household. Stored is only the SHA-256 of the normalized
//   code (hidden, unique), never the code; who created it, until when it is valid, when and by whom
//   it was used, when it was revoked. Every API rule is null: only the routes read and write it.
//   A household takes its codes with it.
//
// Additive: no existing row changes; members of households from the admin UI start without rights.
// Down: the collection with its codes and the field with the rights go.
var RIGHTS = ['invite', 'remove', 'delegate', 'rename', 'purge', 'move_out'];

migrate(
  function (app) {
    var members = app.findCollectionByNameOrId('household_members');
    members.fields.add(new SelectField({ name: 'rights', required: false, values: RIGHTS, maxSelect: RIGHTS.length }));
    app.save(members);

    var households = app.findCollectionByNameOrId('households');
    var users = app.findCollectionByNameOrId('users');
    var invites = new Collection({
      type: 'base',
      name: 'household_invites',
      listRule: null,
      viewRule: null,
      createRule: null,
      updateRule: null,
      deleteRule: null,
      fields: [
        {
          type: 'relation',
          name: 'household',
          required: true,
          collectionId: households.id,
          cascadeDelete: true,
          maxSelect: 1
        },
        { type: 'text', name: 'code_hash', required: true, max: 64, pattern: '^[0-9a-f]{64}$', hidden: true },
        { type: 'relation', name: 'created_by', required: false, collectionId: users.id, cascadeDelete: false, maxSelect: 1 },
        { type: 'date', name: 'expires_at', required: true },
        { type: 'date', name: 'used_at' },
        { type: 'relation', name: 'used_by', required: false, collectionId: users.id, cascadeDelete: false, maxSelect: 1 },
        { type: 'date', name: 'revoked_at' },
        { type: 'autodate', name: 'created', onCreate: true, onUpdate: false },
        { type: 'autodate', name: 'updated', onCreate: true, onUpdate: true }
      ],
      indexes: [
        'CREATE UNIQUE INDEX idx_household_invites_code_hash ON household_invites (code_hash)',
        'CREATE INDEX idx_household_invites_household ON household_invites (household)'
      ]
    });
    app.save(invites);
  },
  function (app) {
    app.delete(app.findCollectionByNameOrId('household_invites'));
    var members = app.findCollectionByNameOrId('household_members');
    members.fields.removeByName('rights');
    app.save(members);
  }
);
