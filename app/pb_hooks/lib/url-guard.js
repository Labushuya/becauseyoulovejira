// Which addresses the page copy of a web link may fetch (ADR-0031 section 6): a guard against
// server-side requests into the own network (SSRF). Only http and https, no credentials, only the
// ports 80, 443, 8080 and 8443; IP literals in every notation are parsed and refused when they are
// private, loopback, link-local, metadata, unspecified, carrier-grade NAT, benchmark, multicast,
// broadcast or reserved, also inside IPv6 (mapped, compatible, NAT64, 6to4, Teredo); names
// without a dot, localhost and local endings and known services that resolve any IP as a name are
// refused as well.
//
// Limits (ADR-0031 section 6): the JSVM cannot resolve names, so a public name that points to a
// private address is not recognised, and $http.send follows redirects by itself without naming
// the target. This module can only judge the address it is given.
//
// CommonJS module, ES5 only, no dependencies (Goja runtime and Vitest).
'use strict';

var MAX_LENGTH = 2000;
var ALLOWED_PORTS = [80, 443, 8080, 8443];

// Endings of names that never lead to a public site (RFC 6761, RFC 6762, RFC 8375, common ones).
var LOCAL_SUFFIXES = [
  'localhost',
  'local',
  'localdomain',
  'internal',
  'intranet',
  'lan',
  'home',
  'corp',
  'home.arpa',
  'test',
  'invalid',
  'example',
  'onion'
];

// Services that answer any IP address written into the name (e.g. 127.0.0.1.nip.io).
var REBINDING_DOMAINS = ['nip.io', 'sslip.io', 'xip.io', 'localtest.me', 'lvh.me', 'vcap.me'];

var MESSAGES = {
  invalid: 'Keine gültige Adresse.',
  scheme: 'Nur http- und https-Adressen.',
  credentials: 'Adressen mit Anmeldedaten werden nicht abgerufen.',
  port: 'Nur die Ports 80, 443, 8080 und 8443.',
  blocked: 'Lokale, private und interne Adressen werden nicht abgerufen.'
};

function fail(reason) {
  return { ok: false, reason: reason, message: MESSAGES[reason] };
}

function pass(url, host, port) {
  return { ok: true, url: url, host: host, port: port };
}

// One part of a loose IPv4 literal (inet_aton): decimal, octal with a leading 0, or hex with 0x.
function ipv4Part(text) {
  if (/^0x[0-9a-f]*$/i.test(text)) {
    return text.length === 2 ? 0 : parseInt(text.slice(2), 16);
  }
  if (/^0[0-7]*$/.test(text)) {
    return parseInt(text, 8);
  }
  if (/^[1-9][0-9]*$/.test(text)) {
    return parseInt(text, 10);
  }
  return NaN;
}

/**
 * The four octets of an IPv4 literal in any inet_aton notation ("127.0.0.1", "2130706433",
 * "0x7f.1", "0177.0.0.01"), or null. Up to four parts; the last one fills the remaining bytes.
 */
function parseIPv4(host) {
  var parts = String(host).split('.');
  if (parts.length > 4) {
    return null;
  }
  var values = [];
  for (var i = 0; i < parts.length; i++) {
    var value = parts[i].length > 12 ? NaN : ipv4Part(parts[i]);
    if (isNaN(value)) {
      return null;
    }
    values.push(value);
  }
  var last = values.pop();
  var number = 0;
  for (var j = 0; j < values.length; j++) {
    if (values[j] > 255) {
      return null;
    }
    number = number * 256 + values[j];
  }
  var room = Math.pow(256, 4 - values.length);
  if (last >= room) {
    return null;
  }
  number = number * room + last;
  return [
    Math.floor(number / 16777216) % 256,
    Math.floor(number / 65536) % 256,
    Math.floor(number / 256) % 256,
    number % 256
  ];
}

/** True for an IPv4 address that must not be fetched (RFC 6890 and neighbours). */
function isBlockedIPv4(octets) {
  var a = octets[0];
  var b = octets[1];
  var c = octets[2];
  return (
    a === 0 || // "this network"
    a === 10 || // private
    a === 127 || // loopback
    a >= 224 || // multicast, reserved, broadcast
    (a === 100 && b >= 64 && b <= 127) || // carrier-grade NAT (also cloud metadata 100.100.100.200)
    (a === 169 && b === 254) || // link-local, metadata 169.254.169.254
    (a === 172 && b >= 16 && b <= 31) || // private
    (a === 192 && b === 0 && (c === 0 || c === 2)) || // IETF protocol assignments, documentation
    (a === 192 && b === 88 && c === 99) || // 6to4 relay
    (a === 192 && b === 168) || // private
    (a === 198 && (b === 18 || b === 19)) || // benchmark
    (a === 198 && b === 51 && c === 100) || // documentation
    (a === 203 && b === 0 && c === 113) // documentation
  );
}

