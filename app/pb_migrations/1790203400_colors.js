/// <reference path="../pb_data/types.d.ts" />
// Colors of projects and tickets (ADR-0052, plan docs/plan/farben.md): one of a fixed palette.
//
// - projects.color: the color of a project; empty means none. A sub project without one shows the
//   color of its parent (ADR-0034), the SPA resolves that.
// - tickets.color: an own color of a ticket; empty means "wie Projekt" (the ticket shows the color of
//   its project, else of the parent of that project, else none).
// - recurrence_rules.color: the color of the template; the next tickets of the series get it
//   (lib/recurrence-service.js), empty means "wie Projekt" there as well.
//
// Select fields with the keys of the palette (web/src/lib/domain/colors.ts PROJECT_COLORS, kept
// equal by tests/integration/colors.test.mjs): PocketBase checks every way a value is written
// (Record API, the dashboard of the superuser, saves of the hooks), so no other value reaches the
// database. Additive: no row changes, data of before has no color. The down migration removes the
// three fields; only the colors are lost.
var COLORS = ['violett', 'indigo', 'blau', 'himmel', 'tuerkis', 'gruen', 'oliv', 'senf', 'braun', 'grau'];
var COLLECTIONS = ['projects', 'tickets', 'recurrence_rules'];

migrate(
  function (app) {
    for (var i = 0; i < COLLECTIONS.length; i++) {
      var collection = app.findCollectionByNameOrId(COLLECTIONS[i]);
      collection.fields.add(new SelectField({ name: 'color', required: false, values: COLORS, maxSelect: 1 }));
      app.save(collection);
    }
  },
  function (app) {
    for (var i = COLLECTIONS.length - 1; i >= 0; i--) {
      var collection = app.findCollectionByNameOrId(COLLECTIONS[i]);
      collection.fields.removeByName('color');
      app.save(collection);
    }
  }
);
