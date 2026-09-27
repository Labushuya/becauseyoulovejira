/// <reference path="../pb_data/types.d.ts" />
// Delete guard of the sources of a ticket (ADR-0031 section 3, package HK-1): an inbox item with a
// ticket cannot be deleted through the API any more. Only the deleteRule changes; no record is
// touched. The hook in app/pb_hooks/inbox.pb.js refuses the same (and the main source of a
// ticket) already before this migration and for superusers. The down migration restores the
// rule of 1790201220_inbox_api_rules.js.
migrate(
  function (app) {
    var inbox = app.findCollectionByNameOrId('inbox_items');
    inbox.deleteRule = owned() + ' && ticket = ""';
    app.save(inbox);
  },
  function (app) {
    var inbox = app.findCollectionByNameOrId('inbox_items');
    inbox.deleteRule = owned();
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
