// Pure rule of the area of a record (ADR-0058, addendum "Bereich eines Eintrags"): owner, household
// and scope of the collections with an area stay as they are through the Record API. Creating needs
// no hook: the create rules demand the signed-in account as owner and a household only with its
// membership, and PocketBase 0.40.4 checks them before any request hook; the model hooks compute the
// scope. CommonJS module, ES5 only, no dependencies; lib/scope-guard.js applies it to the requests.
'use strict';

// Every collection with owner and household (all but dependencies with a scope).
var COLLECTIONS = ['projects', 'tags', 'recurrence_rules', 'tickets', 'inbox_items', 'connections', 'dependencies'];

var MESSAGES = {
  validation_scope_locked: 'Der Bereich eines Eintrags kann nicht direkt geändert werden.',
  validation_scope_owner_locked: 'Der Besitzer eines Eintrags kann nicht geändert werden.'
};

function violation(field, code) {
  return { field: field, code: code, message: MESSAGES[code] };
}

/**
 * Update of a client: the first of owner, household and scope that differs from the stored value,
 * or null. `before` and `after` hold the three values as strings; sending them unchanged is fine.
 */
function updateViolation(before, after) {
  if (after.owner !== before.owner) {
    return violation('owner', 'validation_scope_owner_locked');
  }
  if (after.household !== before.household) {
    return violation('household', 'validation_scope_locked');
  }
  if (after.scope !== before.scope) {
    return violation('scope', 'validation_scope_locked');
  }
  return null;
}

module.exports = {
  COLLECTIONS: COLLECTIONS,
  MESSAGES: MESSAGES,
  updateViolation: updateViolation
};
