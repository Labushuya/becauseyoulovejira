// Value lists of the inbox and of the ticket source (ADR-0014, ADR-0019).
// Pure CommonJS module, ES5 only, no dependencies (Goja runtime and Vitest).
// The lists are written out literally in the migrations 1790201200_create_inbox_items.js and
// 1790201210_tickets_source.js; tests/unit/source.test.mjs keeps them equal.
'use strict';

// Ways into the inbox (inbox_items.channel) and at the same time the values of tickets.source.
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
  'notion'
]);

// Kind of object; steers only presets and the symbol in the inbox, never a ticket type
// (ADR-0012).
var KINDS = Object.freeze(['todo', 'task', 'project_task', 'mail', 'event', 'message', 'link']);

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
