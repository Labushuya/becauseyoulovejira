/// <reference path="../pb_data/types.d.ts" />
// Test-only mark of the test mode (ADR-0041, ADR-0050). The harness copies this file next to
// app/pb_hooks in every integration test instance; it is never part of the portable app folder.
// Only with this mark do the clients of Notion and GitHub take BYL_TEST_NOTION_PORT and
// BYL_TEST_GITHUB_PORT (fake servers on 127.0.0.1) instead of api.notion.com and api.github.com,
// so a variable of that name in the account of the user changes nothing; with it the cron of GitHub
// rests (tests/fixtures/pb_hooks/github-cron.pb.js runs it on request).
onBootstrap(function (e) {
  e.next();
  e.app.store().set('byl-test-mode', true);
});
