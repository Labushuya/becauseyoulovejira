/// <reference path="../pb_data/types.d.ts" />
// E4 plan, package 1: back reference of a ticket to its inbox item (ADR-0014 section 2).
// Additive: two optional fields; existing tickets keep an empty `source` (counts as "manual",
// ADR-0019) and an empty `source_item`. Values of `source` are the channels of inbox_items.
// The down migration removes both fields again.
var CHANNELS = [
  'manual',
  'quick',
  'clipboard',
  'link',
  'eml',
  'mail',
  'ics',
  'calendar',
  'whatsapp',
  'telegram',
  'notion'
];

migrate(
  function (app) {
    var tickets = app.findCollectionByNameOrId('tickets');
    var inbox = app.findCollectionByNameOrId('inbox_items');

    tickets.fields.add(
      new SelectField({ name: 'source', required: false, values: CHANNELS, maxSelect: 1 })
    );
    tickets.fields.add(
      new RelationField({
        name: 'source_item',
        required: false,
        collectionId: inbox.id,
        cascadeDelete: false,
        maxSelect: 1
      })
    );
    tickets.addIndex('idx_tickets_source_item', false, 'source_item', '');
    app.save(tickets);
  },
  function (app) {
    var tickets = app.findCollectionByNameOrId('tickets');
    tickets.removeIndex('idx_tickets_source_item');
    tickets.fields.removeByName('source_item');
    tickets.fields.removeByName('source');
    app.save(tickets);
  }
);
