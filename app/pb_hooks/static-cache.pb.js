/// <reference path="../pb_data/types.d.ts" />
// Cache-Control for the files of the web build (lib/static-cache.js, ADR-0040): a new build is
// seen at the next load instead of an old index.html from the cache of the browser. routerUse
// runs before the handler of the matched route, also before the static files of pb_public.

routerUse(function (e) {
  var rule = require(`${__hooks}/lib/static-cache.js`);
  var value = rule.staticCacheControl(e.request.method, e.request.url.path);
  if (value !== null) {
    e.response.header().set('Cache-Control', value);
  }
  return e.next();
});
