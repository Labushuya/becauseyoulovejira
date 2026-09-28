// Keywords per channel (ADR-0020; E4 plan package 20): which text of a channel counts as a match.
// Pure CommonJS module, ES5 only, no dependencies (Goja runtime and Vitest). Mirrored in
// web/src/lib/domain/keywords.ts; tests/unit/web-keywords.test.mjs compares both.
//
// Matching ignores case and umlauts and looks for the start of a word:
// - lower case with toLowerCase (no locale function), umlauts and accents through a fixed table
//   (no String.prototype.normalize and no internationalisation API; ADR-0005), white space collapsed to one space;
// - two foldings: "ä" as "a" and as "ae" (both "ß" as "ss"); a keyword matches if it matches in
//   one of them, so "prüfen", "pruefen" and "prufen" find each other;
// - a keyword matches where the text starts with it and the character before is the start of the
//   text or no word character; nothing is required after it ("todo" matches "todos", not
//   "fotodoku"). Keywords may consist of several words.
'use strict';

var MAX_KEYWORDS = 50;
var MAX_LENGTH = 100;
// Characters searched per text part of a mail with settings.match_body (the text, the HTML part
// as text, each header): as many as the text of an inbox entry holds (inbox_items.body). Before
// the decision of 2026-09-27 (ADR-0020 addendum 2) only the first 500 characters of the text.
var MAIL_TEXT_MAX_CHARS = 100000;
// Most further text parts of a mail besides subject, sender and text (headers, HTML part).
var MAIL_EXTRA_TEXTS_MAX = 12;
// Whether the sender of a mail (name and address, as source_meta.from) is searched as well
// (user feedback, package A; ADR-0020 addendum). On for every mail: mailbox, mailbox selection and
// .eml files.
var MAIL_MATCH_FROM = true;
var SUGGESTIONS = ['todo', 'aufgabe', 'erledigen', 'ticket', '#byl'];

var MESSAGE = 'Stichwörter: höchstens 50, je 1 bis 100 Zeichen, ohne Zeilenumbruch.';

// Kinds of file imports with their own list (users.import_keywords, ADR-0020 section 3) and the
// keys each may have; only mail files search the start of the text on request.
// The own inbox (ADR-0038) keeps the lists of its channels in the same field: "api" and
// "whatsapp-web" take an entry of the mode "auto" only with one of their keywords.
var IMPORT_KINDS = ['eml', 'ics', 'whatsapp'];
var CHANNEL_KINDS = ['api', 'whatsapp-web'];
var IMPORT_KEYS = {
  eml: ['keywords', 'match_body'],
  ics: ['keywords'],
  whatsapp: ['keywords'],
  api: ['keywords'],
  'whatsapp-web': ['keywords']
};
var IMPORT_MESSAGE = 'Unbekannte Einstellung der Stichwörter.';

// Umlauts: [fold "a", fold "ae"]; after toLowerCase.
var UMLAUTS = { 'ä': ['a', 'ae'], 'ö': ['o', 'oe'], 'ü': ['u', 'ue'] };
// Other letters, the same in both foldings. The final sigma becomes sigma: JavaScript lowers a
// word-final capital sigma to "ς", Go (Goja) to "σ".
var LETTERS = {
  'à': 'a', 'á': 'a', 'â': 'a', 'ã': 'a', 'å': 'a', 'ā': 'a', 'ă': 'a', 'ą': 'a',
  'æ': 'ae', 'ç': 'c', 'ć': 'c', 'č': 'c', 'ď': 'd', 'đ': 'd',
  'è': 'e', 'é': 'e', 'ê': 'e', 'ë': 'e', 'ē': 'e', 'ė': 'e', 'ę': 'e', 'ě': 'e',
  'ì': 'i', 'í': 'i', 'î': 'i', 'ï': 'i', 'ī': 'i', 'į': 'i', 'ı': 'i',
  'ł': 'l', 'ñ': 'n', 'ń': 'n', 'ň': 'n',
  'ò': 'o', 'ó': 'o', 'ô': 'o', 'õ': 'o', 'ø': 'o', 'ō': 'o', 'ő': 'o', 'œ': 'oe',
  'ř': 'r', 'ß': 'ss', 'ẞ': 'ss', 'ś': 's', 'š': 's', 'ş': 's', 'ť': 't', 'ţ': 't',
  'ù': 'u', 'ú': 'u', 'û': 'u', 'ů': 'u', 'ū': 'u', 'ű': 'u', 'ų': 'u',
  'ý': 'y', 'ÿ': 'y', 'ź': 'z', 'ż': 'z', 'ž': 'z', 'ς': 'σ'
};
var DIAERESIS = 0x0308;
// White space including the no-break and typographic spaces.
var SPACE = /[\s\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]+/g;

