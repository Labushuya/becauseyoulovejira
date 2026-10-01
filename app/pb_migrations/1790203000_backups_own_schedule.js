/// <reference path="../pb_data/types.d.ts" />
// ADR-0046 §1: the backups of the app (lib/backup-service.js, a backup a day with generations)
// replace the automatic backup of PocketBase (ADR-0003 §2, migration 1790200800), so no backup runs
// twice. Up switches it off, but only while it has the schedule of 1790200800; a schedule set in
// the admin UI stays. Its ZIP files (@auto_pb_backup_*) stay in pb_data/backups until deleted there.
// Down brings the schedule of ADR-0003 back, again only if nobody set another one.
var SCHEDULE_OF_ADR_0003 = '0 */4 * * *';

migrate(
  function (app) {
    var settings = app.settings();
    if (settings.backups.cron === SCHEDULE_OF_ADR_0003) {
      settings.backups.cron = '';
      app.save(settings);
    }
  },
  function (app) {
    var settings = app.settings();
    if (settings.backups.cron === '') {
      settings.backups.cron = SCHEDULE_OF_ADR_0003;
      settings.backups.cronMaxKeep = 12;
      app.save(settings);
    }
  }
);
