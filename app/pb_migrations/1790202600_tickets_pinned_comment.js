/// <reference path="../pb_data/types.d.ts" />
// The pinned comment of a ticket (ADR-0044, package KO-1): the optional relation
// tickets.pinned_comment to comments, at most one per ticket because the field holds one value.
// The ticket hook accepts only a comment of the same ticket (lib/ticket-service.js), and deleting
// the pinned comment releases the pin in the same transaction (comments.pb.js). The index serves
// the lookup PocketBase runs on every deleted comment for records that point to it.
//
// Additive: no row changes, no rule changes; pinning follows the update rule of tickets (whoever
// may change the ticket). The down migration removes index and field; only the pins are lost,
// comments and history stay (history entries of the field then read as a changed field).
migrate(
  function (app) {
    var tickets = app.findCollectionByNameOrId('tickets');
    var comments = app.findCollectionByNameOrId('comments');
    tickets.fields.add(
      new RelationField({
        name: 'pinned_comment',
        required: false,
        collectionId: comments.id,
        cascadeDelete: false,
        maxSelect: 1
      })
    );
    tickets.addIndex('idx_tickets_pinned_comment', false, 'pinned_comment', '');
    app.save(tickets);
  },
  function (app) {
    var tickets = app.findCollectionByNameOrId('tickets');
    tickets.removeIndex('idx_tickets_pinned_comment');
    tickets.fields.removeByName('pinned_comment');
    app.save(tickets);
  }
);
