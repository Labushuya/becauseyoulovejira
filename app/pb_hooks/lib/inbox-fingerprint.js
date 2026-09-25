// Duplicate key of an inbox item (ADR-0014 section 3). Pure CommonJS module, ES5 only, no
// dependencies (Goja runtime and Vitest): the hash function and the random ID are parameters, so
// the hook passes $security.sha256 / $security.randomString and Vitest node:crypto.
//
// The key does not depend on the channel alone but on its family: the same mail as a file (eml)
// and from the mailbox (mail), the same event from a file (ics) and from the feed (calendar)
// give the same key. Parts are joined with "|"; a "|" or "\" inside a part is escaped, so two
// different part lists never give the same key.
'use strict';

var MAIL_CHANNELS = ['eml', 'mail'];
var EVENT_CHANNELS = ['ics', 'calendar'];
var MANUAL_CHANNELS = ['manual', 'quick', 'clipboard'];

var DEFAULT_PORTS = { http: ':80', https: ':443' };

function text(value) {
  return value === undefined || value === null ? '' : String(value);
}

function trim(value) {
  return text(value).replace(/^\s+|\s+$/g, '');
}

// Trimmed, whitespace runs (line breaks included) collapsed to one space.
function collapse(value) {
  return trim(value).replace(/\s+/g, ' ');
}

function part(value) {
  return text(value).replace(/\\/g, '\\\\').replace(/\|/g, '\\|');
}

function join(parts) {
  var escaped = [];
  for (var i = 0; i < parts.length; i++) {
    escaped.push(i === 0 ? parts[i] : part(parts[i]));
  }
  return escaped.join('|');
}

// Message-ID without angle brackets, lower case: "<AbC@Host>" and "abc@host" are the same mail.
function normalizeMessageId(value) {
  return trim(value).replace(/^<+/, '').replace(/>+$/, '').replace(/^\s+|\s+$/g, '').toLowerCase();
}

// Query parameter name without its value; "utm_source=x" -> "utm_source".
function paramName(param) {
  var eq = param.indexOf('=');
  return eq === -1 ? param : param.slice(0, eq);
}

// Web link as duplicate key: scheme and host in lower case, default port and fragment removed,
// empty path as "/", utm_* parameters removed (the order of the others is kept). Anything that
// does not look like scheme://authority stays as it is (trimmed, without fragment).
function normalizeUrl(value) {
  var url = trim(value);
  var hashAt = url.indexOf('#');
  if (hashAt !== -1) {
    url = url.slice(0, hashAt);
  }
  var match = /^([a-zA-Z][a-zA-Z0-9+.\-]*):\/\/([^\/?]*)([^?]*)(\?.*)?$/.exec(url);
  if (!match) {
    return url;
  }
  var scheme = match[1].toLowerCase();
  var authority = match[2];
  var at = authority.lastIndexOf('@');
  var userinfo = at === -1 ? '' : authority.slice(0, at + 1);
  var host = (at === -1 ? authority : authority.slice(at + 1)).toLowerCase();
  var defaultPort = DEFAULT_PORTS[scheme];
  if (defaultPort && host.length > defaultPort.length &&
      host.slice(host.length - defaultPort.length) === defaultPort) {
    host = host.slice(0, host.length - defaultPort.length);
  }
  var path = match[3] === '' ? '/' : match[3];
  var kept = [];
  var params = match[4] ? match[4].slice(1).split('&') : [];
  for (var i = 0; i < params.length; i++) {
    if (params[i] !== '' && !/^utm_/i.test(paramName(params[i]))) {
      kept.push(params[i]);
    }
  }
  return scheme + '://' + userinfo + host + path + (kept.length > 0 ? '?' + kept.join('&') : '');
}

function contains(list, value) {
  return list.indexOf(value) !== -1;
}

/**
 * Duplicate key of an item before hashing.
 * item: { channel, title, body, source_url, source_ref, source_date, meta } with meta the parsed
 * source_meta object (from, recurrence_id, chat, sender). newId: random ID for the manual
 * channels, which have no hard duplicate check (twice "Milch kaufen" is allowed).
 * Returns { key } or { key: '', missing: <field> } if the family needs a value that is empty.
 */
function fingerprintKey(item, newId) {
  var channel = text(item.channel);
  var meta = item.meta && typeof item.meta === 'object' ? item.meta : {};
  var ref = trim(item.source_ref);

  if (contains(MAIL_CHANNELS, channel)) {
    if (ref !== '') {
      return { key: join(['mail', normalizeMessageId(ref)]) };
    }
    return {
      key: join(['mailx', trim(meta.from).toLowerCase(), text(item.source_date), collapse(item.title)])
    };
  }
  if (contains(EVENT_CHANNELS, channel)) {
    if (ref !== '') {
      return { key: join(['event', ref, trim(meta.recurrence_id)]) };
    }
    return { key: join(['eventx', collapse(item.title), text(item.source_date)]) };
  }
  if (channel === 'telegram') {
    var colon = ref.lastIndexOf(':');
    if (colon <= 0 || colon === ref.length - 1) {
      return { key: '', missing: 'source_ref' };
    }
    return { key: join(['telegram', ref.slice(0, colon), ref.slice(colon + 1)]) };
  }
  if (channel === 'whatsapp') {
    return {
      key: join([
        'whatsapp',
        collapse(meta.chat),
        text(item.source_date),
        collapse(meta.sender),
        collapse(item.body)
      ])
    };
  }
  if (channel === 'link') {
    if (trim(item.source_url) === '') {
      return { key: '', missing: 'source_url' };
    }
    return { key: join(['link', normalizeUrl(item.source_url)]) };
  }
  if (channel === 'notion') {
    if (ref === '') {
      return { key: '', missing: 'source_ref' };
    }
    return { key: join(['notion', ref]) };
  }
  if (contains(MANUAL_CHANNELS, channel)) {
    return { key: join(['manual', text(newId)]) };
  }
  throw new Error('fingerprintKey: unknown channel ' + channel);
}

/**
 * Fingerprint = hash(key). `hash` maps a string to a hex digest (sha256).
 * Returns { fingerprint } or { fingerprint: '', missing: <field> }.
 */
function fingerprint(item, hash, newId) {
  var result = fingerprintKey(item, newId);
  if (result.key === '') {
    return { fingerprint: '', missing: result.missing };
  }
  return { fingerprint: String(hash(result.key)) };
}

module.exports = {
  normalizeMessageId: normalizeMessageId,
  normalizeUrl: normalizeUrl,
  fingerprintKey: fingerprintKey,
  fingerprint: fingerprint
};
