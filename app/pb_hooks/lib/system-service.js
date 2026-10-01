// Routes of the page "Einstellungen → System" (ADR-0043): status, checks and logs of the app and the
// actions restart, mail helper and autostart, each by a fixed command of byl-control.ps1 next to
// pb_hooks (whitelist in lib/system-rules.js). Every route checks, in this order: server on Windows,
// request from this machine, Host and Origin of the app itself, owner of the instance, rate limit,
// and that this server is the own instance of the app folder; only then does it run a command.
// Windows PowerShell gets its arguments one by one (Go's os/exec, no shell), none of them from the
// request. Refusals and actions go into the log of PocketBase with action, user and reason, never
// with values.
'use strict';

var rules = require(__hooks + '/lib/system-rules.js');
var presenceRules = require(__hooks + '/lib/presence-rules.js');
var hostPlatform = require(__hooks + '/lib/host-platform.js');
var secrets = require(__hooks + '/lib/secrets.js');

// The JSON line of a command is small (logs: 200 lines of 5 files); a longer answer is cut.
var MAX_OUTPUT_BYTES = 8 * 1024 * 1024;
var INGEST_TOKEN = 'BYL_INGEST_TOKEN';
var MAIL_HELPER = 'byl-mail.exe';

function argsOfServer() {
  var args = $os.args || [];
  var list = [];
  for (var i = 0; i < args.length; i++) {
    list.push(String(args[i]));
  }
  return list;
}

function header(e, name) {
  return String(e.request.header.get(name) || '');
}

function userOf(e) {
  return e.auth ? String(e.auth.id) : '';
}

/**
 * The owner of the instance: the app account created first (ADR-0043 §3). The superuser creates it
 * right after the installer (ADR-0002), members of a household come later (E7).
 */
function ownerId(app) {
  var found = app.findRecordsByFilter('users', 'id != ""', 'created,id', 1, 0);
  return found.length > 0 ? String(found[0].id) : '';
}

function fileExists(path) {
  try {
    $os.stat(path);
    return true;
  } catch (err) {
    return false;
  }
}

/**
 * Answer of a refusal; every refusal is logged with action, reason, user and address. `area` names
 * the page in the audit entry: 'byl-system' (default) or 'byl-backup' (ADR-0046).
 */
function refuse(e, name, reason, retryAfterSeconds, area) {
  e.app
    .logger()
    .warn((area || 'byl-system') + ': Anfrage abgelehnt', 'action', String(name), 'reason', reason, 'user', userOf(e), 'ip', String(e.remoteIP()));
  if (retryAfterSeconds) {
    e.response.header().set('Retry-After', String(retryAfterSeconds));
  }
  var answer = rules.refusal(reason);
  return e.json(answer.status, answer.body);
}

/** One step of the rate limit of `kind` ('read' or 'change') for the signed-in user. */
function takeRate(e, kind) {
  var now = Date.now();
  var result = { allowed: false, retryAfterSeconds: 1 };
  e.app.store().setFunc(rules.RATE_PREFIX + kind + '.' + userOf(e), function (raw) {
    result = rules.rateStep(raw, now, rules.RATE_LIMITS[kind]);
    return result.entry;
  });
  return result;
}

/** Whether the server runs under Windows (the rule of GET /api/byl/host). */
function onWindows() {
  var args = argsOfServer();
  return hostPlatform.hostPlatform($os.getenv(hostPlatform.ENV), args.length > 0 ? args[0] : '') === 'windows';
}

/**
 * The folder of the app when this server is its own instance (ADR-0043 §4: program, data folder
 * and control script of one folder app, Windows); '' otherwise. Instances of the tests and of
 * development never run a command.
 */
function ownAppDir() {
  if (!onWindows()) {
    return '';
  }
  var appDir = rules.appDirOf(__hooks);
  if (appDir === '' || !rules.isOwnInstance(argsOfServer(), appDir) || !fileExists(rules.scriptPath(appDir))) {
    return '';
  }
  return appDir;
}

