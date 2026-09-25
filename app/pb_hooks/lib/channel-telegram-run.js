// One run of a Telegram connection (ADR-0016 section 2; E4 plan package 17): getUpdates without
// webhook (the server is not reachable from the internet), only messages of allowed chats become
// inbox entries, each gets the confirmation "Im Eingang gespeichert", and the offset moves only
// after saving (lib/channel-telegram.js). Called by channel-runner.js, which holds the lock and
// cleans errors (the bot token is part of every request URL). CommonJS module, ES5 only, Goja
// runtime only.
'use strict';

var berlin = require(__hooks + '/lib/berlin-time.js');
var telegram = require(__hooks + '/lib/channel-telegram.js');
var rules = require(__hooks + '/lib/connection-rules.js');
var inboxIcs = require(__hooks + '/lib/inbox-ics.js');
var service = require(__hooks + '/lib/inbox-service.js');

var DEFAULT_API = 'https://api.telegram.org';
// Optional: address of a local Telegram Bot API server instead of api.telegram.org.
var API_VARIABLE = 'BYL_TELEGRAM_API_BASE';
// Seconds per request; the job runs every minute.
var TIMEOUT_SECONDS = 20;
var UPDATES_PER_RUN = 100;

function apiBase() {
  var value = String($os.getenv(API_VARIABLE) || '').replace(/^\s+|\s+$/g, '').replace(/\/+$/, '');
  return /^https?:\/\/[^\s\/]+$/i.test(value) ? value : DEFAULT_API;
}

// One Bot API call; returns `result` or throws with status and description of Telegram.
function call(token, method, body) {
  var response = $http.send({
    url: apiBase() + '/bot' + token + '/' + method,
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
    timeout: TIMEOUT_SECONDS
  });
  var json = response.json;
  if (response.statusCode !== 200 || !json || json.ok !== true) {
    var description = json && json.description ? ': ' + json.description : '';
    throw new Error('Telegram antwortet auf ' + method + ' mit HTTP ' + response.statusCode + description);
  }
  return json.result;
}

function settingsOf(record) {
  var raw = record.getString('settings');
  try {
    return raw === '' ? null : JSON.parse(raw);
  } catch (err) {
    return null;
  }
}

/** values.secret is the bot token, values.allowlist the allowed IDs. */
function run(app, record, values) {
  var cursor = parseInt(record.getString('cursor'), 10);
  if (isNaN(cursor) || cursor < 0) {
    cursor = 0;
  }
  var updates = call(values.secret, 'getUpdates', {
    offset: cursor + 1,
    timeout: 0,
    limit: UPDATES_PER_RUN,
    allowed_updates: ['message']
  });
  var owner = record.getString('owner');
  var names = rules.variableNames('telegram', record.getString('secret_env'), settingsOf(record));
  var outcome = telegram.processUpdates(updates, cursor, {
    allowed: telegram.parseAllowlist(values.allowlist),
    allowlistName: names.allowlist,
    berlin: berlin,
    save: function (draft) {
      var draftWithConnection = inboxIcs.toInboxDraft(draft, 'telegram', record.id);
      draftWithConnection.original = '';
      return service.ingest(app, owner, draftWithConnection).kind;
    },
    confirm: function (chatId, messageId) {
      call(values.secret, 'sendMessage', {
        chat_id: chatId,
        text: telegram.CONFIRMATION,
        reply_parameters: { message_id: messageId, allow_sending_without_reply: true }
      });
    }
  });
  return {
    created: outcome.created,
    duplicates: outcome.duplicates,
    skipped: outcome.skipped,
    cursor: String(outcome.cursor),
    hint: outcome.hint,
    error: outcome.error
  };
}

module.exports = {
  API_VARIABLE: API_VARIABLE,
  run: run
};
