/// <reference path="../pb_data/types.d.ts" />
// Papierkorb für Tickets (ADR-0037, docs/plan/papierkorb.md, package PB-1). Deleting a ticket
// moves it (with its sub-tickets) into the trash; it is deleted for good only by "Endgültig
// löschen", "Papierkorb leeren" or after the retention time of its owner.
//
// - tickets.deleted_at (date), tickets.deleted_by (relation users) and tickets.trash (json, the
//   snapshot of the relations the trash clears: project, parent, series, main source and the
//   handling of the sources). Only the server writes them (app/pb_hooks/lib/trash-service.js).
// - users.trash_retention (select 7 | 30 | 90 | never, empty = 30 days).
// - The unique partial index of open instances (1790202200) gets the condition deleted_at = '':
//   a ticket in the trash never blocks a new instance of its series. The trash clears
//   `recurrence` anyway; the condition keeps the index right for every row of the trash.
// - The API rules hide the trash everywhere: tickets (list, view, update, delete) with
//   deleted_at = "", and everything that is visible through a ticket (comments, history, read
//   rows, dependencies, inbox items linked to a ticket) with ticket.deleted_at = "". The trash
//   view reads through its own routes (trash.pb.js).
//
// Additive for existing rows: every ticket gets an empty deleted_at, i.e. it is not in the trash.
//
// Down: tickets in the trash are deleted for good, as deleting meant before the trash. Their
// sources that stayed with them ("Quellen verwerfen") become discarded tombstones with
// source_meta.ticket_deleted, like the delete hook of HK-6 did; sources given back to the inbox
// are there already. Sub-tickets of the group go first. The number is written to the log. Then
// rules, index and fields follow. The writes do not depend on the hooks: `migrate down` may run
// with or without them.
var OPEN_INDEX = 'idx_tickets_open_occurrence';
var OPEN_COLUMNS = 'recurrence, occurrence';
var OPEN = "recurrence != '' AND status != 'done'";
var OPEN_LIVE = OPEN + " AND deleted_at = ''";
var DELETED_INDEX = 'idx_tickets_deleted_at';

var LIVE = ' && deleted_at = ""';
var LIVE_TICKET = ' && ticket.deleted_at = ""';
var LIVE_ITEM = ' && (ticket = "" || ticket.deleted_at = "")';
var LIVE_DEPENDENCY = ' && blocker.deleted_at = "" && blocked.deleted_at = ""';

// Rule suffixes per collection and rule; each is appended to the rule of 1790200900 and
// 1790201220 (they are chains of &&, so the suffix binds to the whole rule).
var SUFFIXES = {
  tickets: { listRule: LIVE, viewRule: LIVE, updateRule: LIVE, deleteRule: LIVE },
  comments: {
    listRule: LIVE_TICKET,
    viewRule: LIVE_TICKET,
    createRule: LIVE_TICKET,
    updateRule: LIVE_TICKET,
    deleteRule: LIVE_TICKET
  },
  ticket_history: { listRule: LIVE_TICKET, viewRule: LIVE_TICKET },
  ticket_reads: { listRule: LIVE_TICKET, viewRule: LIVE_TICKET, createRule: LIVE_TICKET },
  dependencies: { listRule: LIVE_DEPENDENCY, viewRule: LIVE_DEPENDENCY },
  inbox_items: { listRule: LIVE_ITEM, viewRule: LIVE_ITEM, updateRule: LIVE_ITEM }
};

function eachRule(fn) {
  Object.keys(SUFFIXES).forEach(function (name) {
    fn(name, SUFFIXES[name]);
  });
}

