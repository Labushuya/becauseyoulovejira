/// <reference path="../pb_data/types.d.ts" />
// Test-only route for the protocol of failed sign-ins (ADR-0055 §8, SH-2). The harness copies this
// file next to app/pb_hooks in every integration test instance; it is never part of the portable app
// folder. It writes a failure with a given time (created through setRaw), so a test sees the
// cleanup after 30 days without waiting. Superusers only.
routerAdd(
  'POST',
  '/api/byl-test/login-failures',
  function (e) {
    var body = e.requestInfo().body;
    var record = new Record(e.app.findCollectionByNameOrId('login_failures'));
    record.set('area', String(body['area'] || 'app'));
    record.set('identity', String(body['identity'] || ''));
    record.set('source', String(body['source'] || 'program'));
    record.setRaw('created', String(body['created']));
    e.app.save(record);
    return e.json(200, { id: record.id });
  },
  $apis.requireSuperuserAuth()
);
