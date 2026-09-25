/// <reference path="../pb_data/types.d.ts" />
// E5 plan, package 2: parameters of recurrence rules (ADR-0021 section 1). Additive: freq,
// interval, weekdays, month_day, anchor, lead_days, scope and last_hint plus an index on scope.
// The number 1790201600 follows 1790201500_users_import_keywords.js (E4, package 21); the plan
// named 1790201500 before that number was taken.
//
// Existing rows (possible only through the admin dashboard, there was no UI before E5) get their
// scope and the default lead time, and since none of them has a rhythm yet they are paused with
// a hint. Written with plain UPDATEs of these columns only, so `updated` and the hooks stay
// untouched. The down migration removes the new fields and the index; the base fields keep
// their values (a paused rule stays paused).
var WEEKDAYS = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'];
var DEFAULT_LEAD_DAYS = 3;
var INCOMPLETE_HINT = 'Regel unvollständig – bitte Rhythmus wählen.';
var NEW_FIELDS = ['freq', 'interval', 'weekdays', 'month_day', 'anchor', 'lead_days', 'scope', 'last_hint'];

migrate(
  function (app) {
    var rules = app.findCollectionByNameOrId('recurrence_rules');
    rules.fields.add(
      new SelectField({
        name: 'freq',
        required: false,
        values: ['daily', 'weekly', 'monthly', 'yearly'],
        maxSelect: 1
      })
    );
    rules.fields.add(new NumberField({ name: 'interval', required: false, onlyInt: true, min: 1, max: 365 }));
    rules.fields.add(new SelectField({ name: 'weekdays', required: false, values: WEEKDAYS, maxSelect: 7 }));
    rules.fields.add(new NumberField({ name: 'month_day', required: false, onlyInt: true, min: -1, max: 31 }));
    rules.fields.add(new DateField({ name: 'anchor', required: false }));
    rules.fields.add(new NumberField({ name: 'lead_days', required: false, onlyInt: true, min: 0, max: 30 }));
    rules.fields.add(new TextField({ name: 'scope', required: true }));
    rules.fields.add(new TextField({ name: 'last_hint', required: false, max: 500 }));
    rules.addIndex('idx_recurrence_rules_scope', false, 'scope', '');
    app.save(rules);

    app
      .db()
      .newQuery(
        "UPDATE recurrence_rules SET scope = CASE WHEN household != '' THEN 'h:' || household ELSE 'u:' || owner END, " +
          'lead_days = {:lead}'
      )
      .bind({ lead: DEFAULT_LEAD_DAYS })
      .execute();
    app
      .db()
      .newQuery("UPDATE recurrence_rules SET active = 0, last_hint = {:hint} WHERE freq = ''")
      .bind({ hint: INCOMPLETE_HINT })
      .execute();
  },
  function (app) {
    var rules = app.findCollectionByNameOrId('recurrence_rules');
    rules.removeIndex('idx_recurrence_rules_scope');
    for (var i = 0; i < NEW_FIELDS.length; i++) {
      rules.fields.removeByName(NEW_FIELDS[i]);
    }
    app.save(rules);
  }
);
