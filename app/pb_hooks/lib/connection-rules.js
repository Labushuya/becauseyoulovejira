// Pure rules of the connections (ADR-0016 section 2, ADR-0018, ADR-0020; E4 plan packages 10 and
// 20). CommonJS module, ES5 only, no dependencies but secrets.js, keywords.js and, for GitHub and
// folders, the rules of their settings, which the caller passes in (Goja runtime and Vitest load
// the module the same way).
'use strict';

// Written by the server only (runner and hooks); a client change is refused. scan (JSON, state of
// the full scan of an inbox, ADR-0020 addendum 3) arrives as its JSON text, "null" when empty;
// watch (JSON, hidden: what the GitHub channel knows of its repositories, ADR-0050, and the folder
// channel of its folders, ADR-0051) the same way.
var SERVER_FIELDS = ['cursor', 'last_run_at', 'last_ok_at', 'last_error', 'last_hint', 'running_since', 'scan', 'watch'];

// Kinds a user can set up. Notion only imports lists on request (ADR-0041, since NI-2); GitHub
// watches repositories read only (ADR-0050, since GH-2), folders of this machine too (ADR-0051,
// since OD-2).
var CREATABLE_TYPES = ['calendar', 'telegram', 'mail', 'notion', 'github', 'folder'];

// Kinds that also run without their secret: GitHub reads public repositories without a token
// (ADR-0050 §1, 60 requests per hour); folders on this machine need none at all.
var SECRET_OPTIONAL_TYPES = ['github', 'folder'];

// Kinds without access data: `secret_env` stays empty (migration 1790203300 makes it optional).
// Folders are read by the server itself (ADR-0051 §1).
var SECRETLESS_TYPES = ['folder'];

// Mail providers (ADR-0016 section 4): host, port and TLS follow from the provider in the mail
// helper; the connection stores only the provider and the user name (E4 plan packages 11, 13 and 22).
var MAIL_PROVIDERS = ['webde', 'gmail'];
var MAIL_USER_MAX_LENGTH = 254;

// Name of a connection (`label`, max 100 since the migration 1790201400). Renaming changes only
// the name (ADR-0026, addendum KK-3; ADR-0016, addendum of 2026-10-01): a client request that
// changes `label` must leave these fields and the server fields as they are. `settings_json` is
// the stored JSON text of `settings`, so a rewritten value with the same content counts as a change.
// The target project (ADR-0049) is a setting of its own and stays as well.
var LABEL_MAX_LENGTH = 100;
var RENAME_KEEPS = ['type', 'enabled', 'secret_env', 'settings_json', 'owner', 'household', 'target_project'];

// Keys of `settings` per kind. Only names of variables, never values (ADR-0018 section 2), the
// keywords (ADR-0020 section 3) and, for Telegram, the two answers of the bot in the chat: the
// confirmation of a saved entry and the hint for a message without keyword (ADR-0016, addendum of
// 2026-10-01). Notion has none: the user chooses what to import, so no keyword applies (ADR-0041 §5).
// GitHub has the interval of its runs and its repositories with watched paths, events and target
// project; no keywords: the chosen paths and events are the filter (ADR-0050 §8, ADR-0020 addendum 5).
// Since the addendum of 2026-10-02 to ADR-0050 also "Alle meine Repositorys" and its exclusions.
// Folders the same with the interval and the folders with their filters (ADR-0051 §8).
var SETTINGS_KEYS = {
  calendar: ['keywords'],
  telegram: ['allowed_env', 'keywords', 'reply_saved', 'reply_no_match'],
  mail: ['provider', 'user', 'keywords', 'match_body'],
  notion: [],
  github: ['interval', 'repos', 'auto', 'exclude'],
  folder: ['interval', 'folders']
};

