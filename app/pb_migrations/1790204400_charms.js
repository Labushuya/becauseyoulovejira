/// <reference path="../pb_data/types.d.ts" />
// Charms of tickets and recurrence rules (ADR-0062): a small symbol before the title.
//
// - tickets.charm: the charm of a ticket; empty means none.
// - recurrence_rules.charm: the charm of the template; every new ticket of the series gets it when
//   it is made (lib/recurrence-service.js), empty means none.
//
// Text fields with the key of the catalog (web/src/lib/domain/charms.ts). The hooks check the key
// against the allowlist of lib/charms.js on every write (Record API, the dashboard of the superuser,
// saves of the hooks) and refuse an unknown one with `validation_charm_unknown`; the list of
// symbols can grow without a migration. Additive: no row changes, data of before has no charm. The
// down migration removes both fields; only the charms are lost.
var COLLECTIONS = ['tickets', 'recurrence_rules'];

migrate(
  function (app) {
    for (var i = 0; i < COLLECTIONS.length; i++) {
      var collection = app.findCollectionByNameOrId(COLLECTIONS[i]);
      collection.fields.add(new TextField({ name: 'charm', required: false, max: 40 }));
      app.save(collection);
    }
  },
  function (app) {
    for (var i = COLLECTIONS.length - 1; i >= 0; i--) {
      var collection = app.findCollectionByNameOrId(COLLECTIONS[i]);
      collection.fields.removeByName('charm');
      app.save(collection);
    }
  }
);
