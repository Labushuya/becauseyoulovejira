/// <reference path="../pb_data/types.d.ts" />
// Test-only route for the delete lock of inbox items (ADR-0014, addendum of 2026-10-01). The
// harness copies this file next to app/pb_hooks in every integration test instance; it is never
// part of the portable app folder. Superusers only.

// Deletes an inbox item the way the server itself does ($app.delete in a hook, a job or a
// migration): through the model, not the Record API. The request hook that refuses every delete
// of the API must not stand in its way. Answers 204.
routerAdd(
  'POST',
  '/api/byl-test/inbox/{id}/delete',
  function (e) {
    var record = e.app.findRecordById('inbox_items', e.request.pathValue('id'));
    e.app.delete(record);
    return e.noContent(204);
  },
  $apis.requireSuperuserAuth()
);
