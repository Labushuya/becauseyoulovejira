/// <reference path="../pb_data/types.d.ts" />
// Dependencies between tickets (E1 plan OF-6; app accounts cannot write them before stage 2). Since
// E7-3 (ADR-0059 §4) both tickets lie in the area of the dependency: one across the border between
// Privat and a household is refused for every writer. The logic lives in lib/ticket-service.js;
// handlers run in isolated scopes, so modules are required inside them.

onRecordCreate(function (e) {
  require(`${__hooks}/lib/ticket-service.js`).checkDependencyArea(e.app, e.record);
  e.next();
}, 'dependencies');

onRecordUpdate(function (e) {
  require(`${__hooks}/lib/ticket-service.js`).checkDependencyArea(e.app, e.record);
  e.next();
}, 'dependencies');
