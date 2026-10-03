// Pure rules of the security hardening (ADR-0055; plan docs/plan/sicherheit.md, SH-1): the levels
// of the protection against guessing (rate limits of PocketBase), the hosts a request may name
// besides this machine, the headers of every answer and the two narrow exceptions from the CORS
// origins of the start (the browser extension and the landing page per file://). CommonJS module,
// ES5 only, no dependencies (Goja runtime and Vitest load it the same way); the guard of every
// request lives in security.pb.js with lib/security-service.js.
'use strict';

/**
 * Levels of the protection against guessing, as rules of the rate limiter of PocketBase
 * (settings.rateLimits; PocketBase 0.40.4 counts per client address in fixed windows).
 *   auth  - every way to sign in (password, OTP, OAuth2: tag "auth") and the mail-based flows that
 *           could be guessed (OTP, password reset); per collection, so the superusers of the admin
 *           UI have their own counter.
 *   guest - every other /api/ request without a signed-in account: what a web page or another
 *           program could send. Requests of a signed-in account are never counted by it; bulk
 *           actions, imports and the realtime subscriptions of the app stay unlimited.
 * Normal: 10 attempts per minute let a typo or two through and still allow only 14 400 guesses a
 * day; strict: 5 per 5 minutes, at most 1 440 a day, at the price of waiting up to 5 minutes after
 * a few typos. 300 per 10 s for guests is the own default of PocketBase for /api/.
 */
var LEVELS = ['normal', 'strict'];
var PRESETS = {
  normal: { auth: { maxRequests: 10, duration: 60 }, guest: { maxRequests: 300, duration: 10 } },
  strict: { auth: { maxRequests: 5, duration: 300 }, guest: { maxRequests: 100, duration: 10 } }
};
var AUTH_LABELS = ['*:auth', '*:requestOTP', '*:requestPasswordReset', '*:confirmPasswordReset'];
// The ingest routes of the mail helper (Bearer BYL_INGEST_TOKEN, ADR-0016) send one request per
// mail of a full search; their own, high limit keeps them clear of the guest limit at both levels.
// The rule stands before /api/: PocketBase takes the first prefix rule of the list.
var INGEST_RULE = { label: '/api/byl/ingest/', audience: '@guest', duration: 10, maxRequests: 1000 };
var GUEST_LABEL = '/api/';
var GUEST_AUDIENCE = '@guest';

// The rules of PocketBase 0.40.4 before the hardening (rate limiter switched off); the migration
// switches the limiter on only while it still has them, and its way back restores them.
var POCKETBASE_DEFAULT_RULES = [
  { label: '*:auth', audience: '', duration: 3, maxRequests: 2 },
  { label: '*:create', audience: '', duration: 5, maxRequests: 20 },
  { label: '/api/batch', audience: '', duration: 1, maxRequests: 3 },
  { label: '/api/', audience: '', duration: 10, maxRequests: 300 }
];

// Superusers (admin UI /_/) only from this machine (settings.superuserIPs, ADR-0001 §3).
var SUPERUSER_IPS = ['127.0.0.1', '::1'];

/** The rules of the rate limiter of a level, in the order PocketBase compares them. */
function rateLimitRules(level) {
  var preset = PRESETS[level === 'strict' ? 'strict' : 'normal'];
  var rules = [];
  for (var i = 0; i < AUTH_LABELS.length; i++) {
    rules.push({ label: AUTH_LABELS[i], audience: '', duration: preset.auth.duration, maxRequests: preset.auth.maxRequests });
  }
  rules.push({ label: INGEST_RULE.label, audience: INGEST_RULE.audience, duration: INGEST_RULE.duration, maxRequests: INGEST_RULE.maxRequests });
  rules.push({ label: GUEST_LABEL, audience: GUEST_AUDIENCE, duration: preset.guest.duration, maxRequests: preset.guest.maxRequests });
  return rules;
}

function sameRule(a, b) {
  return (
    a !== null &&
    typeof a === 'object' &&
    String(a.label) === b.label &&
    String(a.audience || '') === b.audience &&
    Number(a.duration) === b.duration &&
    Number(a.maxRequests) === b.maxRequests
  );
}