function text(value) {
  return value === undefined || value === null ? '' : String(value);
}

function isCombining(code) {
  return code >= 0x0300 && code <= 0x036f;
}

/**
 * The text in one folding ('a' or 'ae'): lower case, umlauts and accents replaced, combining
 * marks removed (a following U+0308 after a, o or u counts as the umlaut), white space collapsed.
 */
function fold(value, variant) {
  var source = text(value).toLowerCase();
  // Parts joined once at the end: repeated concatenation of long mail texts is slow in Goja.
  var out = [];
  for (var i = 0; i < source.length; i++) {
    var ch = source.charAt(i);
    var code = source.charCodeAt(i);
    if (isCombining(code)) {
      continue;
    }
    var umlaut = UMLAUTS[ch];
    if (umlaut) {
      out.push(variant === 'ae' ? umlaut[1] : umlaut[0]);
      continue;
    }
    if (Object.prototype.hasOwnProperty.call(LETTERS, ch)) {
      out.push(LETTERS[ch]);
      continue;
    }
    if ((ch === 'a' || ch === 'o' || ch === 'u') && source.charCodeAt(i + 1) === DIAERESIS) {
      out.push(variant === 'ae' ? ch + 'e' : ch);
      i++;
      continue;
    }
    out.push(ch);
  }
  return out.join('').replace(SPACE, ' ').replace(/^ | $/g, '');
}

/**
 * Whether a character (one UTF-16 unit) belongs to a word: a-z, 0-9 and letters of other
 * scripts; not: punctuation and symbols of Latin-1, general punctuation and symbols
 * (U+2000-U+2BFF), CJK punctuation, variation selectors and surrogates (emoji).
 */
function isWordChar(ch) {
  var code = ch.charCodeAt(0);
  if ((code >= 0x61 && code <= 0x7a) || (code >= 0x30 && code <= 0x39)) {
    return true;
  }
  if (code < 0xc0 || code === 0xd7 || code === 0xf7) {
    return false;
  }
  if ((code >= 0x2000 && code <= 0x2bff) || (code >= 0x3000 && code <= 0x303f)) {
    return false;
  }
  if ((code >= 0xd800 && code <= 0xdfff) || (code >= 0xfe00 && code <= 0xfe0f)) {
    return false;
  }
  return true;
}

// Whether `needle` occurs in `haystack` at the start of a word.
function startsWordAt(haystack, needle) {
  if (needle === '') {
    return false;
  }
  var from = 0;
  while (from <= haystack.length - needle.length) {
    var index = haystack.indexOf(needle, from);
    if (index === -1) {
      return false;
    }
    if (index === 0 || !isWordChar(haystack.charAt(index - 1))) {
      return true;
    }
    from = index + 1;
  }
  return false;
}

/**
 * The first keyword of `keywords` (as stored, trimmed) that matches one of `texts`, or ''.
 * `texts` are searched one by one: a keyword across two parts does not match.
 */
function matchKeyword(keywords, texts) {
  var list = keywords || [];
  var parts = [];
  for (var t = 0; t < (texts || []).length; t++) {
    var raw = text(texts[t]);
    if (raw !== '') {
      parts.push([fold(raw, 'a'), fold(raw, 'ae')]);
    }
  }
  for (var k = 0; k < list.length; k++) {
    var keyword = text(list[k]).replace(/^\s+|\s+$/g, '');
    var shortForm = fold(keyword, 'a');
    var longForm = fold(keyword, 'ae');
    for (var p = 0; p < parts.length; p++) {
      if (startsWordAt(parts[p][0], shortForm) || startsWordAt(parts[p][1], longForm)) {
        return keyword;
      }
    }
  }
  return '';
}

/** Key of a keyword for duplicates: both foldings. */
function keyOf(keyword) {
  var value = text(keyword);
  return fold(value, 'a') + '\n' + fold(value, 'ae');
}

/**
 * Checks a stored list (JSON value): an array of at most 50 strings, each 1 to 100 characters
 * after trimming, without line breaks. undefined and null count as an empty list. Returns '' or
 * the message.
 */
function listViolation(value) {
  if (value === undefined || value === null) {
    return '';
  }
  if (Object.prototype.toString.call(value) !== '[object Array]' || value.length > MAX_KEYWORDS) {
    return MESSAGE;
  }
  for (var i = 0; i < value.length; i++) {
    if (typeof value[i] !== 'string') {
      return MESSAGE;
    }
    var keyword = value[i].replace(/^\s+|\s+$/g, '');
    if (keyword === '' || keyword.length > MAX_LENGTH || /[\r\n]/.test(keyword) || fold(keyword, 'a') === '') {
      return MESSAGE;
    }
  }
  return '';
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && Object.prototype.toString.call(value) === '[object Object]';
}

