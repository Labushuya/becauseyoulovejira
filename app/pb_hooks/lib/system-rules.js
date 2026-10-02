// Pure rules of the page "Einstellungen → System" (ADR-0043): the fixed commands of byl-control.ps1
// the routes may run, who may ask (this machine, the own address, the owner of the instance), the
// own instance of the app folder, rate limits, and the shape of the answers. CommonJS module, ES5
// only, no dependencies (Goja runtime and Vitest load it the same way); the routes live in
// system.pb.js with lib/system-service.js.
'use strict';

/**
 * Whitelist of the routes: the only commands they run, each with fixed arguments. Nothing of a
 * request reaches the command line; a name that is not listed here runs nothing.
 *   method  - HTTP method of the route,
 *   args    - arguments after the path of byl-control.ps1,
 *   output  - the route reads the JSON line of the command. Only for commands that start no
 *             process that outlives them: such a process would inherit the pipe, and the route
 *             would wait for its end (ADR-0039, limits),
 *   changes - an action that changes something: POST, audit entry, one at a time,
 *   input   - the route gives the command a JSON object on standard input (never arguments),
 *   backup  - a command of the page "Sicherung" (ADR-0046): its own routes in backup.pb.js run it;
 *             /api/byl/system/actions/{action} refuses it like an unknown name.
 */
var LOG_LINES = 200;
var ACTIONS = {
  status: { method: 'GET', args: ['status', '-Json'], output: true, changes: false },
  doctor: { method: 'GET', args: ['doctor', '-Json'], output: true, changes: false },
  logs: { method: 'GET', args: ['logs', '-Json', '-Lines', String(LOG_LINES)], output: true, changes: false },
  restart: { method: 'POST', args: ['restart', '-Detach', '-Quiet'], output: false, changes: true },
  'mail-restart': { method: 'POST', args: ['mail-restart', '-Quiet'], output: false, changes: true },
  'autostart-on': { method: 'POST', args: ['autostart-on', '-Quiet'], output: false, changes: true },
  'autostart-off': { method: 'POST', args: ['autostart-off', '-Quiet'], output: false, changes: true },
  'backup-info': { method: 'GET', args: ['backup-info', '-Json'], output: true, changes: false, backup: true },
  'backup-configure': { method: 'POST', args: ['backup-configure', '-Json'], output: true, changes: true, input: true, backup: true },
  'backup-passphrase': { method: 'POST', args: ['backup-passphrase', '-Json'], output: true, changes: true, input: true, backup: true },
  'backup-export': { method: 'POST', args: ['backup-export', '-Json'], output: true, changes: true, input: true, backup: true },
  'backup-verify': { method: 'POST', args: ['backup-verify', '-Json'], output: true, changes: true, input: true, backup: true },
  // Starts the restore as a process of its own (like restart -Detach); its answer is the state file
  // run/wiederherstellung.json, not a JSON line.
  'backup-restore': { method: 'POST', args: ['restore', '-Detach', '-Quiet'], output: false, changes: true, input: true, backup: true }
};

// Windows PowerShell 5.1 below the system folder, never a name looked up in PATH; the script is the
// one next to pb_hooks. The arguments go to CreateProcess one by one, without a shell.
var POWERSHELL_PATH = '\\System32\\WindowsPowerShell\\v1.0\\powershell.exe';
var DEFAULT_SYSTEM_ROOT = 'C:\\Windows';
var CONTROL_SCRIPT = 'byl-control.ps1';
var POWERSHELL_OPTIONS = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File'];

// PocketBase listens here unless --http says otherwise.
var DEFAULT_PORT = 8090;
// A request that went through a proxy is not local, even from 127.0.0.1 (ADR-0001: a proxy on this
// machine would make every remote request look local).
var PROXY_HEADERS = ['Forwarded', 'X-Forwarded-For', 'X-Forwarded-Host', 'X-Real-IP'];
// Names under which the browser reaches this machine; the port must be the one of the server.
var LOCAL_HOSTS = ['127.0.0.1', 'localhost', '[::1]'];

