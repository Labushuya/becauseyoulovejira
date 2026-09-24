/// <reference path="../pb_data/types.d.ts" />
// Rejects the mail-based account flows while no mailer is configured (lib/mail-flows.js).
// routerUse registers a global middleware that runs after a route matched, before its handler.
// Every request gets the same 400, whether the address exists or not (no enumeration).

routerUse(function (e) {
  var flows = require(`${__hooks}/lib/mail-flows.js`);
  if (flows.isMailFlowRequest(e.request.method, e.request.url.path)) {
    throw new BadRequestError(flows.MAIL_FLOW_MESSAGE);
  }
  return e.next();
});
