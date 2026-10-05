/// <reference path="../pb_data/types.d.ts" />
// The day plan (TP-1, ADR-0065): routes of the plan of an area and day and the hooks that keep it in
// line with its tickets. The logic lives in lib/day-plan-service.js, the pure rules in
// lib/day-plan-rules.js; handlers run in isolated scopes, so modules are required inside them. Every
// route is for app accounts on every device (KOB-1: it does nothing on the machine of the app); the
// plans are read through the Record API (rules of the area), written only here.

// The kind of a new ticket (ADR-0065 §1): "Aufgabe" unless it names "Laufendes Vorhaben", also for
// the tickets of a series and duplicates, which the server creates.
onRecordCreate(function (e) {
  require(`${__hooks}/lib/day-plan-service.js`).defaultKind(e.record);
  e.next();
}, 'tickets');

// A ticket that goes to the trash or into another area loses its entries in the plans (ADR-0065 §5),
// in the transaction of the route that writes it (trash, moving, dissolving a household). One deleted
// for good takes them along through the cascade of the relation.
onRecordUpdate(function (e) {
  var service = require(`${__hooks}/lib/day-plan-service.js`);
  var before = service.placeOf(e.record.original());
  e.next();
  service.ticketChanged(e.app, e.record, before);
}, 'tickets');

// The scope of plans and settings follows owner and household, like every record of an area.
onRecordCreate(
  function (e) {
    require(`${__hooks}/lib/day-plan-service.js`).prepareArea(e.record);
    e.next();
  },
  'day_plans',
  'day_plan_settings'
);

onRecordUpdate(
  function (e) {
    require(`${__hooks}/lib/day-plan-service.js`).prepareArea(e.record);
    e.next();
  },
  'day_plans',
  'day_plan_settings'
);

// An entry names a ticket of the area of its plan (ADR-0059 §4), for every writer.
onRecordCreate(function (e) {
  require(`${__hooks}/lib/day-plan-service.js`).checkItem(e.app, e.record);
  e.next();
}, 'day_plan_items');

onRecordUpdate(function (e) {
  require(`${__hooks}/lib/day-plan-service.js`).checkItem(e.app, e.record);
  e.next();
}, 'day_plan_items');

// The plan of an area and day (?scope=&date=), created lazily for today and tomorrow; today takes
// the tickets of the automatic sources in.
routerAdd(
  'GET',
  '/api/byl/dayplan',
  function (e) {
    return require(`${__hooks}/lib/day-plan-service.js`).fetch(e);
  },
  $apis.requireAuth('users')
);

// "Zum Tagesplan", "+" and dragging from the pool: { ticket, scope?, date?, index? }.
routerAdd(
  'POST',
  '/api/byl/dayplan/items',
  function (e) {
    return require(`${__hooks}/lib/day-plan-service.js`).add(e);
  },
  $apis.requireAuth('users')
);

// "Übernehmen" and "Alle übernehmen" of suggestions: { scope?, tickets }.
routerAdd(
  'POST',
  '/api/byl/dayplan/adopt',
  function (e) {
    return require(`${__hooks}/lib/day-plan-service.js`).adopt(e);
  },
  $apis.requireAuth('users')
);

// The check mark of an entry: { mode: check | today | complete, completion? }.
routerAdd(
  'POST',
  '/api/byl/dayplan/items/{id}/check',
  function (e) {
    return require(`${__hooks}/lib/day-plan-service.js`).check(e, e.request.pathValue('id'));
  },
  $apis.requireAuth('users')
);

// Taking a check mark back: { action?: today | complete, status? }.
routerAdd(
  'POST',
  '/api/byl/dayplan/items/{id}/uncheck',
  function (e) {
    return require(`${__hooks}/lib/day-plan-service.js`).uncheck(e, e.request.pathValue('id'));
  },
  $apis.requireAuth('users')
);

// "Auf morgen schieben".
routerAdd(
  'POST',
  '/api/byl/dayplan/items/{id}/tomorrow',
  function (e) {
    return require(`${__hooks}/lib/day-plan-service.js`).tomorrow(e, e.request.pathValue('id'));
  },
  $apis.requireAuth('users')
);

// "Entfernen".
routerAdd(
  'POST',
  '/api/byl/dayplan/items/{id}/remove',
  function (e) {
    return require(`${__hooks}/lib/day-plan-service.js`).remove(e, e.request.pathValue('id'));
  },
  $apis.requireAuth('users')
);

// The order: { index }.
routerAdd(
  'POST',
  '/api/byl/dayplan/items/{id}/move',
  function (e) {
    return require(`${__hooks}/lib/day-plan-service.js`).move(e, e.request.pathValue('id'));
  },
  $apis.requireAuth('users')
);

// The modes of the sources of an area: { scope?, sources }.
routerAdd(
  'POST',
  '/api/byl/dayplan/settings',
  function (e) {
    return require(`${__hooks}/lib/day-plan-service.js`).saveSettings(e);
  },
  $apis.requireAuth('users')
);
