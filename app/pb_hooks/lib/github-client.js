// Client of the GitHub REST API for the GitHub channel (ADR-0050). It knows one method only:
// GET. There is no function that sends anything else, so the channel cannot change a repository
// (tests/unit/github-readonly.test.mjs checks that statically). Every request may be conditional
// (If-None-Match with the stored ETag; a 304 does not count against the rate limit of a token),
// reads the rate limit from the headers of every answer, and stops before a request once GitHub
// said nothing is left, or after a 403/429 that is a rate limit (primary or secondary, with
// Retry-After). The token comes from the caller (read from its BYL_* variable at the moment of the
// run) and only goes into the Authorization header; without one the client asks without
// authorization (public repositories, 60 requests per hour). No request starts later than the
// deadline of the run; the time limit of each one shrinks to what is left. Errors carry the HTTP
// status and a kind, never the token or an address with it.
// CommonJS module, ES5 only, Goja runtime only.
'use strict';

var rules = require(__hooks + '/lib/github-rules.js');

var USER_AGENT = 'becauseyoulovejira (GitHub-Kanal, nur lesend)';
var JSON_MEDIA = 'application/vnd.github+json';
var RAW_MEDIA = 'application/vnd.github.raw+json';

/**
 * A failed request. `githubStatus` is the HTTP status (0 without an answer), `githubKind` one of
 * 'http', 'timeout', 'network', 'deadline' (the run has no time left), 'limit' (a rate limit holds
 * until `until`, ms; `limitKind` 'primary' or 'secondary'), 'invalid' (no readable answer) and
 * 'too_large'.
 */
function failure(status, kind, extra) {
  var error = new Error('GitHub ' + status + ' ' + kind);
  error.githubStatus = status;
  error.githubKind = kind;
  if (extra) {
    for (var key in extra) {
      if (Object.prototype.hasOwnProperty.call(extra, key)) {
        error[key] = extra[key];
      }
    }
  }
  return error;
}

/** Whether `error` is a failure of this client. */
function isFailure(error) {
  return !!error && typeof error.githubStatus === 'number' && typeof error.githubKind === 'string';
}

// Value of a response header (map of lists in the JSVM), '' without one.
function headerOf(headers, name) {
  if (!headers) {
    return '';
  }
  var wanted = name.toLowerCase();
  var value;
  for (var key in headers) {
    if (String(key).toLowerCase() === wanted) {
      value = headers[key];
      break;
    }
  }
  if (value && typeof value !== 'string' && value.length !== undefined) {
    value = value[0];
  }
  return value ? String(value) : '';
}

function parseJson(body) {
  try {
    return JSON.parse(toString(body));
  } catch (err) {
    return undefined;
  }
}

/**
 * A client for one run. `app` gives the store (mark of the test mode); `token` may be '' (no
 * authorization); `deadline` (ms) is the end of the run; `backoff` counts the secondary limits in
 * a row before (for the waiting time after one without Retry-After).
 */
function create(app, token, deadline, backoff) {
  var testMode = app.store().get(rules.TEST_MODE_KEY) === true;
  var base = rules.apiBase(testMode, $os.getenv(rules.TEST_PORT_ENV));
  var rate = { limit: -1, remaining: -1, reset: 0, retryAfter: -1 };
  var requests = 0;
  var notModified = 0;

  /**
   * GET `path` (with query; segments already encoded). `options`: { etag, raw }. Returns
   * { status: 200 | 304, json, body, etag, next } (`body` the raw bytes for `raw`, `next` the path
   * of rel="next"); throws a failure for everything else.
   */
  function get(path, options) {
    var opts = options || {};
    var now = Date.now();
    var exhausted = rules.exhaustedUntil(rate, now);
    if (exhausted > 0) {
      throw failure(403, 'limit', { until: exhausted, limitKind: 'primary' });
    }
    var seconds = rules.attemptSeconds(deadline, now);
    if (seconds === 0) {
      throw failure(0, 'deadline');
    }
    var headers = {
      Accept: opts.raw ? RAW_MEDIA : JSON_MEDIA,
      'X-GitHub-Api-Version': rules.API_VERSION,
      'User-Agent': USER_AGENT
    };
    if (token !== '') {
      headers.Authorization = 'Bearer ' + token;
    }
    if (opts.etag) {
      headers['If-None-Match'] = opts.etag;
    }
    var response;
    requests += 1;
    try {
      response = $http.send({ url: base + path, method: 'GET', headers: headers, timeout: seconds });
    } catch (err) {
      throw failure(0, rules.isTimeoutText(String(err)) ? 'timeout' : 'network');
    }
    var read = function (name) {
      return headerOf(response.headers, name);
    };
    var answered = rules.rateOf(read);
    if (answered.remaining >= 0) {
      rate = answered;
    } else {
      rate.retryAfter = answered.retryAfter;
    }
    if (response.statusCode === 304) {
      notModified += 1;
      return { status: 304, json: null, body: null, etag: opts.etag || '', next: '' };
    }
    if (response.body && response.body.length > rules.LIMITS.responseBytes) {
      throw failure(502, 'too_large');
    }
    if (response.statusCode !== 200) {
      var problem = parseJson(response.body);
      var message = problem && typeof problem.message === 'string' ? problem.message : '';
      var limit = rules.limitOf(response.statusCode, answered, message, Date.now(), backoff);
      if (limit) {
        throw failure(response.statusCode, 'limit', { until: limit.until, limitKind: limit.kind });
      }
      throw failure(response.statusCode, 'http');
    }
    var json = null;
    if (!opts.raw) {
      json = parseJson(response.body);
      if (json === undefined || json === null || typeof json !== 'object') {
        throw failure(502, 'invalid');
      }
    }
    return {
      status: 200,
      json: json,
      body: opts.raw ? response.body : null,
      etag: read('etag'),
      next: rules.pathOfLink(rules.nextLink(read('link')), base)
    };
  }

  return {
    authenticated: token !== '',
    get: get,
    /** The rate limit GitHub named last: { limit, remaining, reset }. */
    rate: function () {
      return { limit: rate.limit, remaining: rate.remaining, reset: rate.reset };
    },
    /** Requests sent so far and how many of them GitHub answered with 304. */
    counts: function () {
      return { requests: requests, notModified: notModified };
    }
  };
}

module.exports = {
  create: create,
  isFailure: isFailure
};
