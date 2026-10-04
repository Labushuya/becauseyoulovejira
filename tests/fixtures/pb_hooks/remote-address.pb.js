/// <reference path="../pb_data/types.d.ts" />
// Test only (plan heimnetz): a request with the header X-Byl-Test-Remote-Address comes, for this
// server, from that IPv4 address, as if another device of the home network had sent it. The
// middleware sets the peer of the connection (RemoteAddr) before the guard of security.pb.js, so
// every check of the app and of PocketBase sees it like a real connection: remoteIP() and realIP()
// (no trusted proxy is set), superuserIPs and the rate limiter. The tests of the access in the home
// network use it where no address besides loopback can be listened on (tests/integration/
// lan-access.test.mjs). The harness copies this file next to app/pb_hooks in every integration test
// instance; it is never part of the portable app folder, and nothing of the app sends the header.
routerUse(
  new Middleware(
    function (e) {
      var address = String(e.request.header.get('X-Byl-Test-Remote-Address') || '');
      if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(address)) {
        e.request.remoteAddr = address + ':40000';
      }
      return e.next();
    },
    -1050,
    'bylTestRemoteAddress'
  )
);