/** Whether `rules` (objects with label, audience, duration, maxRequests) equal `expected` in order. */
function sameRules(rules, expected) {
  var list = rules instanceof Array ? rules : [];
  if (list.length !== expected.length) {
    return false;
  }
  for (var i = 0; i < expected.length; i++) {
    if (!sameRule(list[i], expected[i])) {
      return false;
    }
  }
  return true;
}

/**
 * The level of the rate limiter settings: 'normal' or 'strict' for a preset, 'off' while the
 * limiter is switched off, 'custom' for rules set in the admin UI.
 */
function levelOf(enabled, rules) {
  if (enabled !== true) {
    return 'off';
  }
  for (var i = 0; i < LEVELS.length; i++) {
    if (sameRules(rules, rateLimitRules(LEVELS[i]))) {
      return LEVELS[i];
    }
  }
  return 'custom';
}

function text(value) {
  return typeof value === 'string' ? value.replace(/^\s+|\s+$/g, '') : '';
}

/**
 * The hosts the origins of the start (--origins=a,b,c) name, as a browser sends them in the Host
 * header: "host" or "host:port", without the default port of the scheme. Wildcards and anything
 * but http(s) name no host. The own addresses of this machine are among them; further ones come
 * from byl-config.json (security.hosts, e.g. a later Tailscale name).
 */
