/// <reference path="../pb_data/types.d.ts" />
// Channels that fetch in the server (ADR-0016 section 2; E4 plan packages 15 and 17). The logic
// lives in lib/channel-runner.js. Cron expressions are UTC (ADR-0005); the jobs only fetch, so the
// time zone does not matter. Without connections, before their migration or without the
// variables, a job does nothing and never fails.

// Google Calendar every 15 minutes; requests time out after 30 seconds.
cronAdd('byl-calendar', '*/15 * * * *', function () {
  require(`${__hooks}/lib/channel-runner.js`).runAll($app, 'calendar');
});

// Telegram every minute (getUpdates without webhook; Telegram keeps updates for 24 hours).
cronAdd('byl-telegram', '* * * * *', function () {
  require(`${__hooks}/lib/channel-runner.js`).runAll($app, 'telegram');
});

// "Jetzt abrufen": runs one connection at once with the same code as the cron job. Answers with
// the counts or the cleaned error; a connection the request may not see answers 404. A mailbox is
// fetched by the mail helper (testing feedback package A, item 4): the hook asks it on 127.0.0.1
// to run its regular fetch at once; "unavailable" when it does not run.
routerAdd(
  'POST',
  '/api/byl/connections/{id}/run',
  function (e) {
    var record = require(`${__hooks}/lib/connection-service.js`).visibleConnection(e, e.request.pathValue('id'));
    if (!record) {
      throw new NotFoundError();
    }
    if (record.getString('type') === 'mail') {
      return e.json(200, require(`${__hooks}/lib/mailbox-service.js`).runMail(record));
    }
    return e.json(200, require(`${__hooks}/lib/channel-runner.js`).runConnection(e.app, record));
  },
  $apis.requireAuth('users')
);
