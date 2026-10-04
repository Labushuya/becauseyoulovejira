// Pure rules of the access in the home network (plan docs/plan/heimnetz.md, ADR-0055 addendum):
// which addresses other devices may use (the same rule as ConvertTo-BylLanAddress of
// app/byl-functions.ps1 and web/src/lib/domain/lan.ts, parity tests), what the running server
// allows (from its arguments), the inputs of the routes of the page "Sicherheit" and the strict
// reading of the answers of byl-control.ps1 lan-info, lan-configure and lan-firewall. CommonJS
// module, ES5 only, no dependencies (Goja runtime and Vitest load it the same way); the routes live
// in security.pb.js with lib/security-service.js.
'use strict';

// At most this many addresses: private IPv4 addresses of the computer (10/8, 172.16/12, 192.168/16,
// four decimal numbers without leading zeros, as a browser sends them in the Host header) or its
// name in the home network with a local ending (a FRITZ!Box names its devices <name>.fritz.box);
// never a port, the port stays the one of the app.
var LAN_MAX = 5;
var OCTET = '(25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])';
var IPV4 = new RegExp('^' + OCTET + '\\.' + OCTET + '\\.' + OCTET + '\\.' + OCTET + '$');
var LAN_NAME = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:fritz\.box|local|lan|home\.arpa|internal)$/;
var NAME_SUFFIXES = ['fritz.box', 'local', 'lan', 'home.arpa', 'internal'];

// Display name of the inbound rule of the Windows firewall (byl-functions.ps1 $BylLanRuleName).
var RULE_NAME = 'becauseyoulovejira (Heimnetz)';

var CATEGORIES = ['private', 'public', 'domain', 'unknown'];
var KINDS = ['ip', 'name'];
var FIREWALL_STATES = ['present', 'missing', 'mismatch', 'unknown'];
var FIREWALL_ACTIONS = ['add', 'remove'];
var OUTCOMES = ['done', 'test', 'cancelled', 'failed', 'timeout'];

function text(value) {
  return typeof value === 'string' ? value.replace(/^\s+|\s+$/g, '') : '';
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !(value instanceof Array);
}

function isCount(value) {
  return typeof value === 'number' && isFinite(value) && Math.floor(value) === value && value >= 0;
}

function oneOf(list, value) {
  return typeof value === 'string' && list.indexOf(value) !== -1;
}

/** Whether `value` is an IPv4 address in 10.0.0.0/8, 172.16.0.0/12 or 192.168.0.0/16. */
function isPrivateIPv4(value) {
  var match = IPV4.exec(typeof value === 'string' ? value : '');
  if (match === null) {
    return false;
  }
  var first = parseInt(match[1], 10);
  var second = parseInt(match[2], 10);
  return first === 10 || (first === 172 && second >= 16 && second <= 31) || (first === 192 && second === 168);
}

/** `value` trimmed and in lower case if it is an address of the home network, otherwise ''. */
function normalizeLanAddress(value) {
  var address = text(value).toLowerCase();
  if (isPrivateIPv4(address) || LAN_NAME.test(address)) {
    return address;
  }
  return '';
}

/**
 * The input of POST /api/byl/security/lan ({ enabled, addresses }): { enabled, addresses } (lower
 * case, once), or { problem, invalid }: 'format' (no switch or no list), 'invalid' (the entries that
 * are no address of the home network), 'too-many' (more than LAN_MAX), 'required' (on without an
 * address).
 */
function lanInput(body) {
  if (!isRecord(body) || typeof body.enabled !== 'boolean' || !(body.addresses instanceof Array)) {
    return { problem: 'format', invalid: [] };
  }
  var addresses = [];
  var invalid = [];
  for (var i = 0; i < body.addresses.length; i++) {
    var value = body.addresses[i];
    var address = typeof value === 'string' ? normalizeLanAddress(value) : '';
    if (address === '') {
      invalid.push(String(typeof value === 'string' ? value : JSON.stringify(value)).slice(0, 200));
    } else if (addresses.indexOf(address) === -1) {
      addresses.push(address);
    }
  }
  if (invalid.length > 0) {
    return { problem: 'invalid', invalid: invalid };
  }
  if (addresses.length > LAN_MAX) {
    return { problem: 'too-many', invalid: [] };
  }
  if (body.enabled && addresses.length === 0) {
    return { problem: 'required', invalid: [] };
  }
  return { enabled: body.enabled, addresses: addresses };
}

/** The input of POST /api/byl/security/lan/firewall ({ action }): { action } or { problem: 'action' }. */
function firewallInput(body) {
  if (!isRecord(body) || !oneOf(FIREWALL_ACTIONS, body.action)) {
    return { problem: 'action' };
  }
  return { action: body.action };
}

/** Whether the server listens on every address of the computer (--http=0.0.0.0:<port>). */
function lanBound(httpFlag) {
  return /^0\.0\.0\.0:\d{1,5}$/.test(text(httpFlag));
}

/**
 * The hosts of the home network the server allows: the hosts of its http origins (--origins=a,b,c)
 * besides this machine, e.g. "192.168.178.20:8090", as the browser of another device sends them in
 * the Host header. The further hosts of ADR-0055 come over https and are not among them.
 */
