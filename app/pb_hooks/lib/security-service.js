// Guard of every request and the page "Einstellungen → Sicherheit" (ADR-0055; plan
// docs/plan/sicherheit.md, SH-1 and SH-2).
//
// The guard runs from security.pb.js before every other middleware of PocketBase: a request must
// name this app in its Host header (127.0.0.1, localhost or [::1] with the port of --http, or a
// host of the origins of the start), otherwise 403 before anything is read (DNS rebinding). Then
// the headers of lib/security-rules.js and the two narrow CORS exceptions (browser extension,
// landing page per file://).
//
// The routes of the page check like the page "Speicher" (check of lib/system-service.js with
// local and anyPlatform: signed in, this machine, the address of the app, the owner of the
// instance, rate limit); only the further hosts need the control script of the own instance under
// Windows. Failed sign-ins land in login_failures without the password.
'use strict';

var rules = require(__hooks + '/lib/security-rules.js');
var system = require(__hooks + '/lib/system-rules.js');
var inboxKeys = require(__hooks + '/lib/inbox-key-rules.js');

var FAILURES = 'login_failures';
var AREA = 'byl-security';
var INGEST_TOKEN = 'BYL_INGEST_TOKEN';

// Texts of the 400 answers; the page names the problem in its own words.
var MESSAGES = {
  empty: 'Es gibt nichts zu ändern.',
  level: 'Diese Stufe gibt es nicht.',
  days: 'Diese Dauer gibt es nicht.',
  format: 'Die Adressen fehlen.',
  invalid: 'Mindestens eine Adresse ist kein gültiger Name.',
  'too-many': 'Höchstens ' + rules.EXTRA_HOSTS_MAX + ' zusätzliche Adressen.'
};

function argsOfServer() {
  var args = $os.args || [];
  var list = [];
  for (var i = 0; i < args.length; i++) {
    list.push(String(args[i]));
  }
  return list;
}

/** Whether `host` names this app: this machine with the port of the server, or a host of --origins. */
function hostAllowed(host, args) {
  if (system.isOwnHost(host, system.listenPort(args))) {
    return true;
  }
  return rules.isListedHost(host, rules.originHosts(system.flagValue(args, 'origins')));
}

/** The middleware: Host first, then headers and CORS exceptions, then the rest of the chain. */
function guard(e) {
  var host = String(e.request.host || '');
  var path = String(e.request.url.path || '');
  if (!hostAllowed(host, argsOfServer())) {
    e.app.logger().warn('byl-security: Anfrage an fremden Host abgelehnt', 'host', rules.logText(host), 'path', rules.logText(path), 'ip', String(e.remoteIP()));
    return e.json(rules.HOST_REFUSAL.status, rules.HOST_REFUSAL);
  }
  var header = e.response.header();
  var headers = rules.securityHeaders(path);
  for (var name in headers) {
    if (Object.prototype.hasOwnProperty.call(headers, name)) {
      header.set(name, headers[name]);
    }
  }
  var origin = String(e.request.header.get('Origin') || '');
  var cors = rules.corsException(e.request.method, path, origin, origin !== '' && inboxKeys.originAllowed(origin));
  if (cors !== null) {
    header.set('Access-Control-Allow-Origin', cors.origin);
    header.add('Vary', 'Origin');
    if (cors.preflight !== null) {
      header.set('Access-Control-Allow-Methods', cors.preflight.methods);
      header.set('Access-Control-Allow-Headers', cors.preflight.headers);
      header.set('Access-Control-Max-Age', cors.preflight.maxAge);
      return e.noContent(204);
    }
  }
  return e.next();
}

// --- Failed sign-ins -------------------------------------------------------------------------------

function hasFailures(app) {
  try {
    app.findCollectionByNameOrId(FAILURES);
    return true;
  } catch (err) {
    return false;
  }
}

/** Removes failures older than 30 days and beyond the newest 5000 (cron and every new one). */
function pruneFailures(app, now) {
  if (!hasFailures(app)) {
    return;
  }
  var cutoff = rules.pocketBaseTime(now - rules.LOGIN_RETENTION_DAYS * rules.DAY_SECONDS * 1000);
  app.db().newQuery('DELETE FROM login_failures WHERE created < {:cutoff}').bind({ cutoff: cutoff }).execute();
  app
    .db()
    .newQuery('DELETE FROM login_failures WHERE id IN (SELECT id FROM login_failures ORDER BY created DESC, id DESC LIMIT -1 OFFSET {:max})')
    .bind({ max: rules.LOGIN_MAX_ROWS })
    .execute();
}