/** Status and German message per refusal; the page shows its own text per reason. */
var REFUSALS = {
  unknown: { status: 404, message: 'Diese Aktion gibt es nicht.' },
  platform: { status: 404, message: 'Die Seite System gibt es nur für einen Server unter Windows.' },
  loopback: { status: 403, message: 'Nur auf dem Rechner, auf dem die App läuft.' },
  origin: { status: 403, message: 'Nur aus der App unter ihrer eigenen Adresse.' },
  owner: { status: 403, message: 'Nur für das Konto, dem diese Installation gehört.' },
  rate: { status: 429, message: 'Zu viele Anfragen in kurzer Zeit.' },
  unavailable: { status: 503, message: 'Die Steuerung dieser Installation ist hier nicht verfügbar.' },
  busy: { status: 409, message: 'Eine andere Aktion läuft gerade.' },
  script: { status: 502, message: 'Das Steuerskript hat nicht wie erwartet geantwortet.' }
};

// Fixed windows per user: reading (status, doctor, logs) and actions; "Ansehen" of a file of a
// watched folder (ADR-0051 §6) with a window of its own, one request to ask and one for the file.
var RATE_LIMITS = {
  read: { limit: 30, windowMs: 60000 },
  change: { limit: 10, windowMs: 60000 },
  file: { limit: 120, windowMs: 60000 }
};
// After a restart was started, another one waits this long (the server is gone by then).
var RESTART_PENDING_MS = 90000;

// Keys in $app.store(); the prefix keeps them apart from PocketBase's own entries.
var RATE_PREFIX = 'byl.system.rate.';
var RUNNING_KEY = 'byl.system.running';
var RESTART_KEY = 'byl.system.restart-at';

var STATES = ['running', 'starting', 'unhealthy', 'stopped'];
var VERDICTS = ['current', 'reload', 'restart'];
var RESTART_REASONS = ['unknown', 'server', 'migrations', 'hooks', 'port', 'environment', 'mailHelper'];
var AUTOSTART = ['on', 'off', 'other'];
var DOCTOR_LEVELS = ['ok', 'warning', 'error', 'info'];
var LOG_SETS = ['server', 'mail', 'skript'];
// Levels of an entry of the catalog of the scripts (app/byl-problems.ps1, ADR-0048).
var PROBLEM_LEVELS = ['error', 'warning'];

function text(value) {
  return typeof value === 'string' ? value.replace(/^\s+|\s+$/g, '') : '';
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !(value instanceof Array);
}

function isCount(value) {
  return typeof value === 'number' && isFinite(value) && Math.floor(value) === value && value >= 0;
}

function countOrNull(value) {
  return isCount(value) ? value : null;
}

function oneOf(list, value) {
  return typeof value === 'string' && list.indexOf(value) !== -1;
}

/** The whitelisted action `name`, or null (also for names such as "constructor"). */
function action(name) {
  if (typeof name !== 'string' || !Object.prototype.hasOwnProperty.call(ACTIONS, name)) {
    return null;
  }
  return ACTIONS[name];
}

/** Path of the control script in `appDir`. */
function scriptPath(appDir) {
  return appDir + '\\' + CONTROL_SCRIPT;
}

/**
 * Program and arguments for the action `name` of the app folder `appDir`; null for a name that is
 * not whitelisted. `systemRoot` is %SystemRoot% of the server (C:\Windows without it).
 */
function commandLine(appDir, name, systemRoot) {
  var spec = action(name);
  if (spec === null) {
    return null;
  }
  var root = text(systemRoot).replace(/\\+$/, '');
  if (!/^[A-Za-z]:\\/.test(root + '\\')) {
    root = DEFAULT_SYSTEM_ROOT;
  }
  return {
    program: root + POWERSHELL_PATH,
    args: POWERSHELL_OPTIONS.concat([scriptPath(appDir)], spec.args)
  };
}

