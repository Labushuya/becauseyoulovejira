// Pure rules of the connections (ADR-0016 section 2, ADR-0018; E4 plan package 10). CommonJS
// module, ES5 only, no dependencies but secrets.js, which the caller passes in (Goja runtime and
// Vitest load the module the same way).
'use strict';

// Written by the server only (runner and hooks); a client change is refused.
var SERVER_FIELDS = ['cursor', 'last_run_at', 'last_ok_at', 'last_error', 'last_hint', 'running_since'];

// Kinds a user can set up now; notion and mail stay in the value list for later packages.
var CREATABLE_TYPES = ['calendar', 'telegram'];

// Keys of `settings` per kind. Only names of variables, never values (ADR-0018 section 2).
var SETTINGS_KEYS = {
  calendar: [],
  telegram: ['allowed_env']
};

var MESSAGES = {
  validation_connection_type: 'Diese Verbindungsart gibt es noch nicht.',
  validation_connection_immutable: 'Die Art einer Verbindung lässt sich nicht ändern.',
  validation_connection_server_field: 'Dieses Feld setzt nur der Server.',
  validation_connection_settings: 'Unbekannte Einstellung.',
  validation_secret_name: 'Nur BYL_ mit Großbuchstaben, Ziffern und _ (höchstens 64 Zeichen).'
};

function text(value) {
  return value === undefined || value === null ? '' : String(value);
}

function failure(field, code) {
  return { field: field, code: code, message: MESSAGES[code] };
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && Object.prototype.toString.call(value) === '[object Object]';
}

/**
 * Checks `settings` of a connection of `type`. `settings` is the parsed JSON (null for empty).
 * Returns '' or { field, code, message }.
 */
function settingsViolation(type, settings, secrets) {
  var value = settings === null || settings === undefined || settings === '' ? {} : settings;
  if (!isPlainObject(value)) {
    return failure('settings', 'validation_connection_settings');
  }
  var allowed = SETTINGS_KEYS[type] || [];
  for (var key in value) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) {
      continue;
    }
    if (allowed.indexOf(key) === -1) {
      return failure('settings', 'validation_connection_settings');
    }
  }
  if (type === 'telegram' && !secrets.isValidName(value.allowed_env)) {
    return failure('settings', 'validation_secret_name');
  }
  return '';
}

/**
 * Client create (onRecordCreateRequest): the kind must be available, the server fields empty and
 * the settings valid. `values` maps field names to their string value (settings parsed).
 */
function createViolation(values, secrets) {
  if (CREATABLE_TYPES.indexOf(text(values.type)) === -1) {
    return failure('type', 'validation_connection_type');
  }
  for (var i = 0; i < SERVER_FIELDS.length; i++) {
    if (text(values[SERVER_FIELDS[i]]) !== '') {
      return failure(SERVER_FIELDS[i], 'validation_connection_server_field');
    }
  }
  if (!secrets.isValidName(values.secret_env)) {
    return failure('secret_env', 'validation_secret_name');
  }
  return settingsViolation(text(values.type), values.settings, secrets);
}

/**
 * Client update (onRecordUpdateRequest): kind and server fields unchanged, settings valid.
 * `before`/`after` like `values` of createViolation.
 */
function updateViolation(before, after, secrets) {
  if (text(before.type) !== text(after.type)) {
    return failure('type', 'validation_connection_immutable');
  }
  for (var i = 0; i < SERVER_FIELDS.length; i++) {
    var field = SERVER_FIELDS[i];
    if (text(before[field]) !== text(after[field])) {
      return failure(field, 'validation_connection_server_field');
    }
  }
  if (!secrets.isValidName(after.secret_env)) {
    return failure('secret_env', 'validation_secret_name');
  }
  return settingsViolation(text(after.type), after.settings, secrets);
}

/** Names of the variables a connection reads: the secret and, for Telegram, the allowlist. */
function variableNames(type, secretEnv, settings) {
  var names = { secret: text(secretEnv), allowlist: '' };
  if (type === 'telegram' && isPlainObject(settings)) {
    names.allowlist = text(settings.allowed_env);
  }
  return names;
}

/**
 * Only yes or no per variable, never a value (ADR-0018 section 4): { secret, allowlist } with
 * allowlist null for kinds without one.
 */
function secretStatus(type, secretEnv, settings, secrets, getenv) {
  var names = variableNames(type, secretEnv, settings);
  return {
    secret: secrets.read(names.secret, getenv) !== '',
    allowlist: type === 'telegram' ? secrets.read(names.allowlist, getenv) !== '' : null
  };
}

module.exports = {
  SERVER_FIELDS: SERVER_FIELDS,
  CREATABLE_TYPES: CREATABLE_TYPES,
  MESSAGES: MESSAGES,
  settingsViolation: settingsViolation,
  createViolation: createViolation,
  updateViolation: updateViolation,
  variableNames: variableNames,
  secretStatus: secretStatus
};
