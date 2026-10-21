// Comments of a ticket (E2 plan, T-11 and T-13). Visibility follows the ticket; only the author
// may edit or delete, enforced by the API rules (docs/regeln/datenmodell.md). Since OF-4b a comment
// of the outbox carries the ID of the client and the fields of the outbox, and the mark of the outbox
// (`offline`, `device_at`) is read once the server reports it (data/history-marks.ts).

import type PocketBase from 'pocketbase';
import type { OutboxFields } from '../domain/offline';
import type { Comment } from '../domain/ticket';
import { DataError, withDataErrors } from './errors';
import { COMMENT_FIELDS, commentFields } from './history-marks';
import { currentUserId, type RequestOptions } from './options';
import { toOutboxBody } from './tickets';

export { COMMENT_FIELDS };

const COMMENTS = 'comments';

export interface CommentRecord {
	id: string;
	ticket: string;
	author: string;
	body: string;
	created: string;
	updated: string;
	/** Missing before the migration of OF-1 and while the fields are not asked for. */
	offline?: boolean;
	device_at?: string;
}

export function toComment(record: CommentRecord): Comment {
	return {
		id: record.id,
		ticket: record.ticket,
		author: record.author,
		body: record.body,
		created: record.created,
		updated: record.updated,
		// Only a comment of the outbox carries the mark (OF-4b); every other one keeps its form.
		...(record.offline === true && { offline: true as const, deviceAt: record.device_at || null })
	};
}

/** All comments of a ticket, oldest first (the newest sits above the input field). */
export function listComments(
	pb: PocketBase,
	ticketId: string,
	{ signal }: RequestOptions = {}
): Promise<Comment[]> {
	return withDataErrors(signal, async () => {
		const records = await pb.collection(COMMENTS).getFullList<CommentRecord>({
			batch: 500,
			filter: pb.filter('ticket = {:ticket}', { ticket: ticketId }),
			sort: 'created,@rowid',
			fields: commentFields(),
			signal
		});
		return records.map(toComment);
	});
}

/** One comment (a discarded one of the outbox that may have arrived, OF-4b). */
export function getComment(pb: PocketBase, id: string, { signal }: RequestOptions = {}) {
	return withDataErrors(signal, async (): Promise<Comment> => {
		const record = await pb
			.collection(COMMENTS)
			.getOne<CommentRecord>(id, { fields: commentFields(), signal });
		return toComment(record);
	});
}

/**
 * Adds a comment of the signed-in user. Through the outbox (OF-4b, ADR-0074 §5) with the ID of the
 * client and the fields of the outbox.
 */
export function createComment(
	pb: PocketBase,
	ticketId: string,
	body: string,
	{ signal, id, outbox }: RequestOptions & { id?: string; outbox?: OutboxFields } = {}
) {
	return withDataErrors(signal, async (): Promise<Comment> => {
		const author = currentUserId(pb.authStore.record);
		if (author === null) throw new DataError('session');
		const request: Record<string, unknown> = { ticket: ticketId, author, body };
		if (id !== undefined) request.id = id;
		if (outbox !== undefined) Object.assign(request, toOutboxBody(outbox));
		const record = await pb
			.collection(COMMENTS)
			.create<CommentRecord>(request, { fields: commentFields(), signal });
		return toComment(record);
	});
}

export function updateComment(
	pb: PocketBase,
	id: string,
	body: string,
	{ signal }: RequestOptions = {}
) {
	return withDataErrors(signal, async (): Promise<Comment> => {
		const record = await pb
			.collection(COMMENTS)
			.update<CommentRecord>(id, { body }, { fields: commentFields(), signal });
		return toComment(record);
	});
}

export function deleteComment(
	pb: PocketBase,
	id: string,
	{ signal }: RequestOptions = {}
): Promise<void> {
	return withDataErrors(signal, async () => {
		await pb.collection(COMMENTS).delete(id, { signal });
	});
}
