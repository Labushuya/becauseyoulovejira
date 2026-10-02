// Value lists of the inbox and of the ticket source (ADR-0014, ADR-0019).
// Pure CommonJS module, ES5 only, no dependencies (Goja runtime and Vitest).
// The lists are written out literally in the migrations 1790201200_create_inbox_items.js and
// 1790201210_tickets_source.js (since 1790202400_inbox_keys.js with "api" and "whatsapp-web",
// since 1790203200_github_channel.js with "github" and the kinds of its entries);
// tests/unit/source.test.mjs keeps them equal.
'use strict';

// Ways into the inbox (inbox_items.channel) and at the same time the values of tickets.source.
// "api" and "whatsapp-web" come through the own inbox with an access key (ADR-0038).
var CHANNELS = Object.freeze([
  'manual',
  'quick',
  'clipboard',
  'link',
  'eml',
  'mail',
  'ics',
  'calendar',
  'whatsapp',
  'telegram',
  'notion',
  'api',
  'whatsapp-web',
  // Watched repositories on GitHub, read only (ADR-0050).
  'github'
]);

// Kind of object; steers only presets and the symbol in the inbox, never a ticket type
// (ADR-0012). "change", "pull_request" and "release" are the entries of the GitHub channel: a
// watched file changed, a pull request, a release (ADR-0050).
var KINDS = Object.freeze([
  'todo',
  'task',
  'project_task',
  'mail',
  'event',
  'message',
  'link',
  'change',
  'pull_request',
  'release'
]);

var STATES = Object.freeze(['new', 'converted', 'discarded']);

// Sources a client may set on a ticket it creates directly, without an inbox item
// (ADR-0014 section 2). An empty source is allowed as well (tickets before E4).
var CLIENT_TICKET_SOURCES = Object.freeze(['manual', 'quick']);

function isChannel(value) {
  return CHANNELS.indexOf(value) !== -1;
}

function isClientTicketSource(value) {
  return value === '' || CLIENT_TICKET_SOURCES.indexOf(value) !== -1;
}

module.exports = {
  CHANNELS: CHANNELS,
  KINDS: KINDS,
  STATES: STATES,
  CLIENT_TICKET_SOURCES: CLIENT_TICKET_SOURCES,
  isChannel: isChannel,
  isClientTicketSource: isClientTicketSource
};
