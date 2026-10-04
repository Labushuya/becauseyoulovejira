/// <reference path="../pb_data/types.d.ts" />
// Presence of open app tabs and the attention message (ADR-0035 section 4; plan start-fenster,
// SF-1). start.bat and the landing page ask before they open a new tab; the tabs listen on the
// realtime topic byl/attention and confirm a message. The logic lives in lib/presence-service.js;
// handlers run in isolated scopes, so modules are required inside them.

// Every realtime connection remembers whether it comes from this machine (plan heimnetz): only the
// tabs here count as open and get the messages. The handler must call e.next(); the connection
// lives inside it.
onRealtimeConnectRequest(function (e) {
  require(`${__hooks}/lib/presence-service.js`).markClient(e);
  e.next();
});

// Number of open app tabs and whether a landing page reported lately: scripts on this machine only.
routerAdd('GET', '/api/byl/presence', function (e) {
  return require(`${__hooks}/lib/presence-service.js`).presence(e);
});

// Message to the open tabs (?reason=start|datei|stop): scripts and the landing page (file://).
routerAdd('POST', '/api/byl/attention', function (e) {
  return require(`${__hooks}/lib/presence-service.js`).attention(e);
});

// Whether a tab confirmed the message: same callers as above.
routerAdd('GET', '/api/byl/attention/{nonce}', function (e) {
  return require(`${__hooks}/lib/presence-service.js`).attentionState(e, e.request.pathValue('nonce'));
});

// Confirmation of the tab that shows the hint: signed-in app users only.
routerAdd(
  'POST',
  '/api/byl/attention/{nonce}/ack',
  function (e) {
    return require(`${__hooks}/lib/presence-service.js`).ack(e, e.request.pathValue('nonce'));
  },
  $apis.requireAuth('users')
);
