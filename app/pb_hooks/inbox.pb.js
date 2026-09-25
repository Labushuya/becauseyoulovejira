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

// Only client updates: immutable fields and allowed changes of state and ticket.
onRecordUpdateRequest(function (e) {
  require(`${__hooks}/lib/inbox-service.js`).guardClientUpdate(e.record);
  e.next();
}, 'inbox_items');

onRecordUpdate(function (e) {
  var service = require(`${__hooks}/lib/inbox-service.js`);
  require(`${__hooks}/lib/transaction.js`).inTransaction(e, function (txApp) {
    service.prepareUpdate(txApp, e.record);
    e.next();
  });
}, 'inbox_items');

// .ics files (ADR-0017 section 1, E4 plan package 14): the SPA uploads one file as multipart
// field "file"; every VEVENT/VTODO becomes a private item of the signed-in user. Answers with the
// counts "neu, schon vorhanden, übersprungen" instead of the items.
routerAdd(
  'POST',
  '/api/byl/inbox/ics',
  function (e) {
    var ical = require(`${__hooks}/lib/ical.js`);
    var MAX_BYTES = 20 * 1024 * 1024;
    try {
      e.app.findCollectionByNameOrId('inbox_items');
    } catch (err) {
      // Before the migrations of E4 (docs/plan/e4.md, section 7).
      return e.json(503, { message: 'Der Eingang steht nach dem nächsten Start der App bereit (start.bat).' });
    }
    var files = [];
    try {
      files = e.findUploadedFiles('file');
    } catch (err) {
      files = [];
    }
    if (!files || files.length !== 1) {
      throw new BadRequestError('Genau eine .ics-Datei erwartet.');
    }
    var file = files[0];
    if (file.size > MAX_BYTES || file.size > ical.MAX_TEXT_LENGTH) {
      throw new BadRequestError('Größer als 20 MB, deshalb nicht übernommen.');
    }
    var reader = file.reader.open();
    var text;
    try {
      text = toString(reader, MAX_BYTES);
    } finally {
      reader.close();
    }
    var result = require(`${__hooks}/lib/inbox-ics.js`).importFile(e.app, e.auth.id, text);
    if (result.tooLarge) {
      throw new BadRequestError('Größer als 20 MB, deshalb nicht übernommen.');
    }
    return e.json(200, result);
  },
  $apis.requireAuth('users'),
  $apis.bodyLimit(21 * 1024 * 1024)
);