function originHosts(originsFlag) {
  var parts = text(originsFlag).split(',');
  var hosts = [];
  for (var i = 0; i < parts.length; i++) {
    var match = /^(https?):\/\/([^\/?#*\s]+)$/i.exec(text(parts[i]));
    if (match === null) {
      continue;
    }
    var host = match[2].toLowerCase();
    var defaultPort = match[1].toLowerCase() === 'https' ? ':443' : ':80';
    if (host.length > defaultPort.length && host.slice(-defaultPort.length) === defaultPort) {
      host = host.slice(0, -defaultPort.length);
    }
    if (hosts.indexOf(host) === -1) {
      hosts.push(host);
    }
  }
  return hosts;
}

// Further hosts of byl-config.json (security.hosts, ADR-0055 §3): a DNS name with at least one dot
// and an optional port, at most 10; the same rule as ConvertTo-BylExtraHost in byl-functions.ps1
// (parity test). IP addresses and single names (localhost) are no further hosts.
var EXTRA_HOSTS_MAX = 10;
var EXTRA_HOST = /^(?=.{1,253}(?::[0-9]{1,5})?$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?(?::([0-9]{1,5}))?$/;

/** `value` trimmed and in lower case if it is a valid further host, otherwise ''. */
function normalizeExtraHost(value) {
  var host = text(value).toLowerCase();
  var match = EXTRA_HOST.exec(host);
  if (match === null) {
    return '';
  }
  if (match[1] !== undefined) {
    var port = parseInt(match[1], 10);
    if (port < 1 || port > 65535) {
      return '';
    }
  }
  return host;
}

/** Whether the Host header `host` is one of `hosts` (exactly, without case). */
function isListedHost(host, hosts) {
  var value = text(host).toLowerCase();
  return value !== '' && (hosts || []).indexOf(value) !== -1;
}

// Answer for a request to a host that is not this app (DNS rebinding, ADR-0055 §2).
var HOST_REFUSAL = {
  status: 403,
  message: 'Diese Adresse ist für becauseyoulovejira nicht freigegeben.',
  reason: 'host'
};

// Headers of every answer besides those of PocketBase (X-Content-Type-Options: nosniff,
// X-Frame-Options: SAMEORIGIN, Cross-Origin-Opener-Policy: same-origin). "same-origin" keeps the
// referrer within the app: a tab opened from a link of the app knows it is no new start
// (ADR-0035 §6). frame-ancestors 'none' forbids every frame (it wins over X-Frame-Options); no
// further CSP, because SvelteKit and the editor need inline scripts and styles. The admin UI sets
// its own CSP with frame-ancestors 'none' only while no other one is set, so it gets none here.
var REFERRER_POLICY = 'same-origin';
var PERMISSIONS_POLICY = 'camera=(), microphone=(), geolocation=(), payment=(), usb=()';
var FRAME_POLICY = "frame-ancestors 'none'";

function isAdminPath(path) {
  var value = String(path || '');
  return value === '/_' || value.indexOf('/_/') === 0;
}

/** Name and value of the headers for a request to `path`. */
function securityHeaders(path) {
  var headers = { 'Referrer-Policy': REFERRER_POLICY, 'Permissions-Policy': PERMISSIONS_POLICY };
  if (!isAdminPath(path)) {
    headers['Content-Security-Policy'] = FRAME_POLICY;
  }
  return headers;
}

// The routes with an exception from the origins of the start.
var EXTENSION_PATH = '/api/byl/inbox/ingest';
var ATTENTION_PATH = /^\/api\/byl\/attention(?:\/[A-Za-z0-9]{24})?$/;
var EXTENSION_METHODS = 'GET, POST';
var EXTENSION_HEADERS = 'Authorization, Content-Type';
var PREFLIGHT_MAX_AGE = '600';

/**
 * The CORS answer of the two exceptions, or null for every other request (PocketBase answers it
 * by the origins of the start):
 *   - the browser extension (`extension`: the Origin is chrome-extension://<ID>, ADR-0038) on
 *     /api/byl/inbox/ingest. Its service worker needs no CORS (host_permissions); the answer, also
 *     to a preflight, keeps it working should a browser ask anyway.
 *   - the landing page per file:// (Origin "null", ADR-0035 §4) on /api/byl/attention and
 *     /api/byl/attention/{nonce}: it reads the nonce and whether a tab confirmed. The routes
 *     themselves decide who may use them.
 * Returns { origin, preflight } with preflight { methods, headers, maxAge } for an OPTIONS request.
 */
function corsException(method, path, origin, extension) {
  var verb = String(method || '').toUpperCase();
  var from = String(origin || '');
  if (path === EXTENSION_PATH && extension === true) {
    if (verb === 'OPTIONS') {
      return { origin: from, preflight: { methods: EXTENSION_METHODS, headers: EXTENSION_HEADERS, maxAge: PREFLIGHT_MAX_AGE } };
    }
    return verb === 'GET' || verb === 'POST' ? { origin: from, preflight: null } : null;
  }
  if (from === 'null' && ATTENTION_PATH.test(String(path || '')) && (verb === 'GET' || verb === 'POST')) {
    return { origin: 'null', preflight: null };
  }
  return null;
}

/** A value of a request for a log line: at most 200 characters, no control characters. */
function logText(value) {
  var clean = String(value === null || value === undefined ? '' : value).replace(/[\u0000-\u001f\u007f]/g, '?');
  return clean.length > 200 ? clean.slice(0, 200) + '…' : clean;
}

module.exports = {
  LEVELS: LEVELS,
  PRESETS: PRESETS,
  AUTH_LABELS: AUTH_LABELS,
  INGEST_RULE: INGEST_RULE,
  POCKETBASE_DEFAULT_RULES: POCKETBASE_DEFAULT_RULES,
  SUPERUSER_IPS: SUPERUSER_IPS,
  HOST_REFUSAL: HOST_REFUSAL,
  REFERRER_POLICY: REFERRER_POLICY,
  PERMISSIONS_POLICY: PERMISSIONS_POLICY,
  FRAME_POLICY: FRAME_POLICY,
  EXTENSION_PATH: EXTENSION_PATH,
  EXTRA_HOSTS_MAX: EXTRA_HOSTS_MAX,
  rateLimitRules: rateLimitRules,
  sameRules: sameRules,
  levelOf: levelOf,
  normalizeExtraHost: normalizeExtraHost,
  originHosts: originHosts,
  isListedHost: isListedHost,
  isAdminPath: isAdminPath,
  securityHeaders: securityHeaders,
  corsException: corsException,
  logText: logText
};
