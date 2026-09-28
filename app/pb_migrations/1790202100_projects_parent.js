/// <reference path="../pb_data/types.d.ts" />
// Sub projects (ADR-0034, package UP-1): the optional relation projects.parent on the own
// collection (one level, same scope, checked by the project hook in lib/catalog-rules.js) and its
// index. Additive: existing projects keep an empty parent and stay top-level; no record, key or
// counter is touched. API rules stay unchanged, visibility follows owner/household.
//
// The down migration removes index and field. Only the hierarchy is lost; projects, tickets, keys
// and counters stay as they are.
migrate(
  function (app) {
    var projects = app.findCollectionByNameOrId('projects');
    // Self reference: the collection exists already, so its id is known here.
    projects.fields.add(
      new RelationField({
        name: 'parent',
        required: false,
        collectionId: projects.id,
        cascadeDelete: false,
        maxSelect: 1
      })
    );
    projects.addIndex('idx_projects_parent', false, 'parent', '');
    app.save(projects);
  },
  function (app) {
    var projects = app.findCollectionByNameOrId('projects');
    projects.removeIndex('idx_projects_parent');
    projects.fields.removeByName('parent');
    app.save(projects);
  }
);
