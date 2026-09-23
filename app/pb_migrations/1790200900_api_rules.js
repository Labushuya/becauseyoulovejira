/// <reference path="../pb_data/types.d.ts" />
// E1 plan, package 4: API rules for all domain collections (CLAUDE.md section 5 plus OF-2, OF-3
// and OF-5). The rules are fixed strings; user input only reaches them through the rule engine
// (@request.*), never through string concatenation. users keeps its rules from 1790200100 and
// ticket_counters stays locked (all rules null).
//
// Household membership uses @collection joins with the any-of operator (?=). Conditions on the
// same collection alias refer to the same joined row, so "household matches AND user matches"
// must hold for one membership row. The body check uses its own alias (:target) so that it does
// not have to match the membership row of the current record.
migrate(
  function (app) {
    var AUTH = '@request.auth.id != ""';

    // Membership of the signed-in user in the household referenced by `ref`.
    function member(ref, alias) {
      var join = '@collection.household_members' + (alias ? ':' + alias : '');
      return (
        join + '.household ?= ' + ref + ' && ' + join + '.user ?= @request.auth.id'
      );
    }

    // Record visible: own record or record of a household the user belongs to.
    function visible(prefix) {
      return (
        AUTH +
        ' && (' + prefix + 'owner = @request.auth.id || (' + prefix + 'household != "" && ' +
        member(prefix + 'household') + '))'
      );
    }

    // A submitted household must be empty or one the user belongs to (OF-3 a/b).
    var BODY_HOUSEHOLD_ALLOWED =
      '(@request.body.household:isset = false || @request.body.household = "" || (' +
      member('@request.body.household', 'target') + '))';

    var OWNED = visible('');
    var OWNED_CREATE =
      AUTH + ' && @request.body.owner = @request.auth.id && ' + BODY_HOUSEHOLD_ALLOWED;
    var OWNED_UPDATE =
      OWNED + ' && @request.body.owner:changed = false && ' + BODY_HOUSEHOLD_ALLOWED;

    var VIA_TICKET = visible('ticket.');

    var rules = {
      households: {
        listRule: AUTH + ' && ' + member('id'),
        viewRule: AUTH + ' && ' + member('id'),
        createRule: null,
        updateRule: null,
        deleteRule: null
      },
      household_members: {
        listRule: 'user = @request.auth.id',
        viewRule: 'user = @request.auth.id',
        createRule: null,
        updateRule: null,
        deleteRule: null
      },
      comments: {
        listRule: VIA_TICKET,
        viewRule: VIA_TICKET,
        createRule: VIA_TICKET + ' && @request.body.author = @request.auth.id',
        updateRule:
          VIA_TICKET +
          ' && author = @request.auth.id' +
          ' && @request.body.author:changed = false && @request.body.ticket:changed = false',
        deleteRule: VIA_TICKET + ' && author = @request.auth.id'
      },
      ticket_history: {
        listRule: VIA_TICKET,
        viewRule: VIA_TICKET,
        createRule: null,
        updateRule: null,
        deleteRule: null
      },
      // Writing stays locked until stage 2 brings the cycle check (OF-5).
      dependencies: {
        listRule: OWNED,
        viewRule: OWNED,
        createRule: null,
        updateRule: null,
        deleteRule: null
      }
    };

    ['projects', 'tags', 'recurrence_rules', 'tickets'].forEach(function (name) {
      rules[name] = {
        listRule: OWNED,
        viewRule: OWNED,
        createRule: OWNED_CREATE,
        updateRule: OWNED_UPDATE,
        deleteRule: OWNED
      };
    });

    Object.keys(rules).forEach(function (name) {
      var collection = app.findCollectionByNameOrId(name);
      var collectionRules = rules[name];
      Object.keys(collectionRules).forEach(function (rule) {
        collection[rule] = collectionRules[rule];
      });
      app.save(collection);
    });
  },
  function (app) {
    [
      'households',
      'household_members',
      'projects',
      'tags',
      'recurrence_rules',
      'tickets',
      'comments',
      'ticket_history',
      'dependencies'
    ].forEach(function (name) {
      var collection = app.findCollectionByNameOrId(name);
      collection.listRule = null;
      collection.viewRule = null;
      collection.createRule = null;
      collection.updateRule = null;
      collection.deleteRule = null;
      app.save(collection);
    });
  }
);
