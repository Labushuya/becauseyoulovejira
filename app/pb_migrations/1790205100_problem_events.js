/// <reference path="../pb_data/types.d.ts" />
// The error log of the server (FP-2, ADR-0077). Additive: one new, empty collection, no seed data, no
// row of another collection changes.
//
// - problem_events: one row per failure, the same failure again counts on it (count, last_at). source
//   (`request` an unexpected 5xx of a request, `channel` a failed run of a channel, `job` another job),
//   area (`private` only the owner, `household` the members of the household, `system` the
//   administrator of the app), owner (only in the private area) and household (only in its area),
//   both with cascade, code, message (cleaned, at most 300 characters), context (JSON with the keys of
//   lib/problem-rules.js only: connection, channel, rule, job, method, route without query, status),
//   fingerprint (SHA-256 of what makes the failure the same, hidden, unique), count, first_at and
//   last_at. Only lib/problem-service.js writes it (create, update and delete are null, so only the
//   hooks and superusers); list and view show an entry of the private area to its owner alone, also
//   not to the administrator of the app. The cron byl-problem-events-cleanup and every new row remove
//   rows older than 30 days (by last_at) and beyond the newest 5000.
//
// Down: the collection and its rows go.
var VISIBLE =
  '@request.auth.id != "" && (' +
  '(area = "private" && owner = @request.auth.id) || ' +
  '(area = "household" && household != "" && @collection.household_members.household ?= household && ' +
  '@collection.household_members.user ?= @request.auth.id) || ' +
  '(area = "system" && @request.auth.instance_admin = true))';

migrate(
  function (app) {
    var users = app.findCollectionByNameOrId('users');
    var households = app.findCollectionByNameOrId('households');
    var events = new Collection({
      type: 'base',
      name: 'problem_events',
      listRule: VISIBLE,
      viewRule: VISIBLE,
      createRule: null,
      updateRule: null,
      deleteRule: null,
      fields: [
        { type: 'select', name: 'source', required: true, values: ['request', 'channel', 'job'], maxSelect: 1 },
        { type: 'select', name: 'area', required: true, values: ['private', 'household', 'system'], maxSelect: 1 },
        { type: 'relation', name: 'owner', required: false, collectionId: users.id, cascadeDelete: true, maxSelect: 1 },
        { type: 'relation', name: 'household', required: false, collectionId: households.id, cascadeDelete: true, maxSelect: 1 },
        { type: 'text', name: 'code', max: 60 },
        { type: 'text', name: 'message', max: 300 },
        { type: 'json', name: 'context', required: false, maxSize: 2000 },
        { type: 'text', name: 'fingerprint', required: true, max: 64, pattern: '^[0-9a-f]{64}$', hidden: true },
        { type: 'number', name: 'count', required: true, min: 1, onlyInt: true },
        { type: 'date', name: 'first_at', required: true },
        { type: 'date', name: 'last_at', required: true }
      ],
      indexes: [
        'CREATE UNIQUE INDEX idx_problem_events_fingerprint ON problem_events (fingerprint)',
        'CREATE INDEX idx_problem_events_last_at ON problem_events (last_at)'
      ]
    });
    app.save(events);
  },
  function (app) {
    app.delete(app.findCollectionByNameOrId('problem_events'));
  }
);