/**
 * Records a failed sign-in with password (onRecordAuthWithPasswordRequest): area, the entered
 * account, whether it exists, where it came from, Host and address; never the password. Never
 * throws: the answer of the sign-in stays the one of PocketBase.
 */
function recordFailure(e) {
  try {
    var area = rules.loginArea(String(e.collection.name));
    if (area === '' || !hasFailures(e.app)) {
      return;
    }
    var record = new Record(e.app.findCollectionByNameOrId(FAILURES));
    record.set('area', area);
    record.set('identity', rules.identityText(String(e.identity || '')));
    record.set('known', e.record !== null && e.record !== undefined);
    // The JSVM does not lift the request out of the embedded *RequestEvent of this event.
    var request = e.requestEvent.request;
    record.set('source', rules.loginSource(request.header.get('Origin'), request.header.get('Sec-Fetch-Site')));
    record.set('host', rules.logText(String(request.host || '')));
    record.set('ip', rules.logText(String(e.realIP())).slice(0, 64));
    e.app.save(record);
    pruneFailures(e.app, Date.now());
  } catch (err) {
    e.app.logger().warn(AREA + ': Fehlgeschlagene Anmeldung nicht gespeichert', 'error', String(err));
  }
}

function countSince(app, since) {
  var result = new DynamicModel({ n: 0 });
  app.db().newQuery('SELECT COUNT(*) AS n FROM login_failures WHERE created >= {:since}').bind({ since: since }).one(result);
  return Number(result.n);
}

function newestFailure(app) {
  var result = new DynamicModel({ last: '' });
  app.db().newQuery('SELECT COALESCE(MAX(created), \'\') AS last FROM login_failures').one(result);
  return String(result.last);
}

/** The failures of the last 30 days, grouped by area, account, source and Host, newest first. */
function failures(app, now) {
  if (!hasFailures(app)) {
    return null;
  }
  var since = rules.pocketBaseTime(now - rules.LOGIN_RETENTION_DAYS * rules.DAY_SECONDS * 1000);
  var rows = arrayOf(new DynamicModel({ area: '', identity: '', known: false, source: '', host: '', count: 0, first: '', last: '' }));
  app
    .db()
    .newQuery(
      'SELECT area, identity, known, source, host, COUNT(*) AS count, MIN(created) AS first, MAX(created) AS last FROM login_failures ' +
        'WHERE created >= {:since} GROUP BY area, identity, known, source, host ORDER BY last DESC LIMIT {:max}'
    )
    .bind({ since: since, max: rules.LOGIN_GROUPS_MAX })
    .all(rows);
  var groups = [];
  for (var i = 0; i < rows.length; i++) {
    groups.push({
      area: String(rows[i].area),
      identity: String(rows[i].identity),
      known: rows[i].known === true || Number(rows[i].known) === 1,
      source: String(rows[i].source),
      host: String(rows[i].host),
      count: Number(rows[i].count),
      first: String(rows[i].first),
      last: String(rows[i].last)
    });
  }
  return {
    days: rules.LOGIN_RETENTION_DAYS,
    total: countSince(app, since),
    lastDay: countSince(app, rules.pocketBaseTime(now - rules.NOTICE_WINDOW_MS)),
    groups: groups
  };
}

// --- Page "Einstellungen → Sicherheit" ---------------------------------------------------------------

function service() {
  return require(__hooks + '/lib/system-service.js');
}

function readText(path) {
  try {
    return toString($os.readFile(path));
  } catch (err) {
    return '';
  }
}

/** The rate limiter rules of the settings as plain data. */
function plainRules(list) {
  var result = [];
  var entries = list || [];
  for (var i = 0; i < entries.length; i++) {
    result.push({
      label: String(entries[i].label),
      audience: String(entries[i].audience || ''),
      duration: Number(entries[i].duration),
      maxRequests: Number(entries[i].maxRequests)
    });
  }
  return result;
}