/** The answer of a refusal: HTTP status and body with message and reason. */
function refusal(reason) {
  var entry = Object.prototype.hasOwnProperty.call(REFUSALS, reason) ? REFUSALS[reason] : REFUSALS.script;
  return { status: entry.status, body: { status: entry.status, message: entry.message, reason: reason } };
}

/**
 * Whether a request comes from this machine: the peer of the connection and the client address
 * PocketBase derives (trusted proxy headers) are loopback, and no proxy header is set.
 * `proxyHeaderValues` are the values of PROXY_HEADERS.
 */
function isLocal(remoteLoopback, realLoopback, proxyHeaderValues) {
  if (remoteLoopback !== true || realLoopback !== true) {
    return false;
  }
  var values = proxyHeaderValues || [];
  for (var i = 0; i < values.length; i++) {
    if (text(values[i]) !== '') {
      return false;
    }
  }
  return true;
}

/** Value of the last "--<name>=<value>" argument, '' without one (as Get-FlagValue). */
function flagValue(args, name) {
  var prefix = '--' + name + '=';
  var value = '';
  var list = args || [];
  for (var i = 0; i < list.length; i++) {
    var argument = String(list[i]);
    if (argument.indexOf(prefix) === 0) {
      value = argument.slice(prefix.length);
    }
  }
  return value;
}

/** Port the server listens on, from --http=<host>:<port> of its arguments (8090 without it). */
function listenPort(args) {
  var match = /:(\d{1,5})$/.exec(flagValue(args, 'http'));
  if (match === null) {
    return DEFAULT_PORT;
  }
  var port = parseInt(match[1], 10);
  return port >= 1 && port <= 65535 ? port : DEFAULT_PORT;
}

/** Whether the Host header names this machine with the port of the server (no DNS rebinding). */
function isOwnHost(host, port) {
  var value = text(host).toLowerCase();
  for (var i = 0; i < LOCAL_HOSTS.length; i++) {
    if (value === LOCAL_HOSTS[i] + ':' + port) {
      return true;
    }
  }
  return false;
}

/**
 * Whether a request comes from the app itself (CSRF): a POST must carry the Origin of the address
 * it was sent to, a GET may omit it (browsers send none for same-origin reads); Sec-Fetch-Site, if
 * sent, must be "same-origin". Scripts without Origin can only read.
 */
function isSameOrigin(method, host, origin, fetchSite) {
  var site = text(fetchSite).toLowerCase();
  if (site !== '' && site !== 'same-origin') {
    return false;
  }
  var from = text(origin).toLowerCase();
  if (from === '') {
    return method === 'GET';
  }
  return from === 'http://' + text(host).toLowerCase();
}