function activeLanHosts(originsFlag) {
  var parts = text(originsFlag).split(',');
  var hosts = [];
  for (var i = 0; i < parts.length; i++) {
    var match = /^http:\/\/([^\/?#*\s]+)$/i.exec(text(parts[i]));
    if (match === null) {
      continue;
    }
    var host = match[1].toLowerCase();
    if (/^(?:127\.0\.0\.1|localhost|\[::1\])(?::\d+)?$/.test(host) || hosts.indexOf(host) !== -1) {
      continue;
    }
    hosts.push(host);
  }
  return hosts;
}

/** The address of the app for other devices under `host` ("192.168.178.20:8090"). */
function lanUrl(host) {
  return 'http://' + host + '/';
}

function stringList(value) {
  var result = [];
  var listed = value instanceof Array ? value : [];
  for (var i = 0; i < listed.length; i++) {
    if (typeof listed[i] === 'string' && listed[i] !== '') {
      result.push(listed[i]);
    }
  }
  return result;
}

function candidateOf(value) {
  if (!isRecord(value) || normalizeLanAddress(value.address) === '' || !oneOf(KINDS, value.kind)) {
    return null;
  }
  return {
    address: normalizeLanAddress(value.address),
    kind: value.kind,
    adapter: typeof value.adapter === 'string' ? value.adapter : '',
    category: oneOf(CATEGORIES, value.category) ? value.category : 'unknown'
  };
}

function stateOf(value) {
  if (!isRecord(value) || normalizeLanAddress(value.address) === '') {
    return null;
  }
  return {
    address: normalizeLanAddress(value.address),
    present: typeof value.present === 'boolean' ? value.present : null,
    adapter: typeof value.adapter === 'string' ? value.adapter : '',
    category: oneOf(CATEGORIES, value.category) ? value.category : 'unknown'
  };
}

function listOf(value, read) {
  var result = [];
  var listed = value instanceof Array ? value : [];
  for (var i = 0; i < listed.length; i++) {
    var entry = read(listed[i]);
    if (entry !== null) {
      result.push(entry);
    }
  }
  return result;
}

/**
 * The answer of lan-info, lan-configure or lan-firewall (byl-control.ps1 -Json) in the shape of the
 * routes, or null if it is none: the setting (enabled, addresses), the addresses of the computer to
 * choose from, the network category of each chosen address and the firewall rule with the commands
 * to run by hand (real paths of this machine). Unknown fields are dropped.
 */
function lanInfoView(raw) {
  if (!isRecord(raw) || raw.ok !== true || !isCount(raw.port) || !isRecord(raw.firewall)) {
    return null;
  }
  var firewall = raw.firewall;
  return {
    port: raw.port,
    enabled: raw.enabled === true,
    addresses: listOf(raw.addresses, function (value) {
      var address = normalizeLanAddress(value);
      return address === '' ? null : address;
    }),
    max: isCount(raw.max) ? raw.max : LAN_MAX,
    network: raw.network === true,
    candidates: listOf(raw.candidates, candidateOf),
    states: listOf(raw.states, stateOf),
    firewall: {
      state: oneOf(FIREWALL_STATES, firewall.state) ? firewall.state : 'unknown',
      blocked: firewall.blocked === true,
      rule: RULE_NAME,
      program: typeof firewall.program === 'string' ? firewall.program : '',
      add: typeof firewall.add === 'string' ? firewall.add : '',
      remove: typeof firewall.remove === 'string' ? firewall.remove : ''
    }
  };
}

/**
 * The home network in status -Json (byl-control.ps1, ADR-0039) in the shape of the page System, or
 * null without it (a script from before).
 */
function lanStatusView(raw) {
  if (!isRecord(raw)) {
    return null;
  }
  var hosts = stringList(raw.hosts);
  return {
    enabled: raw.enabled === true,
    addresses: stringList(raw.addresses),
    bound: raw.bound === true,
    hosts: hosts,
    urls: hosts.map(lanUrl),
    firewall: oneOf(FIREWALL_STATES, raw.firewall) ? raw.firewall : null,
    blocked: raw.blocked === true,
    networks: listOf(raw.networks, stateOf)
  };
}

/** The outcome of a change of the firewall rule (lan-firewall), '' for anything else. */
function outcomeOf(value) {
  return oneOf(OUTCOMES, value) ? value : '';
}

module.exports = {
  LAN_MAX: LAN_MAX,
  NAME_SUFFIXES: NAME_SUFFIXES,
  RULE_NAME: RULE_NAME,
  CATEGORIES: CATEGORIES,
  FIREWALL_STATES: FIREWALL_STATES,
  FIREWALL_ACTIONS: FIREWALL_ACTIONS,
  isPrivateIPv4: isPrivateIPv4,
  normalizeLanAddress: normalizeLanAddress,
  lanInput: lanInput,
  firewallInput: firewallInput,
  lanBound: lanBound,
  activeLanHosts: activeLanHosts,
  lanUrl: lanUrl,
  lanInfoView: lanInfoView,
  lanStatusView: lanStatusView,
  outcomeOf: outcomeOf
};
