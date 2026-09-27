// Plain text of an HTML page for the page copy of a web link (ADR-0031 section 6). An ES5 copy of
// htmlToText in web/src/lib/domain/inbox-mail.ts (ADR-0017 section 2), so the hook extracts the
// same text as the SPA does for HTML mails; tests/unit/html-text.test.mjs keeps both equal.
// Scripts, styles, the head, comments, images and embedded objects are removed; block elements
// and `br` become line breaks, list items "- ", table cells " | "; links keep their text with an
// http(s) or mailto address in brackets; entities are decoded once.
// CommonJS module, ES5 only, no dependencies (Goja runtime and Vitest).
'use strict';

var NAMED_ENTITIES = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: '\u00a0',
  auml: '\u00e4',
  ouml: '\u00f6',
  uuml: '\u00fc',
  Auml: '\u00c4',
  Ouml: '\u00d6',
  Uuml: '\u00dc',
  szlig: '\u00df',
  euro: '\u20ac',
  copy: '\u00a9',
  reg: '\u00ae',
  trade: '\u2122',
  ndash: '\u2013',
  mdash: '\u2014',
  hellip: '\u2026',
  laquo: '\u00ab',
  raquo: '\u00bb',
  bdquo: '\u201e',
  ldquo: '\u201c',
  rdquo: '\u201d',
  sbquo: '\u201a',
  lsquo: '\u2018',
  rsquo: '\u2019',
  middot: '\u00b7',
  bull: '\u2022',
  shy: '',
  zwnj: '',
  zwj: ''
};

var BLOCK_TAGS =
  /<\/?(p|div|section|article|header|footer|h[1-6]|ul|ol|table|thead|tbody|tfoot|blockquote|pre|hr|center|address|form|fieldset|dl|dt|dd)\b[^>]*>/gi;

function oneLine(value) {
  return String(value).replace(/\s+/g, ' ').replace(/^ | $/g, '');
}

// A code point as string, with a surrogate pair above U+FFFF (String.fromCodePoint is ES2015).
function fromCodePoint(code) {
  if (code <= 0xffff) {
    return String.fromCharCode(code);
  }
  var offset = code - 0x10000;
  return String.fromCharCode(0xd800 + (offset >> 10), 0xdc00 + (offset & 0x3ff));
}

/** Decodes named and numeric character references; unknown ones stay as written. */
function decodeEntities(text) {
  return String(text).replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z][a-z0-9]*);/gi, function (whole, name) {
    if (name.charAt(0) === '#') {
      var hex = name.charAt(1) === 'x' || name.charAt(1) === 'X';
      var digits = name.slice(hex ? 2 : 1);
      var code = parseInt(digits, hex ? 16 : 10);
      var valid = digits.length <= 8 && code > 0 && code <= 0x10ffff;
      return valid && (code < 0xd800 || code > 0xdfff) ? fromCodePoint(code) : whole;
    }
    return Object.prototype.hasOwnProperty.call(NAMED_ENTITIES, name) ? NAMED_ENTITIES[name] : whole;
  });
}

// Value of an attribute in the text of a start tag, entities decoded; '' without one.
function attribute(tag, name) {
  var match = new RegExp('\\s' + name + '\\s*=\\s*("([^"]*)"|\'([^\']*)\'|([^\\s>]+))', 'i').exec(tag);
  var value = match ? (match[2] !== undefined ? match[2] : match[3] !== undefined ? match[3] : match[4]) : '';
  return decodeEntities(value || '').replace(/^\s+|\s+$/g, '');
}

/** Plain text of an HTML document (see the head of this file). */
function htmlToText(html) {
  var text = String(html)
    .replace(/<!--[\s\S]*?(-->|$)/g, '')
    .replace(/<(script|style|head|title|template|noscript|svg|object|iframe)\b[\s\S]*?(<\/\1\s*>|$)/gi, '')
    .replace(/<img\b[^>]*>/gi, '');
  // Entities are decoded once at the end; the label stays encoded here, the address is encoded
  // again, so nothing is decoded twice.
  text = text.replace(/<a\b([^>]*)>([\s\S]*?)<\/a\s*>/gi, function (whole, attributes, inner) {
    var label = oneLine(String(inner).replace(/<[^>]*>/g, ''));
    var plainLabel = decodeEntities(label);
    var href = attribute(' ' + attributes, 'href');
    var linkable = /^(https?:\/\/|mailto:)/i.test(href) && !/\s/.test(href);
    if (!linkable) {
      return label;
    }
    var encodedHref = href.replace(/&/g, '&amp;');
    if (label === '') {
      return encodedHref;
    }
    if (plainLabel === href || plainLabel === href.replace(/^mailto:/i, '')) {
      return label;
    }
    return label + ' (' + encodedHref + ')';
  });
  text = text
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<li\b[^>]*>/gi, '\n- ')
    .replace(/<\/li\s*>/gi, '')
    .replace(/<\/t[dh]\s*>\s*(?=<t[dh]\b)/gi, ' | ')
    .replace(/<tr\b[^>]*>/gi, '\n')
    .replace(/<\/tr\s*>/gi, '')
    .replace(BLOCK_TAGS, '\n')
    .replace(/<[^>]*>/g, '');
  var lines = decodeEntities(text).replace(/\r\n?/g, '\n').split('\n');
  for (var i = 0; i < lines.length; i++) {
    lines[i] = lines[i].replace(/[ \t\f\v\u00a0]+/g, ' ').replace(/^\s+|\s+$/g, '');
  }
  return lines
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/^\s+|\s+$/g, '');
}

/** The text of the <title> of a page, entities decoded and on one line; '' without one. */
function pageTitle(html) {
  var match = /<title\b[^>]*>([\s\S]*?)<\/title\s*>/i.exec(String(html));
  return match ? oneLine(decodeEntities(match[1].replace(/<[^>]*>/g, ''))) : '';
}

module.exports = {
  decodeEntities: decodeEntities,
  htmlToText: htmlToText,
  pageTitle: pageTitle
};
