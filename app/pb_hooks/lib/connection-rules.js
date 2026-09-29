// Pure rules of the connections (ADR-0016 section 2, ADR-0018, ADR-0020; E4 plan packages 10 and
// 20). CommonJS module, ES5 only, no dependencies but secrets.js and keywords.js, which the caller
// passes in (Goja runtime and Vitest load the module the same way).
'use strict';

// Written by the server only (runner and hooks); a client change is refused. scan (JSON, state of
// the full scan of an inbox, ADR-0020 addendum 3) arrives as its JSON text, "null" when empty.
var SERVER_FIELDS = ['cursor', 'last_run_at', 'last_ok_at', 'last_error', 'last_hint', 'running_since', 'scan'];

// Kinds a user can set up. Notion only imports lists on request (ADR-0041, since NI-2).
var CREATABLE_TYPES = ['calendar', 'telegram', 'mail', 'notion'];

// Mail providers (ADR-0016 section 4): host, port and TLS follow from the provider in the mail
// helper; the connection stores only the provider and the user name (E4 plan packages 11, 13 and 22).
var MAIL_PROVIDERS = ['webde', 'gmail'];
var MAIL_USER_MAX_LENGTH = 254;

// Keys of `settings` per kind. Only names of variables, never values (ADR-0018 section 2), the
// keywords (ADR-0020 section 3) and, for Telegram, whether the bot answers messages without one.
// Notion has none: the user chooses what to import, so no keyword applies (ADR-0041 §5).
var SETTINGS_KEYS = {
  calendar: ['keywords'],
  telegram: ['allowed_env', 'keywords', 'reply_no_match'],
  mail: ['provider', 'user', 'keywords', 'match_body'],
  notion: []
};

var MESSAGES = {
  validation_connection_type: 'Diese Verbindungsart gibt es noch nicht.',
  validation_connection_immutable: 'Die Art einer Verbindung lässt sich nicht ändern.',
  validation_connection_server_field: 'Dieses Feld setzt nur der Server.',
  validation_connection_settings: 'Unbekannte Einstellung.',
  validation_secret_name: 'Nur BYL_ mit Großbuchstaben, Ziffern und _ (höchstens 64 Zeichen).',
  validation_mail_provider: 'Diesen Mail-Anbieter gibt es nicht.',
  validation_mail_user: 'Benutzername des Postfachs (meist die E-Mail-Adresse), ohne Leerzeichen, höchstens 254 Zeichen.'
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
function settingsViolation(type, settings, secrets, keywords) {
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
  if (keywords.listViolation(value.keywords) !== '') {
    return { field: 'settings', code: 'validation_keywords', message: keywords.MESSAGE };
  }
  if (value.reply_no_match !== undefined && typeof value.reply_no_match !== 'boolean') {
    return failure('settings', 'validation_connection_settings');
  }
  if (type === 'telegram' && !secrets.isValidName(value.allowed_env)) {
    return failure('settings', 'validation_secret_name');
  }
  if (type === 'mail') {
    return mailSettingsViolation(value);
  }
  return '';
}

/** A user name of a mailbox: 1 to 254 characters without white space or control characters. */
function isMailUser(value) {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= MAIL_USER_MAX_LENGTH &&
    !/[\s\u0000-\u001f\u007f]/.test(value)
  );
}

function mailSettingsViolation(value) {
  if (MAIL_PROVIDERS.indexOf(value.provider) === -1) {
    return failure('settings', 'validation_mail_provider');
  }
  if (!isMailUser(value.user)) {
    return failure('settings', 'validation_mail_user');
  }
  if (value.match_body !== undefined && typeof value.match_body !== 'boolean') {
    return failure('settings', 'validation_connection_settings');
  }
  return '';
}

/**
 * { provider, user, matchBody } of a mail connection; missing or invalid values read as '' and
 * false (the hook refuses them on save, so this only matters for repaired records).
 */
function mailSettingsOf(settings) {
  var value = isPlainObject(settings) ? settings : {};
  return {
    provider: MAIL_PROVIDERS.indexOf(value.provider) === -1 ? '' : value.provider,
    user: isMailUser(value.user) ? value.user : '',
    matchBody: value.match_body === true
  };
}

/**
 * Client create (onRecordCreateRequest): the kind must be available, the server fields empty and
 * the settings valid. `values` maps field names to their string value (settings parsed).
 */
function createViolation(values, secrets, keywords) {
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
  return settingsViolation(text(values.type), values.settings, secrets, keywords);
}

/**
 * Client update (onRecordUpdateRequest): kind and server fields unchanged, settings valid.
 * `before`/`after` like `values` of createViolation.
 */
function updateViolation(before, after, secrets, keywords) {
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
  return settingsViolation(text(after.type), after.settings, secrets, keywords);
}

/** The keywords of a connection (ADR-0020): invalid or missing entries count as none. */
function keywordsOf(settings, keywords) {
  return isPlainObject(settings) ? keywords.listOf(settings.keywords) : [];
}

/**
 * What a connection reads from: the variables and, for mail, the mailbox. When it changes, the
 * cursor, the error and the hint of the old source no longer apply.
 */
function sourceIdentity(type, secretEnv, settings) {
  var names = variableNames(type, secretEnv, settings);
  var parts = [names.secret, names.allowlist];
  if (type === 'mail') {
    var mail = mailSettingsOf(settings);
    parts.push(mail.provider, mail.user.toLowerCase());
  }
  return parts.join('\n');
}

/** Telegram: whether the bot answers a message without keyword (default yes). */
function repliesWithoutMatch(settings) {
  return !(isPlainObject(settings) && settings.reply_no_match === false);
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
  MAIL_PROVIDERS: MAIL_PROVIDERS,
  MAIL_USER_MAX_LENGTH: MAIL_USER_MAX_LENGTH,
  MESSAGES: MESSAGES,
  settingsViolation: settingsViolation,
  createViolation: createViolation,
  updateViolation: updateViolation,
  variableNames: variableNames,
  secretStatus: secretStatus,
  keywordsOf: keywordsOf,
  isMailUser: isMailUser,
  mailSettingsOf: mailSettingsOf,
  sourceIdentity: sourceIdentity,
  repliesWithoutMatch: repliesWithoutMatch
};
