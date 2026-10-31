// Routes of the access data set from the browser (BW-3, ADR-0075): the state of the BYL_* variables
// of the channels in the Windows user environment, setting and removing one, and the mark "a change
// waits for a restart". Reading the state, setting and removing go through the checks of the page
// System (check of lib/system-service.js, in its order: Windows, this machine, the address of the
// app, the administrator, rate limit; then the request; last the own instance of the app folder)
// and the fixed commands credential-status, credential-set and credential-remove of byl-control.ps1
// (whitelist in lib/system-rules.js). A value goes from the body of the POST only onto the standard
// input of the command, never onto its command line, into a log, into the store or into an answer;
// refusals and actions are logged with action, name of the variable, user and reason only. The mark
// of a change lives in $app.store(), in the memory of this server: after a restart it is gone.
'use strict';

var rules = require(__hooks + '/lib/credential-rules.js');
var secrets = require(__hooks + '/lib/secrets.js');
var system = require(__hooks + '/lib/system-service.js');
var systemRules = require(__hooks + '/lib/system-rules.js');

var AREA = 'byl-credentials';

/**
 * The names the connections of this instance read, with the names of the connections that use
 * each: { names, channels }. Every connection counts, whoever owns it (ADR-0075 §1).
 */
function referenced(app) {
  var connections = require(__hooks + '/lib/connection-service.js');
  var names = [];
  var channels = {};
  var found;
  try {
    found = app.findRecordsByFilter('connections', 'secret_env != "" || type = "telegram"', 'label', 0, 0);
  } catch (err) {
    // Before the migration of the connections there is nothing to name.
    found = [];
  }
  for (var i = 0; i < found.length; i++) {
    var used = connections.variableNamesOf(found[i]);
    var label = String(found[i].getString('label'));
    for (var j = 0; j < used.length; j++) {
      var name = used[j];
      if (names.indexOf(name) === -1) {
        names.push(name);
        channels[name] = [];
      }
      if (channels[name].indexOf(label) === -1) {
        channels[name].push(label);
      }
    }
  }
  return { names: names, channels: channels };
}

function restartNeeded(app) {
  return rules.restartNeeded(app.store().get(rules.RESTART_NOTICE_KEY));
}

/** The body of the request; null when it is no JSON object (the parse error stays here). */
function bodyOf(e) {
  try {
    return e.requestInfo().body;
  } catch (err) {
    return null;
  }
}

/** 400 with the problem of the request; logged with action, problem, name and user, never a value. */
function invalid(e, action, problem, name) {
  e.app
    .logger()
    .warn(AREA + ': Anfrage abgelehnt', 'action', action, 'reason', problem, 'name', name || '', 'user', system.userOf(e), 'ip', String(e.remoteIP()));
  return e.json(400, rules.problemView(problem, name));
}

/** The answer of the command `action` with `input` on its standard input; null without one. */
function runCommand(appDir, action, input) {
  try {
    return system.runJson(appDir, action, input);
  } catch (err) {
    return null;
  }
}

/** GET /api/byl/credentials?names=A,B: the state of the names of the connections and of a setup. */
function status(e) {
  var context = system.check(e, 'credential-status', 'GET', { local: true });
  if (context.refused) {
    return system.refuse(e, 'credential-status', context.refused, context.retryAfterSeconds, AREA);
  }
  var known = referenced(e.app);
  var names = rules.statusNames(String(e.request.url.query().get('names') || ''), known.names, secrets);
  var appDir = system.ownAppDir();
  if (appDir === '') {
    return system.refuse(e, 'credential-status', 'unavailable', 0, AREA);
  }
  var asked = [];
  for (var i = 0; i < names.length; i++) {
    if (!rules.isBlocked(names[i])) {
      asked.push(names[i]);
    }
  }
  var states = asked.length === 0 ? {} : rules.statusOf(runCommand(appDir, 'credential-status', { names: asked }), asked);
  if (states === null) {
    return system.refuse(e, 'credential-status', 'script', 0, AREA);
  }
  e.response.header().set('Cache-Control', 'no-store');
  return e.json(200, rules.statusView(names, states, known.channels, rules.isBlocked, restartNeeded(e.app)));
}

/**
 * POST /api/byl/credentials/set ({ name, value }) and /remove ({ name }): checks, request, the own
 * instance, no restart running; then the command, the mark for the restart and an audit entry.
 */
function change(e, action) {
  var context = system.check(e, action, 'POST', { local: true, kind: 'credential' });
  if (context.refused) {
    return system.refuse(e, action, context.refused, context.retryAfterSeconds, AREA);
  }
  var known = referenced(e.app).names;
  var body = bodyOf(e);
  var input = action === 'credential-set' ? rules.setInput(body, known, secrets) : rules.removeInput(body, known, secrets);
  body = null;
  if (input.problem) {
    return invalid(e, action, input.problem, input.name);
  }
  var appDir = system.ownAppDir();
  if (appDir === '') {
    return system.refuse(e, action, 'unavailable', 0, AREA);
  }
  var store = e.app.store();
  var now = Date.now();
  // A restart that was started already reads the environment before this change would be there,
  // and its end would take the mark along: the change waits until the server is back.
  if (systemRules.restartPending(store.get(systemRules.RESTART_KEY), now)) {
    return system.refuse(e, action, 'busy', 0, AREA);
  }
  var name = input.name;
  var answer = rules.scriptAnswer(runCommand(appDir, action, action === 'credential-set' ? { name: name, value: input.value } : { name: name }));
  input = null;
  if (answer === null) {
    e.app.logger().info(AREA + ': Aktion ausgeführt', 'action', action, 'name', name, 'user', system.userOf(e), 'result', 'script');
    return system.refuse(e, action, 'script', 0, AREA);
  }
  e.app.logger().info(AREA + ': Aktion ausgeführt', 'action', action, 'name', name, 'user', system.userOf(e), 'result', answer.ok ? 'ok' : answer.problem);
  if (!answer.ok) {
    return e.json(400, rules.problemView(answer.problem, name));
  }
  store.set(rules.RESTART_NOTICE_KEY, now);
  return e.json(200, { name: name, set: action === 'credential-set', restartNeeded: true });
}

/**
 * GET /api/byl/credentials/restart-notice: whether a change of access data waits for a restart, for
 * the administrator of the app on every device (the hint stands on the phone too, ADR-0075 §5).
 * Names nothing but yes or no and runs nothing.
 */
function notice(e) {
  if (!system.isAdminRequest(e)) {
    return system.refuse(e, 'credential-notice', 'owner', 0, AREA);
  }
  e.response.header().set('Cache-Control', 'no-store');
  return e.json(200, { needed: restartNeeded(e.app) });
}

module.exports = {
  status: status,
  set: function (e) {
    return change(e, 'credential-set');
  },
  remove: function (e) {
    return change(e, 'credential-remove');
  },
  notice: notice
};
