// Ticket status and priority enums (CLAUDE.md section 5).
// Pure CommonJS module, ES5 only, no dependencies (Goja runtime and Vitest).
// Mirrored in web/src/lib/domain/status.ts; tests/unit/status.test.mjs keeps both in sync.
'use strict';

var STATUSES = Object.freeze(['backlog', 'open', 'in_progress', 'waiting', 'done']);

var PRIORITIES = Object.freeze(['low', 'medium', 'high', 'urgent']);

// Internal categories: backlog/open -> open ("offen"), in_progress/waiting -> active ("aktiv"),
// done -> closed ("abgeschlossen").
var CATEGORIES = Object.freeze(['open', 'active', 'closed']);

var STATUS_CATEGORY = Object.freeze({
  backlog: 'open',
  open: 'open',
  in_progress: 'active',
  waiting: 'active',
  done: 'closed'
});

function isStatus(value) {
  return STATUSES.indexOf(value) !== -1;
}

function isPriority(value) {
  return PRIORITIES.indexOf(value) !== -1;
}

// Returns the category of a status, or null for unknown values.
function categoryOf(status) {
  return isStatus(status) ? STATUS_CATEGORY[status] : null;
}

function isDone(status) {
  return status === 'done';
}

module.exports = {
  STATUSES: STATUSES,
  PRIORITIES: PRIORITIES,
  CATEGORIES: CATEGORIES,
  STATUS_CATEGORY: STATUS_CATEGORY,
  isStatus: isStatus,
  isPriority: isPriority,
  categoryOf: categoryOf,
  isDone: isDone
};