/**
 * The checks of every route, in order; returns { refused, retryAfterSeconds } or the context
 * { appDir } of the own instance. `options.kind` sets the rate limit ('read' or 'change', default
 * after the whitelist entry of `name`); `options.local` skips the check of the own instance for a
 * route that runs no command (appDir is then '').
 */
function check(e, name, method, options) {
  var opts = options || {};
  var args = argsOfServer();
  if (!onWindows()) {
    return { refused: 'platform' };
  }
  var proxy = [];
  for (var i = 0; i < rules.PROXY_HEADERS.length; i++) {
    proxy.push(header(e, rules.PROXY_HEADERS[i]));
  }
  if (!rules.isLocal(presenceRules.isLoopback(e.remoteIP()), presenceRules.isLoopback(e.realIP()), proxy)) {
    return { refused: 'loopback' };
  }
  var host = String(e.request.host || '');
  if (!rules.isOwnHost(host, rules.listenPort(args)) || !rules.isSameOrigin(method, host, header(e, 'Origin'), header(e, 'Sec-Fetch-Site'))) {
    return { refused: 'origin' };
  }
  var user = userOf(e);
  if (user === '' || user !== ownerId(e.app)) {
    return { refused: 'owner' };
  }
  var kind = opts.kind || (rules.action(name).changes ? 'change' : 'read');
  var rate = takeRate(e, kind);
  if (!rate.allowed) {
    return { refused: 'rate', retryAfterSeconds: rate.retryAfterSeconds };
  }
  if (opts.local) {
    return { appDir: '' };
  }
  var appDir = ownAppDir();
  if (appDir === '') {
    return { refused: 'unavailable' };
  }
  return { appDir: appDir };
}

/**
 * Runs the whitelisted command `name` of the control script and returns its exit code and, for
 * commands with `output`, the JSON line it printed. A command with `input` gets `input` as one
 * JSON object on standard input (UTF-8), never as arguments. Throws if Windows PowerShell does not
 * start.
 */
function run(appDir, name, input) {
  var spec = rules.action(name);
  var line = rules.commandLine(appDir, name, $os.getenv('SystemRoot'));
  var cmd = $os.cmd.apply(null, [line.program].concat(line.args));
  cmd.dir = appDir;
  var output = '';
  if (spec.output || spec.input) {
    var stdin = spec.input ? cmd.stdinPipe() : null;
    // Without output the command gets no pipe for it (a process it starts could inherit the pipe).
    var pipe = spec.output ? cmd.stdoutPipe() : null;
    cmd.start();
    if (stdin !== null) {
      stdin.write(toBytes(JSON.stringify(input || {})));
      stdin.close();
    }
    output = pipe !== null ? toString(pipe, MAX_OUTPUT_BYTES) : '';
    try {
      cmd.wait();
    } catch (err) {
      // A command that reports through its exit code (status 3, 5, 6) ends with an error here.
    }
  } else {
    try {
      cmd.run();
    } catch (err) {
      if (!cmd.processState) {
        throw err;
      }
    }
  }
  return { code: cmd.processState ? cmd.processState.exitCode() : -1, output: output };
}

/** The parsed JSON line of the command `name`, or null if it did not start or printed none. */
function runJson(appDir, name, input) {
  try {
    return JSON.parse(String(run(appDir, name, input).output));
  } catch (err) {
    return null;
  }
}

/** File, token and switched-on mailboxes: what the mail helper needs (lib/system-rules mailBlocker). */
function mailState(app, appDir) {
  return {
    installed: fileExists(appDir + '\\' + MAIL_HELPER),
    tokenSet: String($os.getenv(INGEST_TOKEN) || '') !== '',
    mailboxes: app.countRecords('connections', $dbx.hashExp({ type: 'mail', enabled: true }))
  };
}

