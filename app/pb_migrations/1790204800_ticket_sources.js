/// <reference path="../pb_data/types.d.ts" />
// Tickets as sources of other tickets (QT-1, ADR-0067). Additive: a new collection, no existing row
// changes.
//
// A row (ticket, source) means "the ticket stems from the source": `ticket` is the follow-up ticket,
// `source` the ticket it came from. It is neither a dependency ("blockiert") nor a sub-task. A ticket
// may have several sources and several follow-ups; the pair is unique, and no chain of rows may lead
// back to where it started (the hook in ticket-sources.pb.js refuses every link that would close a
// circle, in the transaction of the write). `created_by` names the account that linked (empty for the
// server and the superuser); `created` is the moment of linking. Both tickets relate with a cascade,
// so a ticket deleted for good takes its links along; one in the trash keeps them (ADR-0037), so
// restoring brings them back.
//
// Rules: a link is read only while both tickets are visible to the account (the branch of the tickets
// of 1790203900, each with its own alias of the memberships) and neither lies in the trash
// (1790202300). Writing is null for everyone: only the routes of lib/ticket-source-service.js write,
// with the checks of area, circle and history in one transaction.
migrate(
  function (app) {
    var users = app.findCollectionByNameOrId('users');
    var tickets = app.findCollectionByNameOrId('tickets');

    var AUTH = '@request.auth.id != ""';

    // The ticket behind `field` is visible to the account: owner of a private ticket, or member of
    // its household (own alias per field, so each ticket is checked on its own).
    function visible(field) {
      var join = '@collection.household_members:' + field + '_member';
      return (
        '((' + field + '.owner = @request.auth.id && ' + field + '.household = "") || (' + field +
        '.household != "" && ' + join + '.household ?= ' + field + '.household && ' + join +
        '.user ?= @request.auth.id))'
      );
    }

    var READ =
      AUTH + ' && ' + visible('ticket') + ' && ' + visible('source') +
      ' && ticket.deleted_at = "" && source.deleted_at = ""';

    var links = new Collection({
      type: 'base',
      name: 'ticket_sources',
      listRule: READ,
      viewRule: READ,
      createRule: null,
      updateRule: null,
      deleteRule: null,
      fields: [
        {
          type: 'relation',
          name: 'ticket',
          required: true,
          collectionId: tickets.id,
          cascadeDelete: true,
          maxSelect: 1
        },
        {
          type: 'relation',
          name: 'source',
          required: true,
          collectionId: tickets.id,
          cascadeDelete: true,
          maxSelect: 1
        },
        {
          type: 'relation',
          name: 'created_by',
          required: false,
          collectionId: users.id,
          cascadeDelete: false,
          maxSelect: 1
        },
        { type: 'autodate', name: 'created', onCreate: true, onUpdate: false }
      ],
      indexes: [
        'CREATE UNIQUE INDEX idx_ticket_sources_ticket_source ON ticket_sources (ticket, source)',
        'CREATE INDEX idx_ticket_sources_source ON ticket_sources (source)'
      ]
    });
    app.save(links);
  },
  function (app) {
    app.delete(app.findCollectionByNameOrId('ticket_sources'));
  }
);
