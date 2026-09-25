/// <reference path="../pb_data/types.d.ts" />
// E4 plan, package 4: read marks per user (ADR-0015 section 1). Additive: a new collection. A row
// (user, ticket) means the user has seen the ticket; `seen_at` is set by PocketBase on create. Both
// relations cascade, so a row goes with its user or ticket. Rules: only the own rows, created only
// for tickets the user can see (same condition as the tickets rules, 1790200900_api_rules.js),
// never updated.
migrate(
  function (app) {
    var users = app.findCollectionByNameOrId('users');
    var tickets = app.findCollectionByNameOrId('tickets');

    var AUTH = '@request.auth.id != ""';
    var OWN = AUTH + ' && user = @request.auth.id';
    var TICKET_VISIBLE =
      '(ticket.owner = @request.auth.id || (ticket.household != "" && ' +
      '@collection.household_members.household ?= ticket.household && ' +
      '@collection.household_members.user ?= @request.auth.id))';

    var reads = new Collection({
      type: 'base',
      name: 'ticket_reads',
      listRule: OWN,
      viewRule: OWN,
      createRule: AUTH + ' && @request.body.user = @request.auth.id && ' + TICKET_VISIBLE,
      updateRule: null,
      deleteRule: OWN,
      fields: [
        {
          type: 'relation',
          name: 'user',
          required: true,
          collectionId: users.id,
          cascadeDelete: true,
          maxSelect: 1
        },
        {
          type: 'relation',
          name: 'ticket',
          required: true,
          collectionId: tickets.id,
          cascadeDelete: true,
          maxSelect: 1
        },
        { type: 'autodate', name: 'seen_at', onCreate: true, onUpdate: false }
      ],
      indexes: [
        'CREATE UNIQUE INDEX idx_ticket_reads_user_ticket ON ticket_reads (user, ticket)',
        'CREATE INDEX idx_ticket_reads_ticket ON ticket_reads (ticket)'
      ]
    });
    app.save(reads);
  },
  function (app) {
    app.delete(app.findCollectionByNameOrId('ticket_reads'));
  }
);
