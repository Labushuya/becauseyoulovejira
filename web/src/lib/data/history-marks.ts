// The fields of a history (OF-2, ADR-0074 §4): `offline` and `device_at` mark a change from the
// outbox. They exist only once the server reports `offline_ops`; before that the history asks for
// exactly the fields of before. Set by lib/offline/app-outbox.ts after the answer of the server, read
// by every later list and subscription of a history.

export const HISTORY_FIELDS = 'id,ticket,field,old_value,new_value,user,created';

/** The fields with the mark of the outbox. */
export const OFFLINE_HISTORY_FIELDS = `${HISTORY_FIELDS},offline,device_at`;

let offlineMarks = false;

/** Whether the history asks for the mark of the outbox (the server reported `offline_ops`). */
export function askOfflineMarks(on: boolean): void {
	offlineMarks = on;
}

/** The fields a history asks for now. */
export function historyFields(): string {
	return offlineMarks ? OFFLINE_HISTORY_FIELDS : HISTORY_FIELDS;
}
