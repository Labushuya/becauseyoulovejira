// Where the browser extension for WhatsApp Web lies (ADR-0038 §4, plan eigener-eingang-whatsapp-
// web EI-3): the build of extensions/whatsapp-web goes to the folder erweiterung-whatsapp-web next
// to pb_hooks in the app folder, and the assistant names it for "Entpackte Erweiterung laden".
// Pure CommonJS module, ES5 only, no dependencies.
'use strict';

var FOLDER = 'erweiterung-whatsapp-web';
var VERSION = /^\d{1,4}(\.\d{1,5}){0,3}$/;

/**
 * The folder of the extension for the hooks folder `hooksDir` (absolute, "\" on Windows, "/"
 * elsewhere): its parent folder plus FOLDER. '' for an empty path.
 */
function folderOf(hooksDir) {
  var path = String(hooksDir || '').replace(/[\\/]+$/, '');
  if (path === '') {
    return '';
  }
  var separator = path.indexOf('\\') !== -1 ? '\\' : '/';
  var cut = Math.max(path.lastIndexOf('\\'), path.lastIndexOf('/'));
  var parent = cut === -1 ? '.' : path.slice(0, cut);
  if (parent === '' || /^[A-Za-z]:$/.test(parent)) {
    parent += separator;
  }
  return parent + (/[\\/]$/.test(parent) ? '' : separator) + FOLDER;
}

/** The version of the built manifest.json text, '' when it is missing or not an extension build. */
function versionOf(manifestText) {
  var value;
  try {
    value = JSON.parse(String(manifestText || ''));
  } catch (err) {
    return '';
  }
  if (!value || typeof value !== 'object' || value.manifest_version !== 3 || typeof value.version !== 'string') {
    return '';
  }
  return VERSION.test(value.version) ? value.version : '';
}

module.exports = {
  FOLDER: FOLDER,
  folderOf: folderOf,
  versionOf: versionOf
};
