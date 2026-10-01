/// <reference path="../pb_data/types.d.ts" />
// Backups (ADR-0046): a backup a day with generations, a sealed copy in a chosen target folder and
// the page "Einstellungen → Sicherung". Signed-in app users only; lib/backup-service.js checks the
// rest like the page System (Windows, this machine, the address of the app, the owner of the
// instance, rate limit, own instance). Handlers run in isolated scopes, so the module is required
// inside them.

// Every five minutes: a backup when the newest one is a day old (also soon after a start, ADR-0046
// §1), the copy into the target folder when it is missing there. Never throws.
cronAdd('byl-backup', '*/5 * * * *', function () {
  require(`${__hooks}/lib/backup-service.js`).tick($app, Date.now());
});

// Settings, passphrase, target, the backups here and in the target, the last runs and warnings.
routerAdd(
  'GET',
  '/api/byl/backup',
  function (e) {
    return require(`${__hooks}/lib/backup-service.js`).read(e);
  },
  $apis.requireAuth('users')
);

// The warnings for the hint when the app opens (ADR-0035), without the control script.
routerAdd(
  'GET',
  '/api/byl/backup/notice',
  function (e) {
    return require(`${__hooks}/lib/backup-service.js`).notice(e);
  },
  $apis.requireAuth('users')
);

// "Jetzt sichern": a backup now and its sealed copy in the target folder.
routerAdd(
  'POST',
  '/api/byl/backup/run',
  function (e) {
    return require(`${__hooks}/lib/backup-service.js`).runNow(e);
  },
  $apis.requireAuth('users')
);

// Target folder, generations and the switch of the access data: JSON { target, daily, weekly,
// monthly, credentials }.
routerAdd(
  'POST',
  '/api/byl/backup/settings',
  function (e) {
    return require(`${__hooks}/lib/backup-service.js`).saveSettings(e);
  },
  $apis.requireAuth('users')
);

// The passphrase of the sealed backups: JSON { passphrase, confirmation }; never stored here or
// logged, kept with DPAPI by the control script.
routerAdd(
  'POST',
  '/api/byl/backup/passphrase',
  function (e) {
    return require(`${__hooks}/lib/backup-service.js`).savePassphrase(e);
  },
  $apis.requireAuth('users')
);
