/// <reference path="../pb_data/types.d.ts" />
// Connections of a household from before (E7-4, ADR-0061 §7). Since E7-3 no app account creates a
// connection in a household (ADR-0059 §5); one could only come from the admin UI. Such a connection
// goes into the private area of its owner, if that account is active (not disabled):
//
// - household empty, scope `u:<owner>`; a target project that is no project of that private area
//   is cleared;
// - entries of the inbox it brought into the household stay there (they are data of the household)
//   and lose the reference to the connection, which now lies in another area (the channel stays).
//
// A connection of a disabled owner stays as it was (still shown in no area) and goes with its
// household when that is dissolved. Written with plain UPDATEs, so `updated` and the hooks stay
// untouched. Down: nothing; the connections stay private (the household they were in is not kept).
migrate(
  function (app) {
    var moving =
      "SELECT id FROM connections WHERE COALESCE(household, '') != '' " +
      'AND owner IN (SELECT id FROM users WHERE COALESCE(disabled, 0) = 0)';
    app
      .db()
      .newQuery(
        "UPDATE inbox_items SET connection = '' WHERE connection IN (" +
          moving +
          ") AND scope != (SELECT 'u:' || c.owner FROM connections c WHERE c.id = inbox_items.connection)"
      )
      .execute();
    app
      .db()
      .newQuery(
        "UPDATE connections SET target_project = '' WHERE id IN (" +
          moving +
          ") AND COALESCE(target_project, '') != '' " +
          "AND target_project NOT IN (SELECT p.id FROM projects p WHERE p.scope = 'u:' || connections.owner)"
      )
      .execute();
    app
      .db()
      .newQuery("UPDATE connections SET household = '', scope = 'u:' || owner WHERE id IN (" + moving + ')')
      .execute();
  },
  function () {
    // Nothing to undo: the connections stay in the private area of their owner.
  }
);