/** A fully qualified Windows path in lower case with backslashes, without a trailing one; '' otherwise. */
function normalizePath(path) {
  var value = text(path).replace(/\//g, '\\');
  if (!/^(?:[A-Za-z]:\\|\\\\[^\\])/.test(value)) {
    return '';
  }
  if (/(?:^|\\)\.\.?(?:\\|$)/.test(value)) {
    return '';
  }
  return value.replace(/\\+$/, '').toLowerCase();
}

/** The app folder of the hooks folder `<app>\pb_hooks`; '' for any other folder. */
function appDirOf(hooksDir) {
  var value = text(hooksDir).replace(/\//g, '\\').replace(/\\+$/, '');
  var cut = value.lastIndexOf('\\');
  if (cut <= 0 || value.slice(cut + 1).toLowerCase() !== 'pb_hooks' || normalizePath(value) === '') {
    return '';
  }
  var dir = value.slice(0, cut);
  return normalizePath(dir) === '' ? '' : dir;
}

/**
 * Whether the running server is the own instance of `appDir`, by the rule of Select-AppProcess
 * (ADR-0039 §3): program <app>\pocketbase.exe, "serve", --http=127.0.0.1:<port> and
 * --dir=<app>\pb_data. Only then do the commands of the control script mean this server.
 */
function isOwnInstance(args, appDir) {
  var list = args || [];
  var folder = normalizePath(appDir);
  if (folder === '' || list.length < 2) {
    return false;
  }
  if (normalizePath(list[0]) !== folder + '\\pocketbase.exe') {
    return false;
  }
  var serve = false;
  for (var i = 1; i < list.length; i++) {
    if (String(list[i]) === 'serve') {
      serve = true;
    }
  }
  if (!serve || !/^127\.0\.0\.1:\d{1,5}$/.test(flagValue(list, 'http'))) {
    return false;
  }
  return normalizePath(flagValue(list, 'dir')) === folder + '\\pb_data';
}

function parseRate(raw) {
  if (typeof raw !== 'string') {
    return null;
  }
  try {
    var value = JSON.parse(raw);
    return isRecord(value) && isCount(value.start) && isCount(value.count) ? value : null;
  } catch (err) {
    return null;
  }
}

/**
 * One step of the fixed window `rule` ({ limit, windowMs }) for the stored entry `raw`: whether the
 * request may pass, the entry to store and, when refused, the seconds until the window ends.
 */
function rateStep(raw, now, rule) {
  var entry = parseRate(raw);
  if (entry === null || now < entry.start || now - entry.start >= rule.windowMs) {
    entry = { start: now, count: 0 };
  }
  if (entry.count >= rule.limit) {
    return {
      allowed: false,
      entry: JSON.stringify(entry),
      retryAfterSeconds: Math.max(1, Math.ceil((entry.start + rule.windowMs - now) / 1000))
    };
  }
  return { allowed: true, entry: JSON.stringify({ start: entry.start, count: entry.count + 1 }), retryAfterSeconds: 0 };
}

/** Whether a restart started at `startedAt` still counts as running at `now`. */
function restartPending(startedAt, now) {
  if (typeof startedAt !== 'number' || !isFinite(startedAt) || now < startedAt) {
    return false;
  }
  return now - startedAt < RESTART_PENDING_MS;
}

function otherServer(value) {
  if (!isRecord(value)) {
    return null;
  }
  // A test instance (worktree, disposable copy of the tests, this program with another data
  // folder) is folded on the page (RS-4); a script from before names only sameFolder.
  return {
    pid: countOrNull(value.pid),
    path: typeof value.path === 'string' ? value.path : '',
    port: countOrNull(value.port),
    sameFolder: value.sameFolder === true,
    testInstance: value.testInstance === true || value.sameFolder === true
  };
}

/** The strings of a list, each masked like a log line; [] for anything else. */
function maskedTexts(value) {
  var result = [];
  var listed = value instanceof Array ? value : [];
  for (var i = 0; i < listed.length; i++) {
    if (typeof listed[i] === 'string' && listed[i] !== '') {
      result.push(maskLogLine(listed[i]));
    }
  }
  return result;
}

/**
 * An entry of the catalog of the scripts as the control script reports it (ADR-0048: code, level,
 * exitCode, problem, facts, cause, remedy with steps and the command to copy, log), or null. The
 * texts lose e-mail addresses and tokens like a log line; the command and the log are paths of this
 * machine and stay as they are.
 */
function problemView(raw) {
  if (!isRecord(raw) || text(raw.code) === '' || !oneOf(PROBLEM_LEVELS, raw.level) || text(raw.problem) === '') {
    return null;
  }
  var remedy = isRecord(raw.remedy) ? raw.remedy : {};
  return {
    code: text(raw.code),
    level: raw.level,
    exitCode: isCount(raw.exitCode) ? raw.exitCode : 1,
    problem: maskLogLine(raw.problem),
    facts: maskedTexts(raw.facts),
    cause: typeof raw.cause === 'string' ? maskLogLine(raw.cause) : '',
    remedy: {
      steps: maskedTexts(remedy.steps),
      command: typeof remedy.command === 'string' ? remedy.command : ''
    },
    log: typeof raw.log === 'string' ? raw.log : ''
  };
}

/**
 * The error of the last run without window (status -Json, run\hintergrund-problem.json: time,
 * command and entry), or null.
 */
function backgroundProblemView(raw) {
  if (!isRecord(raw)) {
    return null;
  }
  var report = problemView(raw.report);
  if (report === null) {
    return null;
  }
  return {
    atUtc: typeof raw.atUtc === 'string' && raw.atUtc !== '' ? raw.atUtc : null,
    run: text(raw.run),
    report: report
  };
}

/**
 * The status of the control script (status -Json, ADR-0039 §5) in the shape of the route, or null
 * if the answer is not one. Unknown fields are dropped.
 */
function statusView(raw) {
  if (!isRecord(raw) || !oneOf(STATES, raw.state) || !oneOf(VERDICTS, raw.verdict) || !isCount(raw.port)) {
    return null;
  }
  var reasons = [];
  var listed = raw.restartReasons instanceof Array ? raw.restartReasons : [];
  for (var i = 0; i < listed.length; i++) {
    if (oneOf(RESTART_REASONS, listed[i])) {
      reasons.push(listed[i]);
    }
  }
  var others = [];
  var servers = raw.otherServers instanceof Array ? raw.otherServers : [];
  for (var s = 0; s < servers.length; s++) {
    var server = otherServer(servers[s]);
    if (server !== null) {
      others.push(server);
    }
  }
  var owner = isRecord(raw.portOwner)
    ? {
        pid: countOrNull(raw.portOwner.pid),
        name: typeof raw.portOwner.name === 'string' ? raw.portOwner.name : '',
        path: typeof raw.portOwner.path === 'string' ? raw.portOwner.path : ''
      }
    : null;
  return {
    state: raw.state,
    pid: countOrNull(raw.pid),
    port: raw.port,
    configuredPort: isCount(raw.configuredPort) ? raw.configuredPort : raw.port,
    url: typeof raw.url === 'string' ? raw.url : '',
    startedUtc: typeof raw.startedUtc === 'string' && raw.startedUtc !== '' ? raw.startedUtc : null,
    verdict: raw.verdict,
    restartReasons: reasons,
    reload: raw.reloadReasons instanceof Array && raw.reloadReasons.length > 0,
    mailHelperPid: countOrNull(raw.mailHelperPid),
    portOwner: owner,
    otherServers: others,
    autostart: oneOf(AUTOSTART, raw.autostart) ? raw.autostart : 'off',
    backgroundProblem: backgroundProblemView(raw.backgroundProblem)
  };
}

/**
 * The checks of doctor -Json (ADR-0039 §7) in the shape of the route, or null; a check that found a
 * problem carries its entry of the catalog (report), the others null.
 */
function doctorView(raw) {
  if (!isRecord(raw) || !(raw.checks instanceof Array)) {
    return null;
  }
  var checks = [];
  for (var i = 0; i < raw.checks.length; i++) {
    var check = raw.checks[i];
    if (isRecord(check) && oneOf(DOCTOR_LEVELS, check.level) && typeof check.text === 'string') {
      checks.push({
        name: typeof check.name === 'string' ? check.name : '',
        level: check.level,
        text: check.text,
        report: problemView(check.report)
      });
    }
  }
  return { ok: raw.ok === true, checks: checks };
}

/**
 * The logs of logs -Json in the shape of the route, or null; `clean` removes secrets from every
 * line (the script has removed the values of the BYL_* variables already).
 */
function logsView(raw, clean) {
  if (!isRecord(raw) || !(raw.logs instanceof Array)) {
    return null;
  }
  var logs = [];
  for (var i = 0; i < raw.logs.length; i++) {
    var set = raw.logs[i];
    if (!isRecord(set) || !oneOf(LOG_SETS, set.name) || !(set.files instanceof Array)) {
      continue;
    }
    var files = [];
    for (var f = 0; f < set.files.length; f++) {
      var file = set.files[f];
      if (!isRecord(file) || typeof file.file !== 'string') {
        continue;
      }
      var lines = [];
      var listed = file.lines instanceof Array ? file.lines : [];
      for (var l = 0; l < listed.length; l++) {
        if (typeof listed[l] === 'string') {
          lines.push(clean(listed[l]));
        }
      }
      files.push({
        file: file.file,
        exists: file.exists === true,
        sizeBytes: isCount(file.sizeBytes) ? file.sizeBytes : 0,
        modifiedUtc: typeof file.modifiedUtc === 'string' && file.modifiedUtc !== '' ? file.modifiedUtc : null,
        lines: lines
      });
    }
    logs.push({ name: set.name, files: files });
  }
  return { lines: LOG_LINES, logs: logs };
}

// Patterns a log line loses on top of secrets.redact (URLs, Telegram and Notion tokens).
var EMAIL = /[A-Za-z0-9._%+\-]+@((?:[A-Za-z0-9\-]+\.)+[A-Za-z]{2,})/g;
var BEARER = /\b(Bearer)\s+[A-Za-z0-9._~+\/=\-]+/gi;
var INBOX_KEY = /\bbyl_[A-Za-z0-9]{40}\b/g;
var JWT = /\beyJ[A-Za-z0-9_\-]{8,}\.[A-Za-z0-9_\-]{8,}\.[A-Za-z0-9_\-]{8,}/g;

/**
 * A log line without e-mail addresses (the local part becomes ***), Bearer values, access keys of
 * the own inbox (ADR-0038) and tokens in JWT form (sessions, the installer link).
 */
function maskLogLine(line) {
  return String(line)
    .replace(JWT, '***')
    .replace(BEARER, '$1 ***')
    .replace(INBOX_KEY, '***')
    .replace(EMAIL, '***@$1');
}

/**
 * Why the mail helper does not run although asked to: 'not-installed' (no byl-mail.exe),
 * 'restart' (the server has no ingest token yet, it comes with the next start), 'no-mailbox' (no
 * switched-on mailbox), '' when nothing speaks against it.
 */
function mailBlocker(state) {
  if (!isRecord(state) || state.installed !== true) {
    return 'not-installed';
  }
  if (state.tokenSet !== true) {
    return 'restart';
  }
  if (!isCount(state.mailboxes) || state.mailboxes < 1) {
    return 'no-mailbox';
  }
  return '';
}

module.exports = {
  ACTIONS: ACTIONS,
  LOG_LINES: LOG_LINES,
  PROXY_HEADERS: PROXY_HEADERS,
  REFUSALS: REFUSALS,
  RATE_LIMITS: RATE_LIMITS,
  RESTART_PENDING_MS: RESTART_PENDING_MS,
  RATE_PREFIX: RATE_PREFIX,
  RUNNING_KEY: RUNNING_KEY,
  RESTART_KEY: RESTART_KEY,
  action: action,
  scriptPath: scriptPath,
  commandLine: commandLine,
  refusal: refusal,
  isLocal: isLocal,
  listenPort: listenPort,
  isOwnHost: isOwnHost,
  isSameOrigin: isSameOrigin,
  appDirOf: appDirOf,
  isOwnInstance: isOwnInstance,
  rateStep: rateStep,
  restartPending: restartPending,
  problemView: problemView,
  statusView: statusView,
  doctorView: doctorView,
  logsView: logsView,
  maskLogLine: maskLogLine,
  mailBlocker: mailBlocker
};
