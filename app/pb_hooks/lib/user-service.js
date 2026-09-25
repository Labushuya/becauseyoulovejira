// Settings of a user (E4 plan, package 21; ADR-0020 section 3). CommonJS module, ES5 only, Goja
// runtime only (it throws PocketBase errors).
'use strict';

var keywords = require(__hooks + '/lib/keywords.js');
var errors = require(__hooks + '/lib/errors.js');

/**
 * onRecordCreateRequest/onRecordUpdateRequest of users: `import_keywords` must have the shape of
 * keywords.importSettingsViolation. Before the migration 1790201500 the field does not exist,
 * reads as '' and passes.
 */
function guardImportKeywords(record) {
  var raw = record.getString('import_keywords');
  var value = null;
  if (raw !== '' && raw !== 'null') {
    try {
      value = JSON.parse(raw);
    } catch (err) {
      value = raw;
    }
  }
  var message = keywords.importSettingsViolation(value);
  if (message !== '') {
    throw errors.fieldFailure('import_keywords', 'validation_keywords', message);
  }
}

module.exports = {
  guardImportKeywords: guardImportKeywords
};