/** Status of the control script with the state of the mail helper, or null. */
function readStatus(e, appDir) {
  var view = rules.statusView(runJson(appDir, 'status'));
  if (view === null) {
    return null;
  }
  var mail = mailState(e.app, appDir);
  return {
    appDir: appDir,
    status: view,
    mail: { installed: mail.installed, running: view.mailHelperPid !== null, blocker: rules.mailBlocker(mail) }
  };
}

/** Values of the variables the server knows by name, removed from every log line. */
function knownSecrets(app) {
  var values = [String($os.getenv(INGEST_TOKEN) || '')];
  var found = app.findRecordsByFilter('connections', 'secret_env != ""', '', 0, 0);
  for (var i = 0; i < found.length; i++) {
    var name = String(found[i].getString('secret_env'));
    if (secrets.isValidName(name)) {
      values.push(String($os.getenv(name) || ''));
    }
  }
  return values;
}

/** GET /api/byl/system, /doctor and /logs. */
function read(e, name) {
  var context = check(e, name, 'GET');
  if (context.refused) {
    return refuse(e, name, context.refused, context.retryAfterSeconds);
  }
  if (name === 'status') {
    var status = readStatus(e, context.appDir);
    return status === null ? refuse(e, name, 'script') : e.json(200, status);
  }
  var parsed = runJson(context.appDir, name);
  if (name === 'doctor') {
    var doctor = rules.doctorView(parsed);
    return doctor === null ? refuse(e, name, 'script') : e.json(200, doctor);
  }
  var hidden = knownSecrets(e.app);
  var logs = rules.logsView(parsed, function (line) {
    return rules.maskLogLine(secrets.redact(line, hidden));
  });
  return logs === null ? refuse(e, name, 'script') : e.json(200, logs);
}

/** Marks an action as running; false if another one runs (one at a time). */
function claim(store, now) {
  var claimed = false;
  store.setFunc(rules.RUNNING_KEY, function (since) {
    if (typeof since === 'number' && now - since < 120000 && now >= since) {
      return since;
    }
    claimed = true;
    return now;
  });
  return claimed;
}

/** POST /api/byl/system/actions/{name}: restart, mail-restart, autostart-on, autostart-off. */
function act(e, name) {
  var spec = rules.action(name);
  if (spec === null || !spec.changes || spec.backup === true) {
    return refuse(e, name, 'unknown');
  }
  var context = check(e, name, 'POST');
  if (context.refused) {
    return refuse(e, name, context.refused, context.retryAfterSeconds);
  }
  var store = e.app.store();
  var now = Date.now();
  if (name === 'restart' && rules.restartPending(store.get(rules.RESTART_KEY), now)) {
    return refuse(e, name, 'busy');
  }
  if (!claim(store, now)) {
    return refuse(e, name, 'busy');
  }
  var result;
  try {
    result = run(context.appDir, name);
    if (name === 'restart' && result.code === 0) {
      store.set(rules.RESTART_KEY, now);
    }
  } catch (err) {
    result = { code: -1 };
  } finally {
    store.remove(rules.RUNNING_KEY);
  }
  e.app.logger().info('byl-system: Aktion ausgeführt', 'action', name, 'user', userOf(e), 'exit', result.code);
  if (result.code !== 0) {
    return refuse(e, name, 'script');
  }
  if (name === 'restart') {
    return e.json(202, { restarting: true });
  }
  var status = readStatus(e, context.appDir);
  return status === null ? refuse(e, name, 'script') : e.json(200, status);
}

module.exports = {
  read: read,
  act: act,
  // Shared with the page "Sicherung" (lib/backup-service.js, ADR-0046): the same checks, refusals,
  // owner and commands of the control script.
  check: check,
  refuse: refuse,
  ownAppDir: ownAppDir,
  run: run,
  runJson: runJson,
  userOf: userOf
};
