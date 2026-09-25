// Telegram bot, pure part (ADR-0016 section 2, ADR-0020; E4 plan packages 17 and 20). CommonJS
// module, ES5 only (Goja runtime and Vitest): which updates become inbox entries (allowed chat,
// text, a matching keyword), in which order the offset moves and what the bot answers. HTTP and saving are passed in as functions (channel-telegram-run.js),
// so the order "save, then confirm, then move the offset" is testable without a server.
'use strict';

var CONFIRMATION = 'Im Eingang gespeichert';
// Answer to a message without keyword (ADR-0020 section 4), unless the connection switched it off.
var NO_MATCH = 'Kein Stichwort erkannt – nicht gespeichert';
var TITLE_MAX_LENGTH = 200;
var ID = /^-?\d{1,20}$/;

function text(value) {
  return value === undefined || value === null ? '' : String(value);
}

/** Chat and user IDs of the allowlist variable: numbers separated by commas, spaces or ";". */
function parseAllowlist(value) {
  var parts = text(value).split(/[\s,;]+/);
  var ids = [];
  for (var i = 0; i < parts.length; i++) {
    if (ID.test(parts[i]) && ids.indexOf(parts[i]) === -1) {
      ids.push(parts[i]);
    }
  }
  return ids;
}

function idOf(value) {
  return value && value.id !== undefined && value.id !== null ? String(value.id) : '';
}

/** A message counts if its chat or its sender is on the allowlist. */
function isAllowed(message, allowed) {
  var chat = idOf(message.chat);
  var sender = idOf(message.from);
  return (chat !== '' && allowed.indexOf(chat) !== -1) || (sender !== '' && allowed.indexOf(sender) !== -1);
}

/** Text of a message, or the caption of a photo or file; media themselves are not taken. */
function messageText(message) {
  var body = typeof message.text === 'string' ? message.text : typeof message.caption === 'string' ? message.caption : '';
  return body.replace(/^\s+|\s+$/g, '') === '' ? '' : body;
}

function personName(person) {
  if (!person) {
    return '';
  }
  var name = (text(person.first_name) + ' ' + text(person.last_name)).replace(/^\s+|\s+$/g, '');
  if (name !== '') {
    return name;
  }
  return person.username ? '@' + person.username : '';
}

/** Name of a chat: group title, else the name of the person, else the ID. */
function chatName(chat) {
  if (!chat) {
    return '';
  }
  return text(chat.title) || personName(chat) || idOf(chat);
}

function firstLine(body) {
  var lines = body.split(/\r\n|\n|\r/);
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i].replace(/\s+/g, ' ').replace(/^ | $/g, '');
    if (line !== '') {
      return line.length <= TITLE_MAX_LENGTH ? line : line.slice(0, TITLE_MAX_LENGTH - 1) + '…';
    }
  }
  return '(ohne Text)';
}

/**
 * Inbox draft of an allowed message with text (kind "message"). `source_ref` is
 * "<chat_id>:<message_id>", the duplicate key of the hook (ADR-0014 section 3); the matching
 * keyword, if given, goes to `meta.keyword` (ADR-0020 section 4).
 */
function toDraft(message, berlin, keyword) {
  var body = messageText(message);
  var date = typeof message.date === 'number' ? berlin.toPocketBaseDate(message.date * 1000) : '';
  var meta = { chat: chatName(message.chat), sender: personName(message.from), chat_id: idOf(message.chat) };
  if (keyword) {
    meta.keyword = keyword;
  }
  return {
    channel: 'telegram',
    kind: 'message',
    title: firstLine(body),
    body: body,
    source_url: '',
    source_ref: idOf(message.chat) + ':' + text(message.message_id),
    source_date: date,
    meta: meta
  };
}

/** Setup hint for a message from a chat that is not allowed: its IDs, never its text. */
function unknownChatHint(message, allowlistName) {
  var chat = idOf(message.chat);
  var sender = idOf(message.from);
  var name = chatName(message.chat);
  var ids = 'Chat-ID ' + chat + (name !== '' && name !== chat ? ' („' + name + '“)' : '');
  if (sender !== '' && sender !== chat) {
    ids += ', User-ID ' + sender;
  }
  return (
    'Nachricht aus einem nicht freigegebenen Chat (' + ids + '), nicht gespeichert. Zum Freigeben die ID in ' +
    allowlistName + ' aufnehmen (setx), dann stop.bat und start.bat.'
  );
}

