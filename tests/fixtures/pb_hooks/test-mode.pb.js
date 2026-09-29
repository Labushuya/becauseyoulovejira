/// <reference path="../pb_data/types.d.ts" />
// Test-only mark of the test mode (ADR-0041). The harness copies this file next to app/pb_hooks in
// every integration test instance; it is never part of the portable app folder. Only with this
// mark does the Notion client take BYL_TEST_NOTION_PORT (a fake server on 127.0.0.1) instead of
// api.notion.com, so a variable of that name in the account of the user changes nothing.
onBootstrap(function (e) {
  e.next();
  e.app.store().set('byl-test-mode', true);
});
