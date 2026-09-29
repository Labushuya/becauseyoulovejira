// Cache rule for the web build that PocketBase serves from pb_public (ADR-0040). Without a
// Cache-Control header a browser may reuse index.html on its own for a tenth of the time since
// the file last changed, so after a new build a tab could start the old version from its cache.
// "no-cache" lets the browser keep its copy but ask every time (the answer is 304 while nothing
// changed). The API and the admin UI keep the headers of PocketBase.

var STATIC_CACHE_CONTROL = 'no-cache';

/**
 * Cache-Control for a request, or null to leave the response alone.
 * @param {string} method
 * @param {string} path path of the URL without query
 * @returns {string|null}
 */
function staticCacheControl(method, path) {
  if (method !== 'GET' && method !== 'HEAD') return null;
  var own = path === '/api' || path.indexOf('/api/') === 0 || path === '/_' || path.indexOf('/_/') === 0;
  return own ? null : STATIC_CACHE_CONTROL;
}

module.exports = {
  STATIC_CACHE_CONTROL: STATIC_CACHE_CONTROL,
  staticCacheControl: staticCacheControl
};