/**
 * Processes the updates of getUpdates in the order of their update_id. ctx:
 *   allowed        IDs of the allowlist
 *   allowlistName  name of the allowlist variable (for the hint)
 *   save(draft)    creates the entry: 'created' or 'duplicate'; throws if it cannot be saved
 *   confirm(chatId, messageId)  sends "Im Eingang gespeichert"; throws on failure
 *   match(text)    the keyword of the connection that matches the text, or ''
 *   replyNoMatch   whether a message without keyword gets the answer NO_MATCH
 *   decline(chatId, messageId)  sends NO_MATCH; throws on failure
 *   berlin         berlin-time.js
 * The offset (`cursor`, the last handled update_id) moves past an update only when it is done:
 * saved, a duplicate, not allowed, without text or without keyword (not saved at all, ADR-0020).
 * A failed save stops the run and leaves the offset before that update, so Telegram offers it
 * again. A failed confirmation or answer keeps the offset and is reported. Returns { cursor,
 * created, duplicates, skipped, unmatched, hint, error }; `hint` is undefined if no unknown chat
 * wrote.
 */
function processUpdates(updates, cursor, ctx) {
  var result = { cursor: cursor, created: 0, duplicates: 0, skipped: 0, unmatched: 0, hint: undefined, error: '' };
  var list = (updates || []).slice().sort(function (a, b) {
    return a.update_id - b.update_id;
  });
  var confirmErrors = [];
  var declineErrors = [];
  for (var i = 0; i < list.length; i++) {
    var update = list[i];
    var id = update && typeof update.update_id === 'number' ? update.update_id : NaN;
    if (isNaN(id) || id <= result.cursor) {
      continue;
    }
    var message = update.message;
    if (!message || !message.chat) {
      result.skipped++;
      result.cursor = id;
      continue;
    }
    if (!isAllowed(message, ctx.allowed)) {
      result.hint = unknownChatHint(message, ctx.allowlistName);
      result.skipped++;
      result.cursor = id;
      continue;
    }
    if (messageText(message) === '') {
      result.skipped++;
      result.cursor = id;
      continue;
    }
    var keyword = ctx.match(messageText(message));
    if (keyword === '') {
      result.unmatched++;
      if (ctx.replyNoMatch) {
        try {
          ctx.decline(message.chat.id, message.message_id);
        } catch (err) {
          declineErrors.push(text(err && err.message ? err.message : err));
        }
      }
      result.cursor = id;
      continue;
    }
    var saved;
    try {
      saved = ctx.save(toDraft(message, ctx.berlin, keyword));
    } catch (err) {
      result.error = 'Nachricht ' + id + ' ließ sich nicht speichern und wird beim nächsten Abruf erneut versucht: ' + text(err && err.message ? err.message : err);
      break;
    }
    if (saved === 'created') {
      result.created++;
      try {
        ctx.confirm(message.chat.id, message.message_id);
      } catch (err) {
        confirmErrors.push(text(err && err.message ? err.message : err));
      }
    } else {
      result.duplicates++;
    }
    result.cursor = id;
  }
  if (result.error === '') {
    var problems = [];
    if (confirmErrors.length > 0) {
      problems.push(
        'Gespeichert, aber die Bestätigung „' + CONFIRMATION + '“ ging nicht raus (' + confirmErrors.length + '×): ' + confirmErrors[0]
      );
    }
    if (declineErrors.length > 0) {
      problems.push('Die Antwort „' + NO_MATCH + '“ ging nicht raus (' + declineErrors.length + '×): ' + declineErrors[0]);
    }
    result.error = problems.join(' ');
  }
  return result;
}

module.exports = {
  CONFIRMATION: CONFIRMATION,
  NO_MATCH: NO_MATCH,
  parseAllowlist: parseAllowlist,
  isAllowed: isAllowed,
  messageText: messageText,
  chatName: chatName,
  toDraft: toDraft,
  unknownChatHint: unknownChatHint,
  processUpdates: processUpdates
};
