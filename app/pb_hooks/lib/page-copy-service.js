// Page copy of a web link (ADR-0031 section 6): "Seiteninhalt sichern" fetches the address of a
// link entry once, keeps the text of the page below the excerpt and the HTML (at most 2 MB) as
// protected original. The address passes lib/url-guard.js first; the limits of that guard in the
// JSVM (no name resolution, redirects followed by $http.send without naming the target, the
// answer loaded before its size is known) are named in the ADR.
// CommonJS module, ES5 only, Goja runtime only.
'use strict';

var INBOX = 'inbox_items';

// Only the tests set it: allows 127.0.0.1 on this port for the fake server (ADR-0031 section 6).
var TEST_PORT_ENV = 'BYL_TEST_PAGE_PORT';

var MESSAGES = {
  unavailable: 'Der Eingang steht nach dem nächsten Start der App bereit (start.bat).',
  notFound: 'Eintrag nicht gefunden.',
  notLink: 'Nur Web-Links mit Adresse haben eine Seite zum Sichern.',
  done: 'Die Seite ist schon gesichert.',
  unreachable: 'Die Seite ließ sich nicht abrufen.',
  notHtml: 'Nur HTML-Seiten lassen sich sichern.'
};

function answer(status, body) {
  return { status: status, body: body };
}

// Value of a response header (map of lists in the JSVM), '' without one.
function headerOf(headers, name) {
  if (!headers) {
    return '';
  }
  var value = headers[name];
  if (value === undefined || value === null) {
    var wanted = name.toLowerCase();
    for (var key in headers) {
      if (String(key).toLowerCase() === wanted) {
        value = headers[key];
        break;
      }
    }
  }
  if (value && typeof value !== 'string' && value.length !== undefined) {
    value = value[0];
  }
  return value ? String(value) : '';
}

function testPort() {
  var value = parseInt(String($os.getenv(TEST_PORT_ENV) || ''), 10);
  return value > 0 && value < 65536 ? value : 0;
}

// The item `id` if the request may see it (view rule), else null.
function visibleItem(e, collection, id) {
  var found = e.app.findRecordsByFilter(INBOX, 'id = {:id}', '', 1, 0, { id: id });
  if (found.length === 0) {
    return null;
  }
  return e.app.canAccessRecord(found[0], e.requestInfo(), collection.viewRule) ? found[0] : null;
}

/**
 * POST /api/byl/inbox/{id}/page. Returns { status, body }: 200 with { title, size, truncated },
 * 400/404/409/415/502 with { message }, 503 before the inbox exists.
 */
function savePage(e, id) {
  var rules = require(__hooks + '/lib/page-copy.js');
  var guard = require(__hooks + '/lib/url-guard.js');
  var htmlText = require(__hooks + '/lib/html-text.js');
  var inboxRules = require(__hooks + '/lib/inbox-rules.js');
  var inbox = require(__hooks + '/lib/inbox-service.js');

  var collection;
  try {
    collection = e.app.findCollectionByNameOrId(INBOX);
  } catch (err) {
    return answer(503, { message: MESSAGES.unavailable });
  }
  var record = visibleItem(e, collection, id);
  if (record === null) {
    return answer(404, { message: MESSAGES.notFound });
  }
  if (record.getString('channel') !== 'link' || record.getString('source_url') === '') {
    return answer(400, { message: MESSAGES.notLink });
  }
  if (record.getString('original') !== '') {
    return answer(409, { message: MESSAGES.done });
  }
  var checked = guard.checkUrl(record.getString('source_url'), testPort());
  if (!checked.ok) {
    return answer(400, { message: checked.message });
  }

  var response;
  try {
    response = $http.send({
      url: checked.url,
      method: 'GET',
      timeout: rules.TIMEOUT_SECONDS,
      headers: {
        Accept: 'text/html,application/xhtml+xml',
        Range: 'bytes=0-' + (rules.MAX_PAGE_BYTES - 1),
        'User-Agent': 'becauseyoulovejira (Seitenkopie)'
      }
    });
  } catch (err) {
    return answer(502, { message: MESSAGES.unreachable });
  }
  if (!rules.isAcceptedStatus(response.statusCode)) {
    return answer(502, { message: 'Die Seite antwortet mit HTTP ' + response.statusCode + '.' });
  }
  var contentType = headerOf(response.headers, 'Content-Type');
  if (!rules.isHtmlType(contentType)) {
    return answer(415, { message: MESSAGES.notHtml });
  }

  var bytes = response.body;
  var size = bytes.length;
  var utf8 = toString(bytes);
  var charset = rules.charsetOf(contentType, utf8.slice(0, 4096));
  var html = rules.isSingleByte(charset)
    ? rules.decodeWindows1252(bytes, Math.min(size, rules.MAX_PAGE_BYTES))
    : rules.utf8Prefix(utf8, rules.MAX_PAGE_BYTES);
  var truncated = size > rules.MAX_PAGE_BYTES;
  var title = htmlText.pageTitle(html);

  var outcome = null;
  e.app.runInTransaction(function (txApp) {
    // Again inside the transaction: two clicks at once keep only the first copy.
    var current = txApp.findRecordById(INBOX, record.id);
    if (current.getString('original') !== '') {
      outcome = answer(409, { message: MESSAGES.done });
      return;
    }
    current.set(
      'body',
      rules.composeBody(current.getString('body'), htmlText.htmlToText(html), inboxRules.BODY_MAX_LENGTH, inboxRules.truncate)
    );
    current.set(
      'source_meta',
      rules.pageMeta(inbox.metaOf(current), {
        // PocketBase notation "YYYY-MM-DD HH:MM:SS.sssZ", like every date the SPA reads.
        fetchedAt: new Date().toISOString().replace('T', ' '),
        size: size,
        truncated: truncated,
        charset: charset,
        title: title
      })
    );
    current.set('original', $filesystem.fileFromBytes(html, 'seite.html'));
    txApp.save(current);
    outcome = answer(200, { title: title, size: size, truncated: truncated });
  });
  return outcome;
}

module.exports = {
  TEST_PORT_ENV: TEST_PORT_ENV,
  MESSAGES: MESSAGES,
  savePage: savePage
};