// 16-bit groups of one side of "::" ("" gives none), or null for a bad group.
function hexGroups(part) {
  if (part === '') {
    return [];
  }
  var list = part.split(':');
  var result = [];
  for (var i = 0; i < list.length; i++) {
    if (!/^[0-9a-f]{1,4}$/.test(list[i])) {
      return null;
    }
    result.push(parseInt(list[i], 16));
  }
  return result;
}

/** The eight 16-bit groups of an IPv6 literal (without brackets and zone), or null. */
function parseIPv6(text) {
  var value = String(text).toLowerCase();
  if (!/^[0-9a-f:.]+$/.test(value) || value.indexOf(':::') !== -1) {
    return null;
  }
  var tail = [];
  if (value.indexOf('.') !== -1) {
    // An IPv4 address as the last 32 bits ("::ffff:127.0.0.1").
    var cut = value.lastIndexOf(':');
    var v4 = value.slice(cut + 1);
    if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(v4)) {
      return null;
    }
    var octets = v4.split('.');
    for (var k = 0; k < 4; k++) {
      octets[k] = parseInt(octets[k], 10);
      if (octets[k] > 255) {
        return null;
      }
    }
    tail = [octets[0] * 256 + octets[1], octets[2] * 256 + octets[3]];
    value = value.slice(0, cut + 1);
    if (value.slice(-2) !== '::') {
      value = value.slice(0, -1);
    }
  }
  var halves = value.split('::');
  if (halves.length > 2) {
    return null;
  }
  var head = hexGroups(halves[0]);
  var rest = halves.length === 2 ? hexGroups(halves[1]) : [];
  if (head === null || rest === null) {
    return null;
  }
  var count = head.length + rest.length + tail.length;
  if (halves.length === 1 ? count !== 8 : count > 7) {
    return null;
  }
  var result = head.slice();
  for (var z = 0; z < 8 - count; z++) {
    result.push(0);
  }
  return result.concat(rest, tail);
}

function embeddedIPv4(high, low) {
  return [Math.floor(high / 256), high % 256, Math.floor(low / 256), low % 256];
}

function zeroUpTo(groups, end) {
  for (var i = 0; i < end; i++) {
    if (groups[i] !== 0) {
      return false;
    }
  }
  return true;
}

/** True for an IPv6 address that must not be fetched, including IPv4 inside it. */
function isBlockedIPv6(g) {
  if (zeroUpTo(g, 5) && g[5] === 0xffff) {
    return isBlockedIPv4(embeddedIPv4(g[6], g[7])); // IPv4-mapped
  }
  if (zeroUpTo(g, 6)) {
    return true; // unspecified, loopback and the deprecated IPv4-compatible addresses
  }
  if (g[0] === 0x64 && g[1] === 0xff9b) {
    // NAT64: the well-known prefix carries an IPv4 address, the local-use prefix is private.
    return !zeroUpTo(g.slice(2), 4) || isBlockedIPv4(embeddedIPv4(g[6], g[7]));
  }
  if (g[0] === 0x2002) {
    return isBlockedIPv4(embeddedIPv4(g[1], g[2])); // 6to4
  }
  return (
    (g[0] & 0xfe00) === 0xfc00 || // unique local
    (g[0] & 0xffc0) === 0xfe80 || // link-local
    (g[0] & 0xffc0) === 0xfec0 || // site-local (deprecated)
    (g[0] & 0xff00) === 0xff00 || // multicast
    (g[0] === 0x2001 && g[1] === 0) || // Teredo, carries an obfuscated IPv4 address
    (g[0] === 0x2001 && g[1] === 0x0db8) || // documentation
    (g[0] === 0x0100 && zeroUpTo(g.slice(1), 3)) // discard
  );
}

function endsWith(host, suffix) {
  return host === suffix || host.slice(-(suffix.length + 1)) === '.' + suffix;
}

