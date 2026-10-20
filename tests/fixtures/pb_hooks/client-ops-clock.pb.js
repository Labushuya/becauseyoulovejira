/// <reference path="../pb_data/types.d.ts" />
// Test-only route for the notes of the outbox (OF-1, ADR-0074). The harness copies this file next to
// app/pb_hooks in every integration test instance; it is never part of the portable app folder. It
// writes a note with a given time (created through setRaw), so a test sees the cleanup after 30 days
// without waiting. Superusers only.
routerAdd(
  'POST',
  '/api/byl-test/client-ops',
  function (e) {
    var body = e.requestInfo().body;
    var record = new Record(e.app.findCollectionByNameOrId('client_ops'));
    record.set('user', String(body['user']));
    record.set('op', String(body['op']));
    record.set('kind', String(body['kind'] || 'ticket.update'));
    record.set('record', String(body['record'] || 'abcdefghijklmno'));
    record.setRaw('created', String(body['created']));
    e.app.save(record);
    return e.json(200, { id: record.id });
  },
  $apis.requireSuperuserAuth()
);
