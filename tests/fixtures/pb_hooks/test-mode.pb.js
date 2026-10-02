/// <reference path="../pb_data/types.d.ts" />
// Test-only mark of the test mode (ADR-0041, ADR-0050, ADR-0051). The harness copies this file next
// to app/pb_hooks in every integration test instance; it is never part of the portable app folder.
// Only with this mark do the clients of Notion and GitHub take BYL_TEST_NOTION_PORT and
// BYL_TEST_GITHUB_PORT (fake servers on 127.0.0.1) instead of api.notion.com and api.github.com,
// so a variable of that name in the account of the user changes nothing; with it the crons of
// GitHub and of the folders rest (tests/fixtures/pb_hooks/github-cron.pb.js and folder-cron.pb.js
// run them on request), and the folder channel takes smaller limits from BYL_TEST_FOLDER_LIMITS.
onBootstrap(function (e) {
  e.next();
  e.app.store().set('byl-test-mode', true);
});
