// The live notice of an assignment (E7-5, ADR-0068 §4): when another member gives the signed-in
// account a ticket, the server sends the topic byl/assigned to its open tabs only, after the commit,
// with the ticket, its key, title and area and who it was. Own assignments and those of the server
// send nothing. Read strictly: anything else is no notice.

import type PocketBase from 'pocketbase';
import type { Unsubscribe } from './realtime';

export const ASSIGNED_TOPIC = 'byl/assigned';

export interface AssignedNotice {
	ticket: string;
	key: string;
	title: string;
	/** Area of the ticket (`h:<household>`). */
	scope: string;
	/** The account that assigned it. */
	by: string;
	/** Its display name, '' without one. */
	byName: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function text(value: unknown): string {
	return typeof value === 'string' ? value : '';
}

/** A notice of the server, or null for anything else. */
export function parseAssignedNotice(value: unknown): AssignedNotice | null {
	if (!isRecord(value)) return null;
	const ticket = text(value.ticket);
	const key = text(value.key);
	if (ticket === '' || key === '') return null;
	return {
		ticket,
		key,
		title: text(value.title),
		scope: text(value.scope),
		by: text(value.by),
		byName: text(value.by_name)
	};
}

/** Calls `onNotice` for every assignment by someone else that reaches this tab. */
export function subscribeAssigned(
	pb: PocketBase,
	onNotice: (notice: AssignedNotice) => void
): Promise<Unsubscribe> {
	return pb.realtime.subscribe(ASSIGNED_TOPIC, (data: unknown) => {
		const notice = parseAssignedNotice(data);
		if (notice !== null) onNotice(notice);
	});
}
