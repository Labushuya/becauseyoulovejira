/// <reference path="../pb_data/types.d.ts" />
// E1 plan, package 3, step 7: ticket_counters (CLAUDE.md section 5, OF-1). Internal table,
// maintained per raw SQL by the ticket hook (package 5): no autodate fields, all API rules null
// permanently.
migrate(
  function (app) {
    var counters = new Collection({
      type: 'base',
      name: 'ticket_counters',
      listRule: null,
      viewRule: null,
      createRule: null,
      updateRule: null,
      deleteRule: null,
      fields: [
        { type: 'text', name: 'key', required: true },
        { type: 'number', name: 'value', onlyInt: true, min: 0 }
      ],
      indexes: ['CREATE UNIQUE INDEX idx_ticket_counters_key ON ticket_counters (key)']
    });
    app.save(counters);
  },
  function (app) {
    app.delete(app.findCollectionByNameOrId('ticket_counters'));
  }
);
