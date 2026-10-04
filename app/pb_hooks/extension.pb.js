/// <reference path="../pb_data/types.d.ts" />
// Folder and version of the built browser extension for WhatsApp Web (ADR-0038 §4, plan
// eigener-eingang-whatsapp-web EI-3), for the step "Erweiterung laden" of the assistant. Signed-in
// app users only; the answer holds whether a build is there and, only for the administrator of the
// app in a browser on this machine (KX-1, ADR-0057), the path of the folder on this machine; every
// other account and device gets '' (no path of the server). Handlers run in isolated scopes, so the
// modules are required inside.

routerAdd(
  'GET',
  '/api/byl/whatsapp-web/extension',
  function (e) {
    var rules = require(`${__hooks}/lib/extension-rules.js`);
    var system = require(`${__hooks}/lib/system-service.js`);
    var hooks = $filepath.isAbs(__hooks) ? __hooks : $filepath.join($os.getwd(), __hooks);
    var folder = rules.folderOf(hooks);
    var version = '';
    try {
      version = rules.versionOf(toString($os.readFile($filepath.join(folder, 'manifest.json'))));
    } catch (err) {
      version = '';
    }
    var shown = system.isLocalRequest(e) && system.isAdminRequest(e) ? folder : '';
    return e.json(200, { folder: shown, built: version !== '', version: version });
  },
  $apis.requireAuth('users')
);
