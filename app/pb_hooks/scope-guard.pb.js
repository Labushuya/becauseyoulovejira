/// <reference path="../pb_data/types.d.ts" />
// The area of a record (ADR-0058, addendum "Bereich eines Eintrags"; lib/scope-guard.js): through the
// Record API nobody but a superuser changes owner, household or scope of a record. Moving a record
// into or out of a household comes as an own route (E7-4). The tags are COLLECTIONS of
// lib/scope-rules.js (tests/unit/scope-rules.test.mjs keeps both lists equal).

onRecordUpdateRequest(
  function (e) {
    require(`${__hooks}/lib/scope-guard.js`).guardUpdate(e);
    e.next();
  },
  'projects',
  'tags',
  'recurrence_rules',
  'tickets',
  'inbox_items',
  'connections',
  'dependencies'
);
