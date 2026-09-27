/// <reference path="../pb_data/types.d.ts" />
// Originals up to 25 MB (user decision of 2026-09-27; ADR-0031, addendum D, package HK-8): the
// file field inbox_items.original takes 25 MB instead of 10 MB. A mail over 25 MB still comes
// without its file (ADR-0031 section 4). Only the maxSize changes; no record and no file is
// touched. Stored files larger than 10 MB cannot exist, so the down migration restores the old
// limit without data loss (files saved in between stay; PocketBase checks the size only on
// upload).
var MB = 1024 * 1024;

migrate(
  function (app) {
    setOriginalMaxSize(app, 25 * MB);
  },
  function (app) {
    setOriginalMaxSize(app, 10 * MB);
  }
);

function setOriginalMaxSize(app, bytes) {
  var inbox = app.findCollectionByNameOrId('inbox_items');
  var field = inbox.fields.getByName('original');
  field.maxSize = bytes;
  app.save(inbox);
}