function plainList(list) {
  var result = [];
  var entries = list || [];
  for (var i = 0; i < entries.length; i++) {
    result.push(String(entries[i]));
  }
  return result;
}

function onWindows() {
  var platform = require(__hooks + '/lib/host-platform.js');
  var args = argsOfServer();
  return platform.hostPlatform($os.getenv(platform.ENV), args.length > 0 ? args[0] : '') === 'windows';
}

/** Encrypted backups (ADR-0046): target folder set, sealed copies there and the newest of them. */
function backupState(app) {
  if (!onWindows()) {
    return { available: false, target: false, sealed: 0, newest: null };
  }
  var backups = require(__hooks + '/lib/backup-service.js');
  var settings = backups.readSettings(app);
  if (!settings.target) {
    return { available: true, target: false, sealed: 0, newest: null };
  }
  var sealed = backups.listSealed(settings.target);
  if (sealed === null) {
    return { available: true, target: true, reachable: false, sealed: 0, newest: null };
  }
  return {
    available: true,
    target: true,
    reachable: true,
    sealed: sealed.length,
    newest: sealed.length > 0 ? new Date(sealed[0].time).toISOString() : null
  };
}

/** Names of the BYL_* variables the app uses (connections, mail helper) and whether each is set. */
function secretNames(app, userId) {
  var secrets = require(__hooks + '/lib/secrets.js');
  var names = [];
  var found = app.findRecordsByFilter('connections', 'owner = {:owner} && secret_env != ""', 'secret_env', 0, 0, { owner: userId });
  for (var i = 0; i < found.length; i++) {
    var name = String(found[i].getString('secret_env'));
    if (secrets.isValidName(name) && names.indexOf(name) === -1) {
      names.push(name);
    }
  }
  if (String($os.getenv(INGEST_TOKEN) || '') !== '' && names.indexOf(INGEST_TOKEN) === -1) {
    names.push(INGEST_TOKEN);
  }
  names.sort();
  var result = [];
  for (var j = 0; j < names.length; j++) {
    result.push({ name: names[j], set: String($os.getenv(names[j]) || '') !== '' });
  }
  return result;
}

/** The access keys of the own inbox of the user: number and the last use of any of them. */
function inboxKeysOf(app, userId) {
  try {
    var keys = app.findRecordsByFilter('inbox_keys', 'owner = {:owner}', '-last_used_at', 0, 0, { owner: userId });
    var last = '';
    for (var i = 0; i < keys.length; i++) {
      var used = String(keys[i].getString('last_used_at'));
      if (used > last) {
        last = used;
      }
    }
    return { count: keys.length, lastUsedAt: last === '' ? null : last };
  } catch (err) {
    return { count: 0, lastUsedAt: null };
  }
}

/** The build of the browser extension next to pb_hooks (ADR-0038 §4). */
function extensionState() {
  var extension = require(__hooks + '/lib/extension-rules.js');
  var hooks = $filepath.isAbs(__hooks) ? __hooks : $filepath.join($os.getwd(), __hooks);
  var version = '';
  try {
    version = extension.versionOf(toString($os.readFile($filepath.join(extension.folderOf(hooks), 'manifest.json'))));
  } catch (err) {
    version = '';
  }
  return { built: version !== '', version: version };
}

/** Everything the page shows; `appDir` is the folder of the own instance or ''. */
function overview(app, userId, appDir, now) {
  var args = argsOfServer();
  var port = system.listenPort(args);
  var origins = system.flagValue(args, 'origins');
  var settings = app.settings();
  var users = app.findCollectionByNameOrId('users');
  var seconds = Number(users.authToken.duration);
  var ips = plainList(settings.superuserIPs);
  return {
    level: rules.levelOf(settings.rateLimits.enabled === true, plainRules(settings.rateLimits.rules)),
    cors: { restricted: rules.corsRestricted(origins) },
    hosts: {
      own: rules.ownHosts(port),
      active: rules.activeExtraHosts(origins, port),
      configured: rules.configuredHosts(readText($filepath.join($filepath.dir(app.dataDir()), 'byl-config.json'))),
      editable: appDir !== '',
      max: rules.EXTRA_HOSTS_MAX
    },
    admin: { ips: ips, loopbackOnly: rules.loopbackOnly(ips) },
    session: { days: rules.sessionDaysOf(seconds), seconds: seconds, choices: rules.SESSION_DAYS, standard: rules.SESSION_DEFAULT_DAYS },
    backup: backupState(app),
    secrets: secretNames(app, userId),
    keys: inboxKeysOf(app, userId),
    extension: extensionState(),
    logins: failures(app, now)
  };
}

