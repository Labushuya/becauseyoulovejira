// Atomic ticket numbers per counter key (CLAUDE.md section 5, E1 plan OF-1).
// CommonJS module, ES5 only. Runs in the Goja runtime of PocketBase: uses the JSVM globals
// `$security` and `DynamicModel`, but never `$app`; the caller passes the transaction app.
'use strict';

// Creates a missing counter with value 1, otherwise increments it; the write lock is taken
// immediately, so concurrent ticket creations are serialized and numbers stay gapless.
var NEXT_VALUE_SQL =
  'INSERT INTO ticket_counters (id, key, value) VALUES ({:id}, {:key}, 1) ' +
  'ON CONFLICT(key) DO UPDATE SET value = value + 1 RETURNING value';

var ID_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';
var ID_LENGTH = 15;

// Returns the next number for `key`. `txApp` must be the app of the transaction that also saves
// the ticket; a rollback of that transaction then also reverts the counter.
function nextValue(txApp, key) {
  if (typeof key !== 'string' || key === '') {
    throw new Error('counters.nextValue: key is required');
  }
  var result = new DynamicModel({ value: 0 });
  txApp
    .db()
    .newQuery(NEXT_VALUE_SQL)
    .bind({ id: $security.randomStringWithAlphabet(ID_LENGTH, ID_ALPHABET), key: key })
    .one(result);
  var value = result.value;
  if (typeof value !== 'number' || value < 1 || Math.floor(value) !== value) {
    throw new Error('counters.nextValue: unexpected counter value');
  }
  return value;
}

module.exports = {
  NEXT_VALUE_SQL: NEXT_VALUE_SQL,
  ID_ALPHABET: ID_ALPHABET,
  ID_LENGTH: ID_LENGTH,
  nextValue: nextValue
};