/** True for a name that is local by itself or resolves any address written into it. */
function isBlockedName(host) {
  if (host.indexOf('.') === -1) {
    return true;
  }
  var lists = [LOCAL_SUFFIXES, REBINDING_DOMAINS];
  for (var l = 0; l < lists.length; l++) {
    for (var i = 0; i < lists[l].length; i++) {
      if (endsWith(host, lists[l][i])) {
        return true;
      }
    }
  }
  return false;
}

// A host name of ASCII labels (a-z, 0-9, "-"), up to 253 characters.
function isHostName(host) {
  if (host.length > 253 || !/^[a-z0-9.-]+$/.test(host)) {
    return false;
  }
  var labels = host.split('.');
  for (var i = 0; i < labels.length; i++) {
    var label = labels[i];
    if (label === '' || label.length > 63 || /^-|-$/.test(label)) {
      return false;
    }
  }
  return true;
}

// Host and port of the authority ("host", "host:8080", "[::1]:443"), or null.
function splitAuthority(authority) {
  if (authority.charAt(0) === '[') {
    var close = authority.indexOf(']');
    var after = close === -1 ? '' : authority.slice(close + 1);
    if (close === -1 || (after !== '' && !/^:\d*$/.test(after))) {
      return null;
    }
    return { host: authority.slice(1, close).toLowerCase(), port: after.slice(1), bracketed: true };
  }
  var colon = authority.lastIndexOf(':');
  return {
    host: (colon === -1 ? authority : authority.slice(0, colon)).toLowerCase().replace(/\.+$/, ''),
    port: colon === -1 ? '' : authority.slice(colon + 1),
    bracketed: false
  };
}

/**
 * Checks an address before the page copy fetches it. Returns { ok: true, url, host, port } or
 * { ok: false, reason, message } with a German message. `testPort` (only tests set it, through
 * BYL_TEST_PAGE_PORT) allows exactly 127.0.0.1 on that port, for a fake server.
 */
function checkUrl(value, testPort) {
  var url = typeof value === 'string' ? value.replace(/^\s+|\s+$/g, '') : '';
  if (url === '' || url.length > MAX_LENGTH || /[\s\u0000-\u001f\u007f\\]/.test(url)) {
    return fail('invalid');
  }
  var match = /^([a-z][a-z0-9+.-]*):\/\/([^\/?#]*)([^#]*)(#[\s\S]*)?$/i.exec(url);
  if (!match) {
    return fail(/^[a-z][a-z0-9+.-]*:/i.test(url) && !/^https?:/i.test(url) ? 'scheme' : 'invalid');
  }
  var scheme = match[1].toLowerCase();
  if (scheme !== 'http' && scheme !== 'https') {
    return fail('scheme');
  }
  if (match[2].indexOf('@') !== -1) {
    return fail('credentials');
  }
  var authority = splitAuthority(match[2]);
  if (authority === null || authority.host === '' || !/^\d{0,5}$/.test(authority.port)) {
    return fail('invalid');
  }
  var host = authority.host;
  var port = authority.port === '' ? (scheme === 'https' ? 443 : 80) : parseInt(authority.port, 10);
  if (port < 1 || port > 65535) {
    return fail('invalid');
  }
  if (testPort && !authority.bracketed && host === '127.0.0.1' && port === testPort) {
    return pass(url, host, port);
  }
  if (ALLOWED_PORTS.indexOf(port) === -1) {
    return fail('port');
  }
  if (authority.bracketed) {
    var groups = parseIPv6(host);
    if (groups === null) {
      return fail('invalid');
    }
    return isBlockedIPv6(groups) ? fail('blocked') : pass(url, host, port);
  }
  // Every label numeric: an IPv4 literal in any notation (a broken one is refused, too).
  if (/^(0x[0-9a-f]*|[0-9]+)(\.(0x[0-9a-f]*|[0-9]+))*$/i.test(host)) {
    var octets = parseIPv4(host);
    return octets === null || isBlockedIPv4(octets) ? fail('blocked') : pass(url, host, port);
  }
  if (!isHostName(host)) {
    return fail('invalid');
  }
  return isBlockedName(host) ? fail('blocked') : pass(url, host, port);
}

module.exports = {
  ALLOWED_PORTS: ALLOWED_PORTS,
  MESSAGES: MESSAGES,
  parseIPv4: parseIPv4,
  parseIPv6: parseIPv6,
  isBlockedIPv4: isBlockedIPv4,
  isBlockedIPv6: isBlockedIPv6,
  checkUrl: checkUrl
};
