/// <reference path="../pb_data/types.d.ts" />
// No inbox item can be deleted through the Record API any more (ADR-0014, addendum of 2026-10-01):
// deleting an item would take its fingerprint, and the same mail, event or message would come in
// again; the app discards instead (tombstone, ADR-0014 section 3). deleteRule null leaves deleting
// to superusers, and the hook in app/pb_hooks/inbox.pb.js refuses them as well (also before this
// migration). Deletes of the server itself ($app.delete, the trash, migrations) are untouched. Only
// the rule changes; no record is touched. The down migration restores the rule of
// 1790201800_inbox_items_delete_guard.js.
migrate(
  function (app) {
    var inbox = app.findCollectionByNameOrId('inbox_items');
    inbox.deleteRule = null;
    app.save(inbox);
  },
  function (app) {
    var inbox = app.findCollectionByNameOrId('inbox_items');
    inbox.deleteRule = owned() + ' && ticket = ""';
    app.save(inbox);
  }
);

// Own records or records of an own household, as in 1790201220_inbox_api_rules.js.
function owned() {
  return (
    '@request.auth.id != "" && (owner = @request.auth.id || (household != "" && ' +
    '@collection.household_members.household ?= household && ' +
    '@collection.household_members.user ?= @request.auth.id))'
  );
}
