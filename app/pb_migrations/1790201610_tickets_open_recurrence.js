/// <reference path="../pb_data/types.d.ts" />
// E5 plan, package 2: at most one open instance per rule (ADR-0022 section 1). A unique partial
// index on tickets(recurrence) for tickets that belong to a rule and are not done. It is the
// safety net; the generation checks the same inside its transaction.
//
// Before E5 a client could set tickets.recurrence freely (only through the API, there was no UI),
// so a rule could have several open tickets, and the index would fail. Such extra links are
// cleared first: the most recently created open ticket stays linked, older open ones become
// normal tickets (only the column `recurrence`, so `updated` and the history stay untouched).
// Without such data the migration changes no row. The down migration removes the index.
migrate(
  function (app) {
    app
      .db()
      .newQuery(
        "UPDATE tickets SET recurrence = '' WHERE recurrence != '' AND status != 'done' AND EXISTS (" +
          "SELECT 1 FROM tickets AS newer WHERE newer.recurrence = tickets.recurrence AND newer.status != 'done' " +
          'AND (newer.created > tickets.created OR (newer.created = tickets.created AND newer.id > tickets.id)))'
      )
      .execute();

    var tickets = app.findCollectionByNameOrId('tickets');
    tickets.addIndex('idx_tickets_open_recurrence', true, 'recurrence', "recurrence != '' AND status != 'done'");
    app.save(tickets);
  },
  function (app) {
    var tickets = app.findCollectionByNameOrId('tickets');
    tickets.removeIndex('idx_tickets_open_recurrence');
    app.save(tickets);
  }
);
