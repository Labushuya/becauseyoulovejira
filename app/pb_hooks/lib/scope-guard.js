// Request hook of the area of a record (ADR-0058, addendum "Bereich eines Eintrags"; rule in
// lib/scope-rules.js). Only updates of the Record API pass here (also inside a batch request), so the
// saves of the server (the routes of the household, the trash, duplicating, the generation of
// recurring tasks, converting an inbox item, a later route to move records) stay free; so does a
// superuser (admin UI, repairs). CommonJS module, ES5 only, Goja runtime only.
'use strict';

var errors = require(__hooks + '/lib/errors.js');
var rules = require(__hooks + '/lib/scope-rules.js');

function placeOf(record) {
  return {
    owner: record.getString('owner'),
    household: record.getString('household'),
    scope: record.getString('scope')
  };
}

// onRecordUpdateRequest: compares the record after PocketBase took the body (every form: JSON, null,
// the modifiers "household-" and "household+", multipart) with the stored one. The update rule runs
// before this hook; it refuses a changed owner already (404) and a household without membership.
function guardUpdate(e) {
  if (e.hasSuperuserAuth()) {
    return;
  }
  var violation = rules.updateViolation(placeOf(e.record.original()), placeOf(e.record));
  if (violation) {
    throw errors.fieldFailure(violation.field, violation.code, violation.message);
  }
}

module.exports = {
  guardUpdate: guardUpdate
};