migrate(
  function (app) {
    var tickets = app.findCollectionByNameOrId('tickets');
    var users = app.findCollectionByNameOrId('users');
    tickets.fields.add(new DateField({ name: 'deleted_at', required: false }));
    tickets.fields.add(
      new RelationField({ name: 'deleted_by', required: false, collectionId: users.id, cascadeDelete: false, maxSelect: 1 })
    );
    tickets.fields.add(new JSONField({ name: 'trash', required: false, maxSize: 20000 }));
    app.save(tickets);

    tickets = app.findCollectionByNameOrId('tickets');
    tickets.removeIndex(OPEN_INDEX);
    tickets.addIndex(OPEN_INDEX, true, OPEN_COLUMNS, OPEN_LIVE);
    tickets.addIndex(DELETED_INDEX, false, 'deleted_at', '');
    app.save(tickets);

    users.fields.add(
      new SelectField({ name: 'trash_retention', required: false, values: ['7', '30', '90', 'never'], maxSelect: 1 })
    );
    app.save(users);

    eachRule(function (name, suffixes) {
      var collection = app.findCollectionByNameOrId(name);
      Object.keys(suffixes).forEach(function (rule) {
        if (collection[rule] !== null && collection[rule] !== undefined) {
          collection[rule] = collection[rule] + suffixes[rule];
        }
      });
      app.save(collection);
    });
  },
  function (app) {
    var now = new Date().toISOString().replace('T', ' ');
    app
      .db()
      .newQuery(
        "UPDATE inbox_items SET state = 'discarded', handled_at = {:now}, " +
          "source_meta = json_set(CASE WHEN json_valid(source_meta) THEN CASE WHEN json_type(source_meta) = 'object' " +
          "THEN source_meta ELSE '{}' END ELSE '{}' END, '$.ticket_deleted', json_object('key', " +
          "COALESCE((SELECT t.key FROM tickets AS t WHERE t.id = inbox_items.ticket), ''), 'at', {:now})), ticket = '' " +
          "WHERE state = 'converted' AND ticket IN (SELECT id FROM tickets WHERE COALESCE(deleted_at, '') != '')"
      )
      .bind({ now: now })
      .execute();

    var purged = 0;
    // Sub-tickets of a group first, so no delete has to clear the parent of another one.
    ["COALESCE(parent, '') != ''", "COALESCE(parent, '') = ''"].forEach(function (condition) {
      var ids = arrayOf(new DynamicModel({ id: '' }));
      app
        .db()
        .newQuery("SELECT id FROM tickets WHERE COALESCE(deleted_at, '') != '' AND " + condition + ' ORDER BY id')
        .all(ids);
      for (var i = 0; i < ids.length; i++) {
        app.delete(app.findRecordById('tickets', ids[i].id));
        purged += 1;
      }
    });
    if (purged > 0) {
      app.logger().warn('Rückweg Papierkorb: Tickets im Papierkorb endgültig gelöscht', 'tickets', purged);
    }

    eachRule(function (name, suffixes) {
      var collection = app.findCollectionByNameOrId(name);
      Object.keys(suffixes).forEach(function (rule) {
        if (collection[rule] === null || collection[rule] === undefined) {
          return;
        }
        // The rule is a *string in the JSVM; String() gives its text.
        var value = String(collection[rule]);
        var suffix = suffixes[rule];
        if (value.length >= suffix.length && value.slice(-suffix.length) === suffix) {
          collection[rule] = value.slice(0, value.length - suffix.length);
        }
      });
      app.save(collection);
    });

    var users = app.findCollectionByNameOrId('users');
    users.fields.removeByName('trash_retention');
    app.save(users);

    var tickets = app.findCollectionByNameOrId('tickets');
    tickets.removeIndex(OPEN_INDEX);
    tickets.removeIndex(DELETED_INDEX);
    tickets.addIndex(OPEN_INDEX, true, OPEN_COLUMNS, OPEN);
    app.save(tickets);
    tickets = app.findCollectionByNameOrId('tickets');
    tickets.fields.removeByName('trash');
    tickets.fields.removeByName('deleted_by');
    tickets.fields.removeByName('deleted_at');
    app.save(tickets);
  }
);