var MESSAGES = {
  validation_connection_type: 'Diese Verbindungsart gibt es noch nicht.',
  validation_connection_immutable: 'Die Art einer Verbindung lässt sich nicht ändern.',
  validation_connection_server_field: 'Dieses Feld setzt nur der Server.',
  validation_connection_settings: 'Unbekannte Einstellung.',
  validation_secret_name: 'Nur BYL_ mit Großbuchstaben, Ziffern und _ (höchstens 64 Zeichen).',
  validation_mail_provider: 'Diesen Mail-Anbieter gibt es nicht.',
  validation_mail_user: 'Benutzername des Postfachs (meist die E-Mail-Adresse), ohne Leerzeichen, höchstens 254 Zeichen.',
  validation_connection_label: 'Bitte einen Namen eingeben.',
  validation_connection_label_max: 'Höchstens 100 Zeichen.',
  validation_connection_rename_only: 'Beim Umbenennen ändert sich nur der Name; andere Einstellungen bitte getrennt speichern.',
  validation_connection_secret_none: 'Diese Verbindungsart braucht keine Zugangsdaten.',
  validation_connection_admin_only: 'Kanäle mit Zugangsdaten und Ordner richtet nur der Verwalter der App ein.',
  validation_connection_private_only: 'Verbindungen gibt es nur im privaten Bereich.'
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

// A switch of the settings: missing (the default applies) or true or false.
function isOptionalSwitch(value) {
  return value === undefined || typeof value === 'boolean';
}

/**
 * Checks `settings` of a connection of `type`. `settings` is the parsed JSON (null for empty).
 * `github` is github-rules.js, which checks the repositories of a GitHub connection; without it a
 * GitHub connection takes no settings. `folder` checks the folders of a folder connection
 * ({ settingsViolation(value) } for the platform of the server, folder-service.settingsRules);
 * without it a folder connection takes no settings. Returns '' or { field, code, message }.
 */
function settingsViolation(type, settings, secrets, keywords, github, folder) {
  var value = settings === null || settings === undefined || settings === '' ? {} : settings;
  if (type === 'github') {
    return github ? github.settingsViolation(value) : failure('settings', 'validation_connection_settings');
  }
  if (type === 'folder') {
    return folder ? folder.settingsViolation(value) : failure('settings', 'validation_connection_settings');
  }
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
  if (!isOptionalSwitch(value.reply_saved) || !isOptionalSwitch(value.reply_no_match)) {
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
 * The name of the variable of a connection: a valid BYL_ name, empty for a kind without access
 * data (folders). '' or { field, code, message }.
 */
function secretViolation(type, secretEnv, secrets) {
  if (SECRETLESS_TYPES.indexOf(type) !== -1) {
    return text(secretEnv) === '' ? '' : failure('secret_env', 'validation_connection_secret_none');
  }
  return secrets.isValidName(secretEnv) ? '' : failure('secret_env', 'validation_secret_name');
}

/**
 * Client create (onRecordCreateRequest): the kind must be available, the server fields empty and
 * the settings valid. `values` maps field names to their string value (settings parsed); `github`
 * and `folder` as for settingsViolation.
 */
function createViolation(values, secrets, keywords, github, folder) {
  if (CREATABLE_TYPES.indexOf(text(values.type)) === -1) {
    return failure('type', 'validation_connection_type');
  }
  for (var i = 0; i < SERVER_FIELDS.length; i++) {
    if (text(values[SERVER_FIELDS[i]]) !== '') {
      return failure(SERVER_FIELDS[i], 'validation_connection_server_field');
    }
  }
  return (
    secretViolation(text(values.type), values.secret_env, secrets) ||
    settingsViolation(text(values.type), values.settings, secrets, keywords, github, folder)
  );
}

/**
 * Client update (onRecordUpdateRequest): kind and server fields unchanged, settings valid.
 * `before`/`after` like `values` of createViolation.
 */
function updateViolation(before, after, secrets, keywords, github, folder) {
  if (text(before.type) !== text(after.type)) {
    return failure('type', 'validation_connection_immutable');
  }
  for (var i = 0; i < SERVER_FIELDS.length; i++) {
    var field = SERVER_FIELDS[i];
    if (text(before[field]) !== text(after[field])) {
      return failure(field, 'validation_connection_server_field');
    }
  }
  return (
    secretViolation(text(after.type), after.secret_env, secrets) ||
    settingsViolation(text(after.type), after.settings, secrets, keywords, github, folder)
  );
}

/**
 * Whether a connection reaches into the server machine (ADR-0056 §5): it names a variable of the
 * server (`secret_env`, the allowlist of Telegram) or watches its folders. `values` like those of
 * createViolation.
 */
function usesServerAccess(values) {
  if (text(values.type) === 'folder' || text(values.secret_env) !== '') {
    return true;
  }
  return text(values.type) === 'telegram' && isPlainObject(values.settings) && text(values.settings.allowed_env) !== '';
}

/**
 * Client create or update by an app account that is not the administrator of the app (ADR-0056 §5):
 * only the administrator sets up or changes connections with access data or folders, so no other
 * account reads the variables of the server or its folders. `before` is null for a create.
 */
function adminViolation(isAdmin, before, after) {
  if (isAdmin) {
    return '';
  }
  if (usesServerAccess(after) || (before !== null && usesServerAccess(before))) {
    return failure('type', 'validation_connection_admin_only');
  }
  return '';
}

/**
 * Client create by an app account (E7-3, ADR-0059 §5): a connection is never set up in a household.
 * Every kind runs in the server, with its variables (BYL_*), its folders or its own requests on a
 * schedule (GitHub without token); the E7 plan §4 keeps connections with access to the server
 * private. Their entries and tickets may still be handled in the private area.
 */
function areaViolation(values) {
  return text(values.household) !== '' ? failure('household', 'validation_connection_private_only') : '';
}

/** Whether a connection of `type` runs only with its secret (GitHub reads public repositories without, folders need none). */
function requiresSecret(type) {
  return SECRET_OPTIONAL_TYPES.indexOf(type) === -1;
}

/** The name as it is stored: without white space at its ends. */
function normalizeLabel(label) {
  return text(label).replace(/^\s+|\s+$/g, '');
}

/** The name of a connection: not empty after trimming, at most LABEL_MAX_LENGTH characters. */
function labelViolation(label) {
  var value = normalizeLabel(label);
  if (value === '') {
    return failure('label', 'validation_connection_label');
  }
  if (value.length > LABEL_MAX_LENGTH) {
    return failure('label', 'validation_connection_label_max');
  }
  return '';
}

/**
 * Client update that changes the name: nothing else may change with it (fetching, access data,
 * keywords, cursor and the rest stay as they are). `before`/`after` like `values` of
 * updateViolation, with `label` and the fields of RENAME_KEEPS as strings.
 */
function renameViolation(before, after) {
  if (text(before.label) === text(after.label)) {
    return '';
  }
  var fields = RENAME_KEEPS.concat(SERVER_FIELDS);
  for (var i = 0; i < fields.length; i++) {
    if (text(before[fields[i]]) !== text(after[fields[i]])) {
      return failure(fields[i] === 'settings_json' ? 'settings' : fields[i], 'validation_connection_rename_only');
    }
  }
  return '';
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

/**
 * Telegram: whether the bot confirms a saved entry in the chat (default yes; a connection from
 * before the switch has no value and confirms, ADR-0016, addendum of 2026-10-01).
 */
function repliesOnSave(settings) {
  return !(isPlainObject(settings) && settings.reply_saved === false);
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
  SECRET_OPTIONAL_TYPES: SECRET_OPTIONAL_TYPES,
  SECRETLESS_TYPES: SECRETLESS_TYPES,
  MAIL_PROVIDERS: MAIL_PROVIDERS,
  MAIL_USER_MAX_LENGTH: MAIL_USER_MAX_LENGTH,
  LABEL_MAX_LENGTH: LABEL_MAX_LENGTH,
  RENAME_KEEPS: RENAME_KEEPS,
  MESSAGES: MESSAGES,
  settingsViolation: settingsViolation,
  secretViolation: secretViolation,
  createViolation: createViolation,
  updateViolation: updateViolation,
  usesServerAccess: usesServerAccess,
  adminViolation: adminViolation,
  areaViolation: areaViolation,
  requiresSecret: requiresSecret,
  normalizeLabel: normalizeLabel,
  labelViolation: labelViolation,
  renameViolation: renameViolation,
  variableNames: variableNames,
  secretStatus: secretStatus,
  keywordsOf: keywordsOf,
  isMailUser: isMailUser,
  mailSettingsOf: mailSettingsOf,
  sourceIdentity: sourceIdentity,
  repliesOnSave: repliesOnSave,
  repliesWithoutMatch: repliesWithoutMatch
};
