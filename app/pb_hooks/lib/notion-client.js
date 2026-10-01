// Client of the Notion REST API for the import (ADR-0041). Only reading endpoints exist here:
// the bot user (users/me), the search, a data source and its query, a page and the children of a
// block; there is no function that writes, so the import cannot change Notion. The token comes
// from the caller (read from its BYL_* variable at the moment of the request) and only goes into
// the Authorization header; errors carry the HTTP status and the code of Notion, never the token
// or an address. Requests keep about 3 per second (a mark in the store of the app) and repeat
// after 429 with Retry-After and after a server error, but never beyond the deadline of the
// request of the app (LIMITS.routeSeconds from the creation of the client): after it no request
// starts, the time limit of each one shrinks to what is left, and a time-out is a failure with the
// code "timeout". Answers are parsed from their text, so the pure modules get plain JavaScript
// values.
// CommonJS module, ES5 only, Goja runtime only.
'use strict';

var rules = require(__hooks + '/lib/notion-rules.js');

// Time of the last request of this server, for the pause between requests.
var LAST_REQUEST_KEY = 'byl-notion-last-request';
var USER_AGENT = 'becauseyoulovejira (Notion-Import, nur lesend)';

function isObject(value) {
  return value !== null && typeof value === 'object' && Object.prototype.toString.call(value) === '[object Object]';
}

function isArray(value) {
  return Object.prototype.toString.call(value) === '[object Array]';
}

/** A failed request: HTTP status (0 without an answer) and the code of Notion. */
function failure(status, code) {
  var error = new Error('Notion ' + status + (code === '' ? '' : ' ' + code));
  error.notionStatus = status;
  error.notionCode = code;
  return error;
}

/** Whether `error` is a failure of this client. */
function isFailure(error) {
  return !!error && typeof error.notionStatus === 'number';
}

