// Mail-based account flows (password reset, verification, e-mail change, OTP) while no mailer is
// configured. CommonJS module, ES5 only, pure (no PocketBase globals), used by mail-flows.pb.js.
//
// Without SMTP, PocketBase answers these requests with 204 for unknown addresses at once and
// fails silently for known ones (anti-enumeration), so "Forgotten password" reports success
// although no mail ever arrives. The hook rejects every such request uniformly instead.
'use strict';

// The collection segment matches any name or id: the endpoints exist for auth collections only
// (users, _superusers), and both can also be addressed by id (e.g. _pb_users_auth_).
var MAIL_FLOW_PATH =
  /^\/api\/collections\/[^\/]+\/(?:request-password-reset|request-verification|request-email-change|request-otp)$/;

var MAIL_FLOW_MESSAGE =
  'E-Mail-Versand ist nicht eingerichtet. Passwort zurücksetzen: siehe README, ' +
  'Abschnitt ‚Konten verwalten‘ bzw. app\\admin-zuruecksetzen.bat.';

// True for the POST requests that would send a mail. `path` is the decoded URL path.
function isMailFlowRequest(method, path) {
  return method === 'POST' && typeof path === 'string' && MAIL_FLOW_PATH.test(path);
}

module.exports = {
  MAIL_FLOW_MESSAGE: MAIL_FLOW_MESSAGE,
  isMailFlowRequest: isMailFlowRequest
};
