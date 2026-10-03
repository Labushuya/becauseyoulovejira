/// <reference path="../pb_data/types.d.ts" />
// Security of the app (ADR-0055; plan docs/plan/sicherheit.md): the guard of every request (SH-1),
// the routes of the page "Einstellungen → Sicherheit" and the protocol of failed sign-ins (SH-2).
// The logic lives in lib/security-service.js; handlers run in isolated scopes, so the module is
// required inside them.

// Guard of every request (SH-1): Host allowlist against DNS rebinding, security headers and the two
// narrow CORS exceptions. Priority -1042 runs it before every middleware of PocketBase except the www
// redirect: before CORS (-1041, so a preflight of the browser extension reaches it), the activity
// log, the auth token and the rate limiter, so a request to a foreign host reads nothing and costs
// no attempt. A Middleware is compiled from its source in every VM: the function must not use outer
// names.
routerUse(
  new Middleware(
    function (e) {
      return require(`${__hooks}/lib/security-service.js`).guard(e);
    },
    -1042,
    'bylSecurityGuard'
  )
);

// Overview of the page: protection, addresses, admin UI, backups, access data, keys, extension,
// validity of a sign-in and the failed sign-ins.
routerAdd(
  'GET',
  '/api/byl/security',
  function (e) {
    return require(`${__hooks}/lib/security-service.js`).read(e);
  },
  $apis.requireAuth('users')
);

// Level of the protection against guessing and the validity of a sign-in; both apply at once.
routerAdd(
  'POST',
  '/api/byl/security/settings',
  function (e) {
    return require(`${__hooks}/lib/security-service.js`).saveSettings(e);
  },
  $apis.requireAuth('users')
);

// Further hosts in byl-config.json through the control script; they apply after a restart.
routerAdd(
  'POST',
  '/api/byl/security/hosts',
  function (e) {
    return require(`${__hooks}/lib/security-service.js`).saveHosts(e);
  },
  $apis.requireAuth('users')
);

// Whether failed sign-ins of the last 24 hours ask for attention when the app opens (ADR-0035).
routerAdd(
  'GET',
  '/api/byl/security/notice',
  function (e) {
    return require(`${__hooks}/lib/security-service.js`).notice(e);
  },
  $apis.requireAuth('users')
);

// Every failed sign-in with password of the app and of the admin UI, without the password. The
// answer of the sign-in stays the one of PocketBase.
onRecordAuthWithPasswordRequest(function (e) {
  try {
    e.next();
  } catch (err) {
    require(`${__hooks}/lib/security-service.js`).recordFailure(e);
    throw err;
  }
});

// Failed sign-ins older than 30 days go once a day (and with every new one).
cronAdd('byl-login-failures', '20 3 * * *', function () {
  try {
    require(`${__hooks}/lib/security-service.js`).pruneFailures($app, Date.now());
  } catch (err) {
    $app.logger().error('byl-security: Bereinigung der Anmeldungen gescheitert', 'error', String(err));
  }
});
