/// <reference path="../pb_data/types.d.ts" />
// E1 plan, package 5: the hook-maintained fields become required, so empty values can no longer
// collide in the unique indexes tickets(scope, key), projects(scope, code) and tags(scope, name).
// The hooks set the values in onRecordCreate/onRecordUpdate before validation runs (spike,
// docs/plan/e1.md section 6). Required fields were chosen over partial indexes: a record without
// scope or key (for example when app/pb_hooks is missing) fails loudly instead of being stored.
var REQUIRED_FIELDS = {
  projects: ['scope'],
  tags: ['scope'],
  tickets: ['scope', 'key', 'number']
};

function setRequired(app, required) {
  for (var name in REQUIRED_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(REQUIRED_FIELDS, name)) continue;
    var collection = app.findCollectionByNameOrId(name);
    var fields = REQUIRED_FIELDS[name];
    for (var i = 0; i < fields.length; i++) {
      collection.fields.getByName(fields[i]).required = required;
    }
    app.save(collection);
  }
}

migrate(
  function (app) {
    setRequired(app, true);
  },
  function (app) {
    setRequired(app, false);
  }
);
