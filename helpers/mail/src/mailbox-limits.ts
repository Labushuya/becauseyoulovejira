// Port and limits of the mailbox selection (ADR-0016 section 6; E4 plan package 23), the same as in
// the hook app/pb_hooks/lib/mailbox-rules.js (parity test tests/unit/mailbox-rules.test.mjs). Pure
// and without imports, so that test runs without the installed packages of the helper (AR-4).

export const DEFAULT_PORT = 8091;
export const PORT_ENV = 'BYL_MAIL_HELPER_PORT';
export const LIST_DEFAULT = 50;
export const LIST_MAX = 200;
export const IMPORT_MAX = 50;