/** Whether `error` is a time-out: Notion answered too late, or the deadline of the request passed. */
function isTimeout(error) {
  return isFailure(error) && error.notionStatus === 0 && error.notionCode === 'timeout';
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

function parseBody(response) {
  try {
    return JSON.parse(toString(response.body));
  } catch (err) {
    return null;
  }
}

/**
 * A client for one token and one request of the app. `app` gives the store (pause between
 * requests, mark of the test mode). The deadline counts from now.
 */
function create(app, token) {
  var store = app.store();
  var testMode = store.get(rules.TEST_MODE_KEY) === true;
  var base = rules.apiBase(testMode, $os.getenv(rules.TEST_PORT_ENV));
  var timing = rules.timingOf(testMode, $os.getenv(rules.TEST_TIMING_ENV));
  var started = Date.now();
  var deadline = started + timing.routeMs;

  function pause() {
    var wait = rules.throttleWaitMs(store.get(LAST_REQUEST_KEY), Date.now());
    if (wait > 0) {
      sleep(wait);
    }
    store.set(LAST_REQUEST_KEY, Date.now());
  }

  // One request with its repetitions; returns the parsed answer of a 200 or throws a failure.
  function request(method, path, body) {
    for (var attempt = 0; ; attempt++) {
      pause();
      var seconds = rules.attemptSeconds(deadline, Date.now());
      if (seconds === 0) {
        throw failure(0, 'timeout');
      }
      var response;
      try {
        response = $http.send({
          url: base + path,
          method: method,
          body: body === undefined ? '' : JSON.stringify(body),
          headers: {
            Authorization: 'Bearer ' + token,
            'Notion-Version': rules.API_VERSION,
            'Content-Type': 'application/json',
            Accept: 'application/json',
            'User-Agent': USER_AGENT
          },
          timeout: seconds
        });
      } catch (err) {
        throw failure(0, rules.isTimeoutText(String(err)) ? 'timeout' : '');
      }
      if (response.body && response.body.length > rules.LIMITS.responseBytes) {
        throw failure(502, 'response_too_large');
      }
      var json = parseBody(response);
      if (response.statusCode === 200) {
        if (!isObject(json)) {
          throw failure(502, 'invalid_json');
        }
        return json;
      }
      var code = isObject(json) && typeof json.code === 'string' ? json.code : '';
      var delay = rules.retryDelayMs(response.statusCode, headerOf(response.headers, 'Retry-After'), attempt);
      if (delay < 0 || Date.now() + delay >= deadline) {
        throw failure(response.statusCode, code);
      }
      sleep(delay);
    }
  }

  function idPath(id) {
    var value = rules.normalizeId(id);
    if (value === '') {
      throw failure(400, 'invalid_id');
    }
    return value;
  }

  // Every page of a paginated POST, up to `max` results; { results, truncated }.
  function collect(path, body, max) {
    var results = [];
    var cursor = '';
    for (;;) {
      var page = {};
      for (var key in body) {
        if (Object.prototype.hasOwnProperty.call(body, key)) {
          page[key] = body[key];
        }
      }
      page.page_size = rules.LIMITS.pageSize;
      if (cursor !== '') {
        page.start_cursor = cursor;
      }
      var answer = request('POST', path, page);
      var list = isArray(answer.results) ? answer.results : [];
      for (var i = 0; i < list.length; i++) {
        if (results.length >= max) {
          return { results: results, truncated: true };
        }
        results.push(list[i]);
      }
      if (answer.has_more !== true || typeof answer.next_cursor !== 'string' || answer.next_cursor === '') {
        return { results: results, truncated: false };
      }
      if (results.length >= max) {
        return { results: results, truncated: true };
      }
      cursor = answer.next_cursor;
    }
  }

  // Children of one block, every page of them, while `state` stays within `limits`.
  function children(id, state, limits) {
    var list = [];
    var cursor = '';
    do {
      if (state.requests >= limits.requests) {
        state.truncated = true;
        return list;
      }
      state.requests += 1;
      var answer = request(
        'GET',
        '/v1/blocks/' + idPath(id) + '/children?page_size=' + rules.LIMITS.pageSize + (cursor === '' ? '' : '&start_cursor=' + encodeURIComponent(cursor))
      );
      var results = isArray(answer.results) ? answer.results : [];
      for (var i = 0; i < results.length; i++) {
        var block = results[i];
        if (!isObject(block) || block.in_trash === true || block.archived === true) {
          continue;
        }
        if (state.blocks >= limits.blocks) {
          state.truncated = true;
          return list;
        }
        state.blocks += 1;
        list.push(block);
      }
      cursor = answer.has_more === true && typeof answer.next_cursor === 'string' ? answer.next_cursor : '';
    } while (cursor !== '');
    return list;
  }

  // The children below `id`, and theirs where `descend(block, inPoint)` allows, depth first.
  function load(id, depth, inPoint, descend, state, limits) {
    var list = children(id, state, limits);
    for (var i = 0; i < list.length; i++) {
      var block = list[i];
      if (block.has_children !== true || !descend(block, inPoint) || rules.normalizeId(block.id) === '') {
        continue;
      }
      if (depth + 1 >= limits.depth || state.truncated) {
        state.truncated = true;
        continue;
      }
      block.children = load(block.id, depth + 1, inPoint || rules.isPoint(block), descend, state, limits);
    }
    return list;
  }

  return {
    /**
     * How long an import takes new entries once its source is read (ADR-0041, addendum of
     * 2026-09-30, since 2026-10-01 counted from the end of reading); then it hands the rest back.
     */
    importMs: timing.importMs,
    /** The bot user of the token (any capability may read it). */
    me: function () {
      return request('GET', '/v1/users/me');
    },
    /** Whether the integration sees at least one page or data source. */
    seesAnything: function () {
      var answer = request('POST', '/v1/search', { page_size: 1 });
      return isArray(answer.results) && answer.results.length > 0;
    },
    /**
     * Shared pages or data sources (`object` 'page' or 'data_source'), last edited first, up to
     * `max`; `query` narrows the search by title. { results, truncated }.
     */
    search: function (object, query, max) {
      var body = {
        filter: { property: 'object', value: object },
        sort: { timestamp: 'last_edited_time', direction: 'descending' }
      };
      if (query !== '') {
        body.query = query;
      }
      return collect('/v1/search', body, max);
    },
    dataSource: function (id) {
      return request('GET', '/v1/data_sources/' + idPath(id));
    },
    /** Rows of a data source in the order they were created, up to `max`. { results, truncated }. */
    rows: function (id, max) {
      return collect('/v1/data_sources/' + idPath(id) + '/query', { sorts: [{ timestamp: 'created_time', direction: 'ascending' }] }, max);
    },
    page: function (id) {
      return request('GET', '/v1/pages/' + idPath(id));
    },
    /**
     * The blocks below a page or block with their children in `children`, read where
     * `descend(block, inPoint)` allows, within `limits` ({ requests, blocks, depth }). Several
     * trees can share one `shared` state ({ requests, blocks, truncated }), so a page and its
     * sub-pages stay within one budget. { blocks, truncated }.
     */
    tree: function (id, descend, limits, shared) {
      var state = shared || { requests: 0, blocks: 0, truncated: false };
      var blocks = load(id, 0, false, descend, state, limits);
      return { blocks: blocks, truncated: state.truncated };
    }
  };
}

module.exports = {
  LAST_REQUEST_KEY: LAST_REQUEST_KEY,
  create: create,
  isFailure: isFailure,
  isTimeout: isTimeout
};
