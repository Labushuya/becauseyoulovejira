/// <reference path="../pb_data/types.d.ts" />
// Security hardening (ADR-0055, plan docs/plan/sicherheit.md, SH-1): the rate limiter of PocketBase
// against guessing passwords, and the superusers (admin UI /_/) only from this machine.
//
// - rateLimits: switched on with the rules of the level "Normal" (lib/security-rules.js
//   rateLimitRules('normal'), kept equal by tests/integration/migrations-rollback.test.mjs), but
//   only while the limiter is off with the rules of PocketBase 0.40.4; rules of the admin UI stay.
// - superuserIPs: 127.0.0.1 and ::1, only while the list is empty.
// Down restores both defaults, but only while they still hold what this migration (or the page
// "Sicherheit" with "Normal" or "Streng") set.
var POCKETBASE_RULES = [
  { label: '*:auth', audience: '', duration: 3, maxRequests: 2 },
  { label: '*:create', audience: '', duration: 5, maxRequests: 20 },
  { label: '/api/batch', audience: '', duration: 1, maxRequests: 3 },
  { label: '/api/', audience: '', duration: 10, maxRequests: 300 }
];
var AUTH_LABELS = ['*:auth', '*:requestOTP', '*:requestPasswordReset', '*:confirmPasswordReset'];
var LEVELS = {
  normal: { auth: { maxRequests: 10, duration: 60 }, guest: { maxRequests: 300, duration: 10 } },
  strict: { auth: { maxRequests: 5, duration: 300 }, guest: { maxRequests: 100, duration: 10 } }
};
var LOOPBACK = ['127.0.0.1', '::1'];

function rulesOf(level) {
  var preset = LEVELS[level];
  var rules = [];
  for (var i = 0; i < AUTH_LABELS.length; i++) {
    rules.push({ label: AUTH_LABELS[i], audience: '', duration: preset.auth.duration, maxRequests: preset.auth.maxRequests });
  }
  rules.push({ label: '/api/byl/ingest/', audience: '@guest', duration: 10, maxRequests: 1000 });
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

function sameList(current, expected) {
  var list = current || [];
  if (list.length !== expected.length) {
    return false;
  }
  for (var i = 0; i < expected.length; i++) {
    if (String(list[i]) !== expected[i]) {
      return false;
    }
  }
  return true;
}

migrate(
  function (app) {
    var settings = app.settings();
    var changed = false;
    if (!settings.rateLimits.enabled && sameRules(settings.rateLimits.rules, POCKETBASE_RULES)) {
      unmarshal({ rateLimits: { enabled: true, rules: rulesOf('normal') } }, settings);
      changed = true;
    }
    if ((settings.superuserIPs || []).length === 0) {
      unmarshal({ superuserIPs: LOOPBACK }, settings);
      changed = true;
    }
    if (changed) {
      app.save(settings);
    }
  },
  function (app) {
    var settings = app.settings();
    var changed = false;
    var rules = settings.rateLimits.rules;
    if (settings.rateLimits.enabled && (sameRules(rules, rulesOf('normal')) || sameRules(rules, rulesOf('strict')))) {
      unmarshal({ rateLimits: { enabled: false, rules: POCKETBASE_RULES } }, settings);
      changed = true;
    }
    if (sameList(settings.superuserIPs, LOOPBACK)) {
      unmarshal({ superuserIPs: [] }, settings);
      changed = true;
    }
    if (changed) {
      app.save(settings);
    }
  }
);
