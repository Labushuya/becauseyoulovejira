// Scope, counter key and ticket key helpers (CLAUDE.md section 5, "Scopes und Nummernkreise").
// Pure CommonJS module, ES5 only, no dependencies (Goja runtime and Vitest).
'use strict';

// Key prefix of tickets without a project; reserved as project code (E1 plan OF-14).
var TASK = 'TASK';

var PROJECT_CODE_PATTERN = /^[A-Z]{2,6}$/;

function isNonEmptyString(value) {
  return typeof value === 'string' && value !== '';
}

// Private scope "u:<ownerId>" unless a household is set, then "h:<householdId>".
function scopeOf(owner, household) {
  if (isNonEmptyString(household)) {
    return 'h:' + household;
  }
  if (isNonEmptyString(owner)) {
    return 'u:' + owner;
  }
  throw new Error('scopeOf: owner or household is required');
}

// Counter key "<scope>:<projectId|TASK>".
function counterKey(scope, projectId) {
  if (!isNonEmptyString(scope)) {
    throw new Error('counterKey: scope is required');
  }
  return scope + ':' + (isNonEmptyString(projectId) ? projectId : TASK);
}

// Ticket key "<CODE>-<NR>"; pass TASK as code for tickets without a project.
function formatKey(code, number) {
  if (typeof code !== 'string' || !PROJECT_CODE_PATTERN.test(code)) {
    throw new Error('formatKey: invalid code');
  }
  if (typeof number !== 'number' || number < 1 || Math.floor(number) !== number) {
    throw new Error('formatKey: number must be a positive integer');
  }
  return code + '-' + number;
}

// A project code is 2 to 6 uppercase letters and must not be the reserved TASK.
function isValidProjectCode(code) {
  return typeof code === 'string' && PROJECT_CODE_PATTERN.test(code) && code !== TASK;
}

module.exports = {
  TASK: TASK,
  PROJECT_CODE_PATTERN: PROJECT_CODE_PATTERN,
  scopeOf: scopeOf,
  counterKey: counterKey,
  formatKey: formatKey,
  isValidProjectCode: isValidProjectCode
};
