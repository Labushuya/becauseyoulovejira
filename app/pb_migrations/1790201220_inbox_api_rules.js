/// <reference path="../pb_data/types.d.ts" />
// E4 plan, package 1: API rules of inbox_items, the same as for tickets (ADR-0014 section 1,
// 1790200900_api_rules.js): own records or records of an own household; create only as owner;
// update keeps the owner and moves only into own households. Which fields a client may change
// checks the hook (app/pb_hooks/inbox.pb.js).
migrate(
  function (app) {
    var AUTH = '@request.auth.id != ""';

    function member(ref, alias) {
      var join = '@collection.household_members' + (alias ? ':' + alias : '');
      return join + '.household ?= ' + ref + ' && ' + join + '.user ?= @request.auth.id';
    }

    var OWNED =
      AUTH +
      ' && (owner = @request.auth.id || (household != "" && ' +
      member('household') +
      '))';
    var BODY_HOUSEHOLD_ALLOWED =
      '(@request.body.household:isset = false || @request.body.household = "" || (' +
      member('@request.body.household', 'target') +
      '))';

    var inbox = app.findCollectionByNameOrId('inbox_items');
    inbox.listRule = OWNED;
    inbox.viewRule = OWNED;
    inbox.createRule =
      AUTH + ' && @request.body.owner = @request.auth.id && ' + BODY_HOUSEHOLD_ALLOWED;
    inbox.updateRule =
      OWNED + ' && @request.body.owner:changed = false && ' + BODY_HOUSEHOLD_ALLOWED;
    inbox.deleteRule = OWNED;
    app.save(inbox);
  },
  function (app) {
    var inbox = app.findCollectionByNameOrId('inbox_items');
    inbox.listRule = null;
    inbox.viewRule = null;
    inbox.createRule = null;
    inbox.updateRule = null;
    inbox.deleteRule = null;
    app.save(inbox);
  }
);
