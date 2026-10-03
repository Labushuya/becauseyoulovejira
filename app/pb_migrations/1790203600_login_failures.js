/// <reference path="../pb_data/types.d.ts" />
// Protocol of failed sign-ins (ADR-0055 §8, plan docs/plan/sicherheit.md, SH-2).
//
// - login_failures: one row per failed sign-in with password of the app (area "app", collection
//   users) or the admin UI (area "admin", the superusers): the entered account (identity, at most
//   200 characters, never the password), whether such an account exists (known), where the request
//   came from (source: app, web, program), its Host header and client address. Only the hooks
//   write and read it (security.pb.js, lib/security-service.js); every API rule is null, so no
//   account reads it through the Record API, and the page "Sicherheit" shows it to the owner of
//   the instance only. Rows older than 30 days and beyond the newest 5000 go (cron and on every
//   insert).
//
// Additive. Down: the collection and its rows go.
migrate(
  function (app) {
    var failures = new Collection({
      type: 'base',
      name: 'login_failures',
      listRule: null,
      viewRule: null,
      createRule: null,
      updateRule: null,
      deleteRule: null,
      fields: [
        { type: 'select', name: 'area', required: true, values: ['app', 'admin'], maxSelect: 1 },
        { type: 'text', name: 'identity', max: 200 },
        { type: 'bool', name: 'known' },
        { type: 'select', name: 'source', required: true, values: ['app', 'web', 'program'], maxSelect: 1 },
        { type: 'text', name: 'host', max: 201 },
        { type: 'text', name: 'ip', max: 64 },
        { type: 'autodate', name: 'created', onCreate: true, onUpdate: false }
      ],
      indexes: ['CREATE INDEX idx_login_failures_created ON login_failures (created)']
    });
    app.save(failures);
  },
  function (app) {
    app.delete(app.findCollectionByNameOrId('login_failures'));
  }
);
