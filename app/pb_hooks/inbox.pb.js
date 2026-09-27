/// <reference path="../pb_data/types.d.ts" />
// Inbox hooks (ADR-0014, E4 plan package 1). The logic lives in lib/inbox-service.js; handlers
// run in isolated scopes, so modules are required inside them. The duplicate check and the
// insert run in one transaction (lib/transaction.js). Until the migration 1790201200 has run,
// the collection does not exist and none of these handlers fires.

onRecordCreate(function (e) {
  var service = require(`${__hooks}/lib/inbox-service.js`);
  require(`${__hooks}/lib/transaction.js`).inTransaction(e, function (txApp) {
    service.prepareCreate(txApp, e.record);
    e.next();
  });
}, 'inbox_items');

// Only client updates: immutable fields and allowed changes of state and ticket; the acting user
// is remembered for the history of a link or release (ADR-0031 section 2).
onRecordUpdateRequest(function (e) {
  var service = require(`${__hooks}/lib/inbox-service.js`);
  service.guardClientUpdate(e.record);
  service.rememberActor(e);
  e.next();
}, 'inbox_items');

// Linking an item to a ticket and releasing it write the history of the ticket in the same
// transaction as the item (ADR-0031 section 2).
onRecordUpdate(function (e) {
  var service = require(`${__hooks}/lib/inbox-service.js`);
  require(`${__hooks}/lib/transaction.js`).inTransaction(e, function (txApp) {
    var change = service.prepareUpdate(txApp, e.record);
    e.next();
    service.recordLinkChange(txApp, e.record, change);
  });
}, 'inbox_items');

// The source of a ticket cannot be deleted (ADR-0031 section 3); the deleteRule of the migration
// 1790201800 says the same once it has run.
onRecordDeleteRequest(function (e) {
  require(`${__hooks}/lib/inbox-service.js`).guardDelete(e.app, e.record);
  e.next();
}, 'inbox_items');

// Discarded items lose their content after 30 days (OF-E4-6, E4 plan package 24); fingerprint and
// state stay as tombstone. Once a day at 11:30 UTC, when the app usually runs; idempotent, so a
// missed day is caught up by the next run. Before the migration of inbox_items it does nothing.
cronAdd('byl-inbox-cleanup', '30 11 * * *', function () {
  require(`${__hooks}/lib/inbox-cleanup-service.js`).run($app, Date.now());
});

// .ics files (ADR-0017 section 1, E4 plan packages 14 and 21): the SPA uploads one file as
// multipart field "file". The preview lists its components with the keyword of the user that
// matches (ADR-0020) and whether each is in the inbox already, and saves nothing. The import
// takes only the chosen components (field "select": JSON list of their indices) as private
// items of the signed-in user and answers with the counts "neu, schon vorhanden, übersprungen".
// Before the migrations of E4 (docs/plan/e4.md, section 7) both answer 503 with a hint.
routerAdd(
  'POST',
  '/api/byl/inbox/ics/preview',
  function (e) {
    var ics = require(`${__hooks}/lib/inbox-ics.js`);
    var upload = ics.uploadedText(e);
    if (upload.unavailable) {
      return e.json(503, { message: ics.UNAVAILABLE });
    }
    var result = ics.previewFile(e.app, e.auth.id, upload.text, ics.userKeywords(e.auth));
    if (result.tooLarge) {
      throw new BadRequestError(ics.TOO_LARGE);
    }
    return e.json(200, { items: result.items, skipped: result.skipped });
  },
  $apis.requireAuth('users'),
  $apis.bodyLimit(21 * 1024 * 1024)
);

routerAdd(
  'POST',
  '/api/byl/inbox/ics',
  function (e) {
    var ics = require(`${__hooks}/lib/inbox-ics.js`);
    var upload = ics.uploadedText(e);
    if (upload.unavailable) {
      return e.json(503, { message: ics.UNAVAILABLE });
    }
    var body = e.requestInfo().body || {};
    var result = ics.importFile(e.app, e.auth.id, upload.text, body.select, ics.userKeywords(e.auth));
    if (result.tooLarge) {
      throw new BadRequestError(ics.TOO_LARGE);
    }
    if (result.invalidSelection) {
      throw new BadRequestError('Keine gültige Auswahl: bitte mindestens einen Termin der Datei wählen.');
    }
    return e.json(200, {
      created: result.created,
      duplicates: result.duplicates,
      skipped: result.skipped,
      failed: result.failed,
      item: result.item
    });
  },
  $apis.requireAuth('users'),
  $apis.bodyLimit(21 * 1024 * 1024)
);

// Whether drafts of the selection views (mail files, E4 plan package 21) are in the private inbox
// of the signed-in user already: JSON { items: [draft] } with at most 200 drafts in the fields of
// inbox_items (channel, kind, title, source_ref, source_date, source_meta); answers per draft
// { state, message } with '' for not there. Saves nothing.
routerAdd(
  'POST',
  '/api/byl/inbox/lookup',
  function (e) {
    try {
      e.app.findCollectionByNameOrId('inbox_items');
    } catch (err) {
      return e.json(503, { message: require(`${__hooks}/lib/inbox-ics.js`).UNAVAILABLE });
    }
    var service = require(`${__hooks}/lib/inbox-service.js`);
    var body = e.requestInfo().body || {};
    var drafts = body.items;
    if (Object.prototype.toString.call(drafts) !== '[object Array]' || drafts.length > 200) {
      throw new BadRequestError('Höchstens 200 Einträge je Anfrage.');
    }
    var states = [];
    for (var i = 0; i < drafts.length; i++) {
      var draft = drafts[i] || {};
      var existing = service.lookup(e.app, e.auth.id, {
        channel: String(draft.channel || ''),
        kind: String(draft.kind || ''),
        title: String(draft.title || ''),
        body: '',
        source_url: String(draft.source_url || ''),
        source_ref: String(draft.source_ref || ''),
        source_date: String(draft.source_date || ''),
        meta: draft.source_meta && typeof draft.source_meta === 'object' ? draft.source_meta : {}
      });
      states.push(existing ? { state: existing.state, message: existing.message } : { state: '', message: '' });
    }
    return e.json(200, { items: states });
  },
  $apis.requireAuth('users')
);