function refuse(e, name, context) {
  return service().refuse(e, name, context.refused, context.retryAfterSeconds, AREA);
}

function audit(e, action, detail) {
  e.app.logger().info(AREA + ': Aktion ausgeführt', 'action', action, 'user', service().userOf(e), 'result', detail);
}

function invalid(e, problem, extra) {
  var body = { status: 400, message: MESSAGES[problem], reason: 'invalid', problem: problem };
  if (extra) {
    body.invalid = extra;
  }
  return e.json(400, body);
}

/** The own instance of the app folder under Windows, or '' (no control script). */
function ownAppDir() {
  return service().ownAppDir();
}

/** GET /api/byl/security. */
function read(e) {
  var context = service().check(e, 'security-read', 'GET', { local: true, anyPlatform: true, kind: 'read' });
  if (context.refused) {
    return refuse(e, 'security-read', context);
  }
  return e.json(200, overview(e.app, service().userOf(e), ownAppDir(), Date.now()));
}

/** POST /api/byl/security/settings: { level?, days? }; applies at once, answers the overview. */
function saveSettings(e) {
  var context = service().check(e, 'security-settings', 'POST', { local: true, anyPlatform: true, kind: 'change' });
  if (context.refused) {
    return refuse(e, 'security-settings', context);
  }
  var input = rules.settingsInput(e.requestInfo().body);
  if (input.problem) {
    return invalid(e, input.problem);
  }
  if (input.level) {
    var settings = e.app.settings();
    unmarshal({ rateLimits: { enabled: true, rules: rules.rateLimitRules(input.level) } }, settings);
    e.app.save(settings);
    audit(e, 'security-level', input.level);
  }
  if (input.days) {
    var users = e.app.findCollectionByNameOrId('users');
    users.authToken.duration = input.days * rules.DAY_SECONDS;
    e.app.save(users);
    audit(e, 'security-session', String(input.days));
  }
  return e.json(200, overview(e.app, service().userOf(e), ownAppDir(), Date.now()));
}

/**
 * POST /api/byl/security/hosts: { hosts } into byl-config.json through the control script
 * (security-configure); they apply after a restart. Answers the overview with `result`.
 */
function saveHosts(e) {
  var context = service().check(e, 'security-configure', 'POST');
  if (context.refused) {
    return refuse(e, 'security-configure', context);
  }
  var input = rules.hostsInput(e.requestInfo().body);
  if (input.problem) {
    return invalid(e, input.problem, input.invalid);
  }
  var raw = service().runJson(context.appDir, 'security-configure', { hosts: input.hosts });
  var ok = raw !== null && raw.ok === true;
  audit(e, 'security-configure', ok ? 'hosts=' + input.hosts.length : 'refused');
  if (!ok) {
    return service().refuse(e, 'security-configure', 'script', 0, AREA);
  }
  var body = overview(e.app, service().userOf(e), context.appDir, Date.now());
  body.result = { hosts: body.hosts.configured };
  return e.json(200, body);
}

/** GET /api/byl/security/notice: whether failed sign-ins of the last 24 hours ask for attention. */
function notice(e) {
  var context = service().check(e, 'security-notice', 'GET', { local: true, anyPlatform: true, kind: 'read' });
  if (context.refused) {
    return refuse(e, 'security-notice', context);
  }
  if (!hasFailures(e.app)) {
    return e.json(200, { attention: false, count: 0, last: null });
  }
  var count = countSince(e.app, rules.pocketBaseTime(Date.now() - rules.NOTICE_WINDOW_MS));
  var last = newestFailure(e.app);
  return e.json(200, { attention: rules.needsNotice(count), count: count, last: last === '' ? null : last });
}

module.exports = {
  guard: guard,
  hostAllowed: hostAllowed,
  recordFailure: recordFailure,
  pruneFailures: pruneFailures,
  read: read,
  saveSettings: saveSettings,
  saveHosts: saveHosts,
  notice: notice
};
