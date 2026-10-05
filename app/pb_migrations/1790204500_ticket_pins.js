/// <reference path="../pb_data/types.d.ts" />
// Pinned tickets (PIN-1, ADR-0064). Additive: a new collection, no existing row changes.
//
// A row (user, ticket) means the account pinned the ticket; `created` is the moment of pinning and
// orders the section "Angeheftet" (oldest first). Pins are personal: every account has its own, and
// the same ticket may be pinned by several members of a household. Both relations cascade, so a pin
// goes with its account or its ticket.
//
// Rules: only the own pins, and only for tickets the account sees, with the same condition as the
// rules of the tickets (owner of a private ticket, or a member of its household, 1790203900) and
// without the trash (1790202300). Whoever leaves a household no longer reads his pins on its tickets.
// Created only for such tickets, never changed, deleted only by its account. The hooks release the
// pins of a ticket when it is completed or moved to the trash (lib/pin-service.js).
migrate(
  function (app) {
    var users = app.findCollectionByNameOrId('users');
    var tickets = app.findCollectionByNameOrId('tickets');

    var AUTH = '@request.auth.id != ""';
    var TICKET_VISIBLE =
      '((ticket.owner = @request.auth.id && ticket.household = "") || (ticket.household != "" && ' +
      '@collection.household_members.household ?= ticket.household && ' +
      '@collection.household_members.user ?= @request.auth.id))';
    var LIVE_TICKET = ' && ticket.deleted_at = ""';
    var OWN_VISIBLE = AUTH + ' && user = @request.auth.id && ' + TICKET_VISIBLE + LIVE_TICKET;

    var pins = new Collection({
      type: 'base',
      name: 'ticket_pins',
      listRule: OWN_VISIBLE,
      viewRule: OWN_VISIBLE,
      createRule: AUTH + ' && @request.body.user = @request.auth.id && ' + TICKET_VISIBLE + LIVE_TICKET,
      updateRule: null,
      deleteRule: AUTH + ' && user = @request.auth.id',
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
        { type: 'autodate', name: 'created', onCreate: true, onUpdate: false }
      ],
      indexes: [
        'CREATE UNIQUE INDEX idx_ticket_pins_user_ticket ON ticket_pins (user, ticket)',
        'CREATE INDEX idx_ticket_pins_ticket ON ticket_pins (ticket)'
      ]
    });
    app.save(pins);
  },
  function (app) {
    app.delete(app.findCollectionByNameOrId('ticket_pins'));
  }
);
