/// <reference path="../pb_data/types.d.ts" />
// Converted inbox items without a ticket (ADR-0031, addendum B, package HK-6). Until HK-6 the
// deletion of a ticket only cleared inbox_items.ticket; its sources stayed "converted" without a
// ticket, out of the inbox and without a way back. Since HK-6 the ticket hook gives them back to
// the inbox; this migration does the same once for the items left over from before:
//
// - state "new", handled_at empty, and source_meta.ticket_deleted = { key: '', at, restore }: the
//   key of the deleted ticket is unknown (its history went with it), so the SPA says only that
//   the ticket was deleted. `restore` keeps handled_at and the raw source_meta for the down
//   migration.
// - Written with plain UPDATEs of these columns, so `updated` and the hooks stay untouched;
//   fingerprint, text and file stay as they are.
//
// The down migration turns exactly these items back into converted ones without a ticket, as long
// as they are still new (an item linked or discarded since then stays as it is).
migrate(
  function (app) {
    // json_type only on valid JSON; SQLite does not promise to short-circuit, hence the CASEs.
    app
      .db()
      .newQuery(
        "UPDATE inbox_items SET state = 'new', handled_at = '', " +
          "source_meta = json_set(CASE WHEN json_valid(source_meta) THEN CASE WHEN json_type(source_meta) = 'object' " +
          "THEN source_meta ELSE '{}' END ELSE '{}' END, '$.ticket_deleted', json_object('key', '', 'at', {:at}, " +
          "'restore', json_object('handled_at', COALESCE(handled_at, ''), 'meta', json_quote(source_meta)))) " +
          "WHERE state = 'converted' AND COALESCE(ticket, '') = ''"
      )
      .bind({ at: new Date().toISOString().replace('T', ' ') })
      .execute();
  },
  function (app) {
    app
      .db()
      .newQuery(
        "UPDATE inbox_items SET state = 'converted', " +
          "handled_at = json_extract(source_meta, '$.ticket_deleted.restore.handled_at'), " +
          "source_meta = json_extract(source_meta, '$.ticket_deleted.restore.meta') " +
          "WHERE state = 'new' AND COALESCE(ticket, '') = '' " +
          "AND COALESCE(CASE WHEN json_valid(source_meta) THEN json_type(source_meta, '$.ticket_deleted.restore') END, '') = 'object'"
      )
      .execute();
  }
);
