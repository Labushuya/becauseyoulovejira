// Charms of tickets and recurrence rules (ADR-0062): a small symbol before the title, chosen from
// a fixed, curated catalog. Pure CommonJS module, ES5 only, no dependencies (Goja runtime and
// Vitest). The catalog with names, groups, search words and symbols lives in the SPA
// (web/src/lib/domain/charms.ts); the server only knows the keys. tests/unit/web-charms.test.mjs
// keeps both lists and the texts equal.
'use strict';

// Every key of the catalog, in the order of the SPA. A new charm is a new key here and there.
var CHARM_KEYS = Object.freeze([
  'einkaufen',
  'paket',
  'erinnerung',
  'idee',
  'behoerde',
  'muell',
  'putzen',
  'waesche',
  'reparatur',
  'garten',
  'kochen',
  'arzt',
  'medikament',
  'sport',
  'laufen',
  'gesundheit',
  'geburtstag',
  'geschenk',
  'kind',
  'haustier',
  'familie',
  'meeting',
  'telefon',
  'dokument',
  'mail',
  'computer',
  'flugzeug',
  'zug',
  'auto',
  'koffer',
  'urlaub',
  'rechnung',
  'geld',
  'karte',
  'sparen',
  'film',
  'musik',
  'buch',
  'essen',
  'kaffee',
  'spiel',
  'feier',
  'fahrrad'
]);

// Texts of the codes, the same in the SPA (CHARM_MESSAGES of domain/charms.ts).
var MESSAGES = Object.freeze({
  validation_charm_unknown: 'Diesen Charm gibt es nicht. Bitte einen aus der Liste wählen.'
});

function isCharmKey(value) {
  return typeof value === 'string' && CHARM_KEYS.indexOf(value) !== -1;
}

/**
 * The code a value of `charm` is refused with, '' when it may be stored: empty (no charm), a key
 * of the catalog, or the value stored before (`previous`), so a key a later version drops never
 * blocks another change of the record.
 */
function charmViolation(value, previous) {
  var text = value === null || value === undefined ? '' : String(value);
  if (text === '' || text === previous || isCharmKey(text)) {
    return '';
  }
  return 'validation_charm_unknown';
}

module.exports = {
  CHARM_KEYS: CHARM_KEYS,
  MESSAGES: MESSAGES,
  isCharmKey: isCharmKey,
  charmViolation: charmViolation
};
