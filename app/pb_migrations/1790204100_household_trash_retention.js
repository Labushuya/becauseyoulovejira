/// <reference path="../pb_data/types.d.ts" />
// Areas "Privat" and "Haushalt" (E7-3, ADR-0059 §6): the retention of the trash of a household.
//
// - households.trash_retention: select 7 | 30 | 90 | never, not required. Empty means 30 days, the
//   value every trash had before (users.trash_retention, ADR-0037 §8). Tickets of a household follow
//   it; private tickets keep the retention of their owner. Only the route
//   POST /api/byl/household/retention writes it (owner or right "purge"); the write rules of
//   households stay null.
//
// Additive: no existing row changes, every household starts with the default. Down: the field goes,
// and the trash of a household follows the retention of the owner of each ticket again.
migrate(
  function (app) {
    var households = app.findCollectionByNameOrId('households');
    households.fields.add(
      new SelectField({ name: 'trash_retention', required: false, values: ['7', '30', '90', 'never'], maxSelect: 1 })
    );
    app.save(households);
  },
  function (app) {
    var households = app.findCollectionByNameOrId('households');
    households.fields.removeByName('trash_retention');
    app.save(households);
  }
);
