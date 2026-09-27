// Pure rules of the page copy of a web link (ADR-0031 section 6): which answers are taken, which
// character set a page has, how its bytes become text, how much is kept, and the new text and
// source_meta of the inbox item. The fetch itself is in lib/page-copy-service.js.
// CommonJS module, ES5 only, no dependencies (Goja runtime and Vitest).
'use strict';

// At most this much of a page is kept (the Range header asks the server for no more).
var MAX_PAGE_BYTES = 2 * 1024 * 1024;
var TIMEOUT_SECONDS = 10;
// Longest title of a page kept in source_meta (its whole size is limited to 20 000 bytes).
var TITLE_MAX_LENGTH = 300;
var SEPARATOR = '\n\n---\n\n';
var EMPTY_PAGE_TEXT = '(Die Seite enthält keinen lesbaren Text.)';

// Windows-1252 at 0x80 to 0x9F; the rest of the byte range is Latin-1 (ISO-8859-1).
var CP1252 = [
  0x20ac, 0x81, 0x201a, 0x192, 0x201e, 0x2026, 0x2020, 0x2021, 0x2c6, 0x2030, 0x160, 0x2039, 0x152, 0x8d, 0x17d, 0x8f,
  0x90, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014, 0x2dc, 0x2122, 0x161, 0x203a, 0x153, 0x9d, 0x17e, 0x178
];

// Character sets read as Windows-1252 (a superset of Latin-1, as browsers do).
var SINGLE_BYTE = ['iso-8859-1', 'iso8859-1', 'latin1', 'l1', 'windows-1252', 'cp1252', 'iso-8859-15', 'latin-9', 'us-ascii', 'ascii'];

/** True for a status the copy takes: 200, or 206 for a server that honours the Range header. */
function isAcceptedStatus(status) {
  return status === 200 || status === 206;
}

/** True for an HTML answer (text/html or application/xhtml+xml, with or without parameters). */
function isHtmlType(contentType) {
  return /^\s*(text\/html|application\/xhtml\+xml)\s*(;|$)/i.test(String(contentType || ''));
}

/**
 * Character set of a page, lower case: from the Content-Type, else from a <meta> in the first
 * 4096 characters (`head`), else utf-8.
 */
function charsetOf(contentType, head) {
  var fromHeader = /;\s*charset\s*=\s*"?([a-z0-9._:-]+)/i.exec(String(contentType || ''));
  if (fromHeader) {
    return fromHeader[1].toLowerCase();
  }
  var start = String(head || '').slice(0, 4096);
  var fromMeta = /<meta\b[^>]*\bcharset\s*=\s*["']?([a-z0-9._:-]+)/i.exec(start);
  return fromMeta ? fromMeta[1].toLowerCase() : 'utf-8';
}

/** True for a character set whose bytes are read one by one as Windows-1252. */
function isSingleByte(charset) {
  return SINGLE_BYTE.indexOf(String(charset).toLowerCase()) !== -1;
}

/** The first `length` bytes (array-like of numbers) as Windows-1252 text. */
function decodeWindows1252(bytes, length) {
  var parts = [];
  var chunk = [];
  for (var i = 0; i < length; i++) {
    var byte = bytes[i] & 0xff;
    chunk.push(byte >= 0x80 && byte <= 0x9f ? CP1252[byte - 0x80] : byte);
    if (chunk.length === 4096) {
      parts.push(String.fromCharCode.apply(null, chunk));
      chunk = [];
    }
  }
  parts.push(String.fromCharCode.apply(null, chunk));
  return parts.join('');
}

// UTF-8 length of the character (or surrogate pair) at `index`, and how many UTF-16 units it takes.
function utf8Char(text, index) {
  var code = text.charCodeAt(index);
  if (code < 0x80) {
    return { bytes: 1, units: 1 };
  }
  if (code < 0x800) {
    return { bytes: 2, units: 1 };
  }
  var next = text.charCodeAt(index + 1);
  if (code >= 0xd800 && code <= 0xdbff && next >= 0xdc00 && next <= 0xdfff) {
    return { bytes: 4, units: 2 };
  }
  return { bytes: 3, units: 1 };
}

/** Number of bytes of `text` in UTF-8. */
function utf8Length(text) {
  var value = String(text);
  var total = 0;
  for (var i = 0; i < value.length; ) {
    var char = utf8Char(value, i);
    total += char.bytes;
    i += char.units;
  }
  return total;
}

/** The longest start of `text` that takes at most `maxBytes` bytes in UTF-8, never half a character. */
function utf8Prefix(text, maxBytes) {
  var value = String(text);
  var total = 0;
  for (var i = 0; i < value.length; ) {
    var char = utf8Char(value, i);
    if (total + char.bytes > maxBytes) {
      return value.slice(0, i);
    }
    total += char.bytes;
    i += char.units;
  }
  return value;
}

/**
 * The new text of the item: the excerpt it had, a line, then the text of the page (or a note for a
 * page without text), cut to `maxLength` characters by `truncate` (inbox-rules.truncate).
 */
function composeBody(excerpt, pageText, maxLength, truncate) {
  var text = String(pageText || '').replace(/^\s+|\s+$/g, '') || EMPTY_PAGE_TEXT;
  var before = String(excerpt || '').replace(/^\s+|\s+$/g, '');
  return truncate(before === '' ? text : before + SEPARATOR + text, maxLength);
}

/**
 * source_meta after the copy: the existing keys and `page` with the time, the size of the answer,
 * whether it was cut, its character set and its title.
 */
function pageMeta(meta, info) {
  var result = {};
  for (var key in meta) {
    if (Object.prototype.hasOwnProperty.call(meta, key)) {
      result[key] = meta[key];
    }
  }
  result.page = {
    fetched_at: info.fetchedAt,
    size: info.size,
    truncated: info.truncated === true,
    charset: info.charset,
    title: String(info.title || '').slice(0, TITLE_MAX_LENGTH)
  };
  return result;
}

module.exports = {
  MAX_PAGE_BYTES: MAX_PAGE_BYTES,
  TIMEOUT_SECONDS: TIMEOUT_SECONDS,
  EMPTY_PAGE_TEXT: EMPTY_PAGE_TEXT,
  isAcceptedStatus: isAcceptedStatus,
  isHtmlType: isHtmlType,
  charsetOf: charsetOf,
  isSingleByte: isSingleByte,
  decodeWindows1252: decodeWindows1252,
  utf8Length: utf8Length,
  utf8Prefix: utf8Prefix,
  composeBody: composeBody,
  pageMeta: pageMeta
};
