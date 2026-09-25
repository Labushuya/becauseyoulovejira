// Access data of the channels (ADR-0018): only the name of a Windows user environment variable is
// stored, never its value. Pure CommonJS module, ES5 only, no dependencies (Goja runtime and
// Vitest); the hooks pass $os.getenv as `getenv`.
'use strict';

// "BYL_" plus capital letters, digits and "_", at most 64 characters (ADR-0018 section 1). The
// pattern keeps a connection from reading any other variable, such as PATH.
var NAME = /^BYL_[A-Z0-9_]{1,60}$/;
var REPLACEMENT = '***';
// Values shorter than this are not replaced inside other text: they would hit ordinary words.
var MIN_SECRET_LENGTH = 4;
var MAX_MESSAGE_LENGTH = 1000;
// scheme://[userinfo@]host[:port][/path][?query][#fragment]
var URL_PATTERN = /\b([a-zA-Z][a-zA-Z0-9+.\-]*):\/\/(?:[^\s\/?#@"'<>]*@)?([^\s\/?#"'<>]*)[^\s"'<>]*/g;
// Bot token of Telegram ("123456789:AA..."), also outside of a URL.
var TELEGRAM_TOKEN = /\b\d{5,}:[A-Za-z0-9_\-]{30,}\b/g;

function text(value) {
  return value === undefined || value === null ? '' : String(value);
}

function isValidName(name) {
  return typeof name === 'string' && NAME.test(name);
}

/**
 * Value of the variable `name`, or '' for an invalid name or an unset variable. The value is
 * trimmed: a trailing space or line break from `setx` must not break a token.
 */
function read(name, getenv) {
  if (!isValidName(name)) {
    return '';
  }
  return text(getenv(name)).replace(/^\s+|\s+$/g, '');
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\\/]/g, '\\$&');
}

/**
 * Error text without secrets, for connections.last_error and the log (ADR-0018 section 5): every
 * value in `secrets` becomes "***" (also URL-encoded), every URL is cut to scheme and host (the
 * iCal address and the Telegram address ".../bot<token>/..." carry the secret in the path),
 * Telegram tokens are replaced anywhere, and the text is cut to 1 000 characters.
 */
function redact(message, secrets) {
  var result = text(message);
  var list = secrets || [];
  for (var i = 0; i < list.length; i++) {
    var secret = text(list[i]);
    if (secret.length < MIN_SECRET_LENGTH) {
      continue;
    }
    var variants = [secret, encodeURIComponent(secret)];
    for (var v = 0; v < variants.length; v++) {
      result = result.replace(new RegExp(escapeRegExp(variants[v]), 'g'), REPLACEMENT);
    }
  }
  result = result.replace(URL_PATTERN, function (match, scheme, host) {
    return scheme.toLowerCase() + '://' + host;
  });
  result = result.replace(TELEGRAM_TOKEN, REPLACEMENT);
  if (result.length > MAX_MESSAGE_LENGTH) {
    result = result.slice(0, MAX_MESSAGE_LENGTH - 1) + '…';
  }
  return result;
}

module.exports = {
  NAME: NAME,
  isValidName: isValidName,
  read: read,
  redact: redact
};
