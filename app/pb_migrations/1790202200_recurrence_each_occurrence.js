/// <reference path="../pb_data/types.d.ts" />
// "Jeden Termin einzeln anlegen" (plan "Offene Reste", OR-5; ADR-0022 addendum 2): a rule may give
// every date a ticket of its own, even while earlier ones are still open.
//
// - recurrence_rules.each_occurrence (bool, default false: one open instance as before).
// - tickets.occurrence (date): the date of the series a ticket was made for, written only by the
//   generation of a rule with each_occurrence; every other ticket keeps it empty.
// - The unique partial index on tickets(recurrence) for open instances becomes one on
//   tickets(recurrence, occurrence) with the same condition. Instances of a rule without
//   each_occurrence all have an empty occurrence, so for them it still allows one open instance
//   per rule; with each_occurrence it allows one open ticket per date, whatever its due date says.
//   Until now a rule has at most one open instance, so the new index always fits.
//
// Additive: no row changes; existing tickets get an empty occurrence, existing rules false.
//
// The down migration needs the old index again, which allows one open instance per rule. If rules
// have several by then (only possible with each_occurrence), the newest open ticket of each rule
// stays in its series and the older open ones become normal tickets, like 1790201610 did for data
// from before E5 (only the column `recurrence`, so `updated` and the history stay untouched). The
// number is written to the log. Then the index, both fields and the old index follow.
var OLD_INDEX = 'idx_tickets_open_recurrence';
var NEW_INDEX = 'idx_tickets_open_occurrence';
var OPEN = "recurrence != '' AND status != 'done'";
var OLDER_OPEN =
  "recurrence != '' AND status != 'done' AND EXISTS (" +
  "SELECT 1 FROM tickets AS newer WHERE newer.recurrence = tickets.recurrence AND newer.status != 'done' " +
  'AND (newer.created > tickets.created OR (newer.created = tickets.created AND newer.id > tickets.id)))';

migrate(
  function (app) {
    var rules = app.findCollectionByNameOrId('recurrence_rules');
    rules.fields.add(new BoolField({ name: 'each_occurrence', required: false }));
    app.save(rules);

    var tickets = app.findCollectionByNameOrId('tickets');
    tickets.fields.add(new DateField({ name: 'occurrence', required: false }));
    tickets.removeIndex(OLD_INDEX);
    tickets.addIndex(NEW_INDEX, true, 'recurrence, occurrence', OPEN);
    app.save(tickets);
  },
  function (app) {
    var count = new DynamicModel({ n: 0 });
    app
      .db()
      .newQuery('SELECT COUNT(*) AS n FROM tickets WHERE ' + OLDER_OPEN)
      .one(count);
    if (count.n > 0) {
      app.db().newQuery("UPDATE tickets SET recurrence = '' WHERE " + OLDER_OPEN).execute();
      app
        .logger()
        .warn(
          'Rückweg „Jeden Termin einzeln“: ältere offene Tickets aus ihrer Serie gelöst, nur das jüngste je Regel bleibt',
          'tickets',
          count.n
        );
    }

    var tickets = app.findCollectionByNameOrId('tickets');
    tickets.removeIndex(NEW_INDEX);
    tickets.fields.removeByName('occurrence');
    app.save(tickets);
    tickets = app.findCollectionByNameOrId('tickets');
    tickets.addIndex(OLD_INDEX, true, 'recurrence', OPEN);
    app.save(tickets);

    var rules = app.findCollectionByNameOrId('recurrence_rules');
    rules.fields.removeByName('each_occurrence');
    app.save(rules);
  }
);
