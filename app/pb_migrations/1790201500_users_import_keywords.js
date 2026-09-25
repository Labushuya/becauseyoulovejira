/// <reference path="../pb_data/types.d.ts" />
// E4 plan, package 21: keywords of the file imports per user and kind of file (ADR-0020 section 3).
// Additive: a JSON field on users, empty for every existing user (no data is written). Shape
// { eml: { keywords, match_body }, ics: { keywords }, whatsapp: { keywords } }; the hook
// app/pb_hooks/users.pb.js checks it with lib/keywords.js. The down migration removes the field.
migrate(
  function (app) {
    var users = app.findCollectionByNameOrId('users');
    users.fields.add(new JSONField({ name: 'import_keywords', required: false, maxSize: 20000 }));
    app.save(users);
  },
  function (app) {
    var users = app.findCollectionByNameOrId('users');
    users.fields.removeByName('import_keywords');
    app.save(users);
  }
);
