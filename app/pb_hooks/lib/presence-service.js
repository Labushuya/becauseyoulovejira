// Presence and attention routes (ADR-0035 section 4; plan start-fenster, SF-1): start.bat asks how
// many app tabs listen on the realtime topic byl/attention, sends them a message with a nonce and
// waits for a tab to confirm it; the landing page (file://) does the same. The state lives only in
// $app.store() (gone after a restart) and holds nonces, times and flags, never data of accounts.
// The rules are pure in lib/presence-rules.js.
'use strict';

var rules = require(__hooks + '/lib/presence-rules.js');

function kindOf(e) {
  var header = e.request.header;
  return rules.requestKind(header.get('Origin'), header.get('Sec-Fetch-Site'), header.get('Sec-Fetch-Mode'));
}

/** The kind of the request if it may use `route`; 403 for other machines and other callers. */
function guard(e, route) {
  var kind = kindOf(e);
  if (!rules.isLoopback(e.remoteIP()) || !rules.allows(route, kind)) {
    throw new ForbiddenError();
  }
  return kind;
}

/** Removes attention entries that expired or cannot be read. */
function prune(store, now) {
  var keys = store.keys();
  for (var i = 0; i < keys.length; i++) {
    var key = String(keys[i]);
    if (key.indexOf(rules.ENTRY_PREFIX) !== 0) {
      continue;
    }
    var entry = rules.parseEntry(store.get(key));
    if (entry === null || rules.isExpired(entry.createdAt, now)) {
      store.remove(key);
    }
  }
}

/** Realtime clients of signed-in app users that subscribed to the topic (the open app tabs). */
function listeners(app) {
  var clients = app.subscriptionsBroker().clients();
  var found = [];
  for (var id in clients) {
    var client = clients[id];
    if (!client || !client.hasSubscription(rules.TOPIC) || client.isDiscarded()) {
      continue;
    }
    var auth = client.get('auth');
    if (!auth || auth.collection().name !== 'users') {
      continue;
    }
    found.push(client);
  }
  return found;
}

/** GET /api/byl/presence: only for scripts on this machine. */
function presence(e) {
  guard(e, 'presence');
  var store = e.app.store();
  var now = Date.now();
  prune(store, now);
  return e.json(200, {
    tabs: listeners(e.app).length,
    landingAgoMs: rules.landingAgo(store.get(rules.LANDING_KEY), now)
  });
}

/**
 * POST /api/byl/attention?reason=start|datei|stop: sends { nonce, reason } to every open app tab.
 * A request of the landing page (Origin "null") also marks the landing as seen, even when the
 * message itself is refused for coming too soon (429).
 */
function attention(e) {
  var kind = guard(e, 'attention');
  var reason = e.request.url.query().get('reason');
  if (!rules.isReason(reason)) {
    throw new BadRequestError('Unbekannter Grund.');
  }
  var store = e.app.store();
  var now = Date.now();
  prune(store, now);
  if (kind === 'file') {
    store.set(rules.LANDING_KEY, now);
  }
  var allowed = false;
  store.setFunc(rules.LAST_SENT_KEY, function (last) {
    if (rules.mayNotify(last, now)) {
      allowed = true;
      return now;
    }
    return last;
  });
  if (!allowed) {
    throw new ApiError(429, 'Zu viele Hinweise in kurzer Zeit.');
  }

  var nonce = $security.randomString(rules.NONCE_LENGTH);
  store.set(rules.ENTRY_PREFIX + nonce, rules.serializeEntry(now, false));
  var message = new SubscriptionMessage({ name: rules.TOPIC, data: rules.messageData(nonce, reason) });
  var targets = listeners(e.app);
  var notified = 0;
  for (var i = 0; i < targets.length; i++) {
    try {
      targets[i].send(message);
      notified += 1;
    } catch (err) {
      // A client that went away in the meantime simply counts as not notified.
    }
  }
  return e.json(200, { nonce: nonce, notified: notified });
}

function entryOf(store, nonce) {
  if (!rules.isNonce(nonce)) {
    return null;
  }
  return rules.parseEntry(store.get(rules.ENTRY_PREFIX + nonce));
}

/** GET /api/byl/attention/{nonce}: whether a tab confirmed; 404 for unknown or expired nonces. */
function attentionState(e, nonce) {
  guard(e, 'attention');
  var store = e.app.store();
  prune(store, Date.now());
  var entry = entryOf(store, nonce);
  if (entry === null) {
    throw new NotFoundError();
  }
  return e.json(200, { acked: entry.acked });
}

/** POST /api/byl/attention/{nonce}/ack (signed-in app user): the tab is awake and shows the hint. */
function ack(e, nonce) {
  var store = e.app.store();
  prune(store, Date.now());
  var entry = entryOf(store, nonce);
  if (entry === null) {
    throw new NotFoundError();
  }
  store.set(rules.ENTRY_PREFIX + nonce, rules.serializeEntry(entry.createdAt, true));
  return e.noContent(204);
}

module.exports = {
  presence: presence,
  attention: attention,
  attentionState: attentionState,
  ack: ack
};
