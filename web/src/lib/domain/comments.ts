// Comments of a ticket (ADR-0044). Pure: the texts of the pinned comment, shared with the hook.

/**
 * Texts of the codes of the pinned comment (ADR-0044 section 2), the same as in
 * app/pb_hooks/lib/ticket-rules.js (tests/unit/web-comments.test.mjs keeps them equal).
 */
export const PIN_MESSAGES: Readonly<Record<string, string>> = Object.freeze({
	validation_pinned_comment_create: 'Ein neues Ticket hat noch keinen Kommentar zum Anpinnen.',
	validation_pinned_comment_missing: 'Der Kommentar wurde inzwischen gelöscht.',
	validation_pinned_comment_foreign: 'Anpinnen lässt sich nur ein Kommentar dieses Tickets.'
});
