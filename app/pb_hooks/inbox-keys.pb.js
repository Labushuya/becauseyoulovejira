/// <reference path="../pb_data/types.d.ts" />
// The own inbox with access keys (ADR-0038; plan eigener-eingang-whatsapp-web, EI-1). Keys are
// created here and listed and revoked (deleted) through the Record API of inbox_keys, whose rules
// never deliver the hash. The logic lives in lib/inbox-key-service.js; handlers run in isolated
// scopes, so modules are required inside them.

// A new key for the signed-in user, shown once in the answer.
routerAdd(
  'POST',
  '/api/byl/inbox/keys',
  function (e) {
    return require(`${__hooks}/lib/inbox-key-service.js`).createKey(e);
  },
  $apis.requireAuth('users')
);

// "Verbindung testen": "Authorization: Bearer <key>", answers with the name of the key.
routerAdd('GET', '/api/byl/inbox/ingest', function (e) {
  return require(`${__hooks}/lib/inbox-key-service.js`).ping(e);
});

// One entry for the inbox of the owner of the key. A text holds at most 100 000 characters; the
// limit leaves room for UTF-8, JSON escaping and the other fields.
routerAdd(
  'POST',
  '/api/byl/inbox/ingest',
  function (e) {
    return require(`${__hooks}/lib/inbox-key-service.js`).ingest(e);
  },
  $apis.bodyLimit(512 * 1024)
);