/**
 * Checks users.import_keywords (parsed JSON; null, undefined and '' count as not set): only the
 * kinds of IMPORT_KINDS and CHANNEL_KINDS with their keys, valid lists and a boolean match_body.
 * Returns '' or the message.
 */
function importSettingsViolation(value) {
  if (value === undefined || value === null || value === '') {
    return '';
  }
  if (!isPlainObject(value)) {
    return IMPORT_MESSAGE;
  }
  for (var kind in value) {
    if (!Object.prototype.hasOwnProperty.call(value, kind)) {
      continue;
    }
    var entry = value[kind];
    if (!Object.prototype.hasOwnProperty.call(IMPORT_KEYS, kind) || !isPlainObject(entry)) {
      return IMPORT_MESSAGE;
    }
    for (var key in entry) {
      if (Object.prototype.hasOwnProperty.call(entry, key) && IMPORT_KEYS[kind].indexOf(key) === -1) {
        return IMPORT_MESSAGE;
      }
    }
    if (entry.match_body !== undefined && typeof entry.match_body !== 'boolean') {
      return IMPORT_MESSAGE;
    }
    var violation = listViolation(entry.keywords);
    if (violation !== '') {
      return violation;
    }
  }
  return '';
}

/** { keywords, matchBody } of one kind of file import; missing or invalid values count as none. */
function importSettingsOf(value, kind) {
  var entry = isPlainObject(value) && isPlainObject(value[kind]) ? value[kind] : {};
  return { keywords: listOf(entry.keywords), matchBody: kind === 'eml' && entry.match_body === true };
}

/**
 * Texts of a mail that are searched (ADR-0020 section 1 and addenda): the subject, the sender
 * ("Name <address>", with MAIL_MATCH_FROM) and, with `matchBody`, the text and the `extra` parts
 * (the headers To, Cc, Reply-To, Sender, List-Id and Organization and the HTML part as text; at
 * most MAIL_EXTRA_TEXTS_MAX), each up to MAIL_TEXT_MAX_CHARS characters. Each is its own part.
 * Mirrors mailKeywordTexts of the web app.
 */
function mailTexts(title, body, matchBody, from, extra) {
  var texts = [text(title)];
  if (MAIL_MATCH_FROM && typeof from === 'string' && from !== '') {
    texts.push(from);
  }
  if (matchBody) {
    texts.push(text(body).slice(0, MAIL_TEXT_MAX_CHARS));
    var more = Object.prototype.toString.call(extra) === '[object Array]' ? extra : [];
    for (var i = 0; i < more.length && i < MAIL_EXTRA_TEXTS_MAX; i++) {
      if (typeof more[i] === 'string' && more[i] !== '') {
        texts.push(more[i].slice(0, MAIL_TEXT_MAX_CHARS));
      }
    }
  }
  return texts;
}

/** The usable keywords of a stored value: invalid entries are left out, never an error. */
function listOf(value) {
  if (Object.prototype.toString.call(value) !== '[object Array]') {
    return [];
  }
  var list = [];
  for (var i = 0; i < value.length && list.length < MAX_KEYWORDS; i++) {
    if (typeof value[i] !== 'string') {
      continue;
    }
    var keyword = value[i].replace(/^\s+|\s+$/g, '');
    if (keyword !== '' && keyword.length <= MAX_LENGTH && fold(keyword, 'a') !== '') {
      list.push(keyword);
    }
  }
  return list;
}

module.exports = {
  MAX_KEYWORDS: MAX_KEYWORDS,
  MAX_LENGTH: MAX_LENGTH,
  MAIL_TEXT_MAX_CHARS: MAIL_TEXT_MAX_CHARS,
  MAIL_EXTRA_TEXTS_MAX: MAIL_EXTRA_TEXTS_MAX,
  MAIL_MATCH_FROM: MAIL_MATCH_FROM,
  SUGGESTIONS: SUGGESTIONS,
  MESSAGE: MESSAGE,
  IMPORT_KINDS: IMPORT_KINDS,
  CHANNEL_KINDS: CHANNEL_KINDS,
  IMPORT_MESSAGE: IMPORT_MESSAGE,
  importSettingsViolation: importSettingsViolation,
  importSettingsOf: importSettingsOf,
  fold: fold,
  isWordChar: isWordChar,
  matchKeyword: matchKeyword,
  mailTexts: mailTexts,
  keyOf: keyOf,
  listViolation: listViolation,
  listOf: listOf
};
