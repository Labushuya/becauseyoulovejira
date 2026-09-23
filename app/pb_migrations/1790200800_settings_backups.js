/// <reference path="../pb_data/types.d.ts" />
// E1 plan, package 3, step 8 (ADR-0003): automatic backups every four hours (UTC), keep 12.
// Runs once; later changes in the admin UI are not overwritten.
migrate(
  function (app) {
    var settings = app.settings();
    settings.backups.cron = '0 */4 * * *';
    settings.backups.cronMaxKeep = 12;
    app.save(settings);
  },
  function (app) {
    // PocketBase 0.40.4 defaults: automatic backups off, keep 3.
    var settings = app.settings();
    settings.backups.cron = '';
    settings.backups.cronMaxKeep = 3;
    app.save(settings);
  }
);
