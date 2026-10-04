/// <reference path="../pb_data/types.d.ts" />
// Rate limit of joining a household (ADR-0058 §3, ADR-0055 addendum E7-2): the route
// POST /api/byl/household/join takes an invitation code, which can be guessed like a password. It
// gets the strict values of the sign-in (5 requests per 300 s and address) at both levels, for
// signed-in accounts as well. The rule stands after the one of the mail helper, before /api/; as an
// exact label PocketBase compares it before every prefix rule.
//
// Only settings change, and only while they hold the rules of the level "Normal" or "Streng" of
// 1790203500 (or the page "Sicherheit"): rules of the admin UI stay as they are. The lists are
// written out here; lib/security-rules.js rateLimitRules() holds the same (tests).
// Down: back to the rules of the level without the join rule, under the same condition.
var AUTH_LABELS = ['*:auth', '*:requestOTP', '*:requestPasswordReset', '*:confirmPasswordReset'];
var LEVELS = {
  normal: { auth: { maxRequests: 10, duration: 60 }, guest: { maxRequests: 300, duration: 10 } },
  strict: { auth: { maxRequests: 5, duration: 300 }, guest: { maxRequests: 100, duration: 10 } }
};
var JOIN_RULE = { label: 'POST /api/byl/household/join', audience: '', duration: 300, maxRequests: 5 };

function rulesOf(level, withJoin) {
  var preset = LEVELS[level];
  var rules = [];
  for (var i = 0; i < AUTH_LABELS.length; i++) {
    rules.push({ label: AUTH_LABELS[i], audience: '', duration: preset.auth.duration, maxRequests: preset.auth.maxRequests });
  }
  rules.push({ label: '/api/byl/ingest/', audience: '@guest', duration: 10, maxRequests: 1000 });
  if (withJoin) {
    rules.push({ label: JOIN_RULE.label, audience: JOIN_RULE.audience, duration: JOIN_RULE.duration, maxRequests: JOIN_RULE.maxRequests });
  }
  rules.push({ label: '/api/', audience: '@guest', duration: preset.guest.duration, maxRequests: preset.guest.maxRequests });
  return rules;
}

function sameRules(current, expected) {
  var list = current || [];
  if (list.length !== expected.length) {
    return false;
  }
  for (var i = 0; i < expected.length; i++) {
    var rule = list[i];
    if (
      String(rule.label) !== expected[i].label ||
      String(rule.audience || '') !== expected[i].audience ||
      Number(rule.duration) !== expected[i].duration ||
      Number(rule.maxRequests) !== expected[i].maxRequests
    ) {
      return false;
    }
  }
  return true;
}

// Replaces the rules of a level without (from) by those with (to) the join rule, or back.
function swap(app, from, to) {
  var settings = app.settings();
  var levels = ['normal', 'strict'];
  for (var i = 0; i < levels.length; i++) {
    if (sameRules(settings.rateLimits.rules, rulesOf(levels[i], from))) {
      unmarshal({ rateLimits: { rules: rulesOf(levels[i], to) } }, settings);
      app.save(settings);
      return;
    }
  }
}

migrate(
  function (app) {
    swap(app, false, true);
  },
  function (app) {
    swap(app, true, false);
  }
);
