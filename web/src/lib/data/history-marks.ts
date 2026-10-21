// The fields of a history (OF-2, ADR-0074 §4) and since OF-4b of a comment: `offline` and `device_at`
// mark a change or a comment from the outbox. They exist only once the server reports `offline_ops`;
// before that the history and the comments ask for exactly the fields of before. Set by
// lib/offline/app-outbox.ts after the answer of the server, read by every later list and subscription
// of a history and of comments.

export const HISTORY_FIELDS = 'id,ticket,field,old_value,new_value,user,created';

/** The fields with the mark of the outbox. */
export const OFFLINE_HISTORY_FIELDS = `${HISTORY_FIELDS},offline,device_at`;

export const COMMENT_FIELDS = 'id,ticket,author,body,created,updated';

/** The fields of a comment with the mark of the outbox (OF-4b). */
export const OFFLINE_COMMENT_FIELDS = `${COMMENT_FIELDS},offline,device_at`;

let offlineMarks = false;

/** Whether the history and the comments ask for the mark of the outbox (`offline_ops` reported). */
export function askOfflineMarks(on: boolean): void {
	offlineMarks = on;
}

/** The fields a history asks for now. */
export function historyFields(): string {
	return offlineMarks ? OFFLINE_HISTORY_FIELDS : HISTORY_FIELDS;
}

/** The fields comments ask for now (OF-4b). */
export function commentFields(): string {
	return offlineMarks ? OFFLINE_COMMENT_FIELDS : COMMENT_FIELDS;
}
