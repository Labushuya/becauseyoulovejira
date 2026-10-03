/// <reference path="../pb_data/types.d.ts" />
// Guard of every request (ADR-0055; plan docs/plan/sicherheit.md, SH-1): Host allowlist against DNS
// rebinding, security headers and the two narrow CORS exceptions, in lib/security-service.js.
// Priority -1042 runs it before every middleware of PocketBase except the www redirect: before CORS
// (-1041, so a preflight of the browser extension reaches it), the activity log, the auth token
// and the rate limiter, so a request to a foreign host reads nothing and costs no attempt.
// A Middleware is compiled from its source in every VM: the function must not use outer names.

routerUse(
  new Middleware(
    function (e) {
      return require(`${__hooks}/lib/security-service.js`).guard(e);
    },
    -1042,
    'bylSecurityGuard'
  )
);
