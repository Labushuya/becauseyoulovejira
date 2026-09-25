/// <reference path="../pb_data/types.d.ts" />
// E4 plan, package 4: base line of the "new" mark per user (ADR-0015 section 2). Additive: a date
// field on users. Existing users get the time of the migration, so no ticket from before counts
// as new, without writing read rows for them. Written with a plain UPDATE of the new column only:
// saving the records would change their `updated` and run the auth hooks. New users keep the
// field empty, which counts as their `created`. The down migration removes the field again.
migrate(
  function (app) {
    var users = app.findCollectionByNameOrId('users');
    users.fields.add(new DateField({ name: 'unread_since', required: false }));
    app.save(users);

    var now = new Date().toISOString().replace('T', ' ');
    app
      .db()
      .newQuery("UPDATE users SET unread_since = {:now} WHERE unread_since = '' OR unread_since IS NULL")
      .bind({ now: now })
      .execute();
  },
  function (app) {
    var users = app.findCollectionByNameOrId('users');
    users.fields.removeByName('unread_since');
    app.save(users);
  }
);
