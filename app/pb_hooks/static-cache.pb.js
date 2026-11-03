/// <reference path="../pb_data/types.d.ts" />
// Cache-Control for the files of the web build (lib/static-cache.js, ADR-0040): a new build is
// seen at the next load instead of an old index.html from the cache of the browser. routerUse
// runs before the handler of the matched route, also before the static files of pb_public.
//
// The only global JS middleware around e.next() for logic across every request (ADR-0077,
// Konsequenzen): each such wrapper holds a runtime of the JSVM pool for the whole request, also for
// every open realtime connection. New logic of that kind goes in here, never into a wrapper of its
// own. Priority 0: after the guard (-1042), CORS and the token of the session, so the account of the
// request is known.

routerUse(function (e) {
  var rule = require(`${__hooks}/lib/static-cache.js`);
  var value = rule.staticCacheControl(e.request.method, e.request.url.path);
  if (value !== null) {
    e.response.header().set('Cache-Control', value);
  }
  try {
    return e.next();
  } catch (err) {
    // The error log of the server (FP-2): an unexpected failure gets an entry and the header
    // X-Byl-Problem; the error goes on unchanged, and a failure of the log changes nothing.
    try {
      require(`${__hooks}/lib/problem-service.js`).onRequestError(e, err);
    } catch (ignored) {
      // The answer stays that of PocketBase.
    }
    throw err;
  }
});
