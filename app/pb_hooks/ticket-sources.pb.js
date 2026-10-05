/// <reference path="../pb_data/types.d.ts" />
// Tickets as sources of other tickets (QT-1, ADR-0067): "B stammt aus A". The links live in
// ticket_sources (migration 1790204800); the API rules only read them, these routes write them. The
// logic lives in lib/ticket-source-service.js, the pure rules in lib/ticket-source-rules.js; handlers
// run in isolated scopes, so modules are required inside them. Every route is for app accounts on
// every device (it does nothing on the machine of the app); before the migration it answers 503.

// Model hooks for every writer, the superuser included: no link to itself, both tickets alive and in
// one area before the insert; after it, in the same transaction, no circle (which rolls it back).
onRecordCreate(function (e) {
  var service = require(`${__hooks}/lib/ticket-source-service.js`);
  require(`${__hooks}/lib/transaction.js`).inTransaction(e, function (txApp) {
    service.checkLink(txApp, e.record);
    e.next();
    service.checkCircle(txApp, e.record);
  });
}, 'ticket_sources');

onRecordUpdate(function (e) {
  var service = require(`${__hooks}/lib/ticket-source-service.js`);
  require(`${__hooks}/lib/transaction.js`).inTransaction(e, function (txApp) {
    service.checkLink(txApp, e.record);
    e.next();
    service.checkCircle(txApp, e.record);
  });
}, 'ticket_sources');

// The source tickets and the direct follow-ups of a ticket, and every ticket that stems from it.
routerAdd(
  'GET',
  '/api/byl/tickets/{id}/ticket-sources',
  function (e) {
    return require(`${__hooks}/lib/ticket-source-service.js`).origins(e, e.request.pathValue('id'));
  },
  $apis.requireAuth('users')
);

// "Quelle hinzufügen → Ticket": { source }.
routerAdd(
  'POST',
  '/api/byl/tickets/{id}/ticket-sources',
  function (e) {
    return require(`${__hooks}/lib/ticket-source-service.js`).add(e, e.request.pathValue('id'));
  },
  $apis.requireAuth('users')
);

// Removing a source ticket of a ticket.
routerAdd(
  'POST',
  '/api/byl/tickets/{id}/ticket-sources/{source}/remove',
  function (e) {
    return require(`${__hooks}/lib/ticket-source-service.js`).remove(
      e,
      e.request.pathValue('id'),
      e.request.pathValue('source')
    );
  },
  $apis.requireAuth('users')
);

// "Folge-Ticket anlegen …": { title, tags, charm, description }.
routerAdd(
  'POST',
  '/api/byl/tickets/{id}/follow-up',
  function (e) {
    return require(`${__hooks}/lib/ticket-source-service.js`).followUp(e, e.request.pathValue('id'));
  },
  $apis.requireAuth('users')
);
