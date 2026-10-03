// Guard of every request (ADR-0055; plan docs/plan/sicherheit.md, SH-1), run by security.pb.js
// before every other middleware of PocketBase: a request must name this app in its Host header
// (127.0.0.1, localhost or [::1] with the port of --http, or a host of the origins of the start),
// otherwise 403 before anything is read (DNS rebinding). Then the headers of lib/security-rules.js
// and the two narrow CORS exceptions (browser extension, landing page per file://).
'use strict';

var rules = require(__hooks + '/lib/security-rules.js');
var system = require(__hooks + '/lib/system-rules.js');
var inboxKeys = require(__hooks + '/lib/inbox-key-rules.js');

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

module.exports = {
  guard: guard,
  hostAllowed: hostAllowed
};
