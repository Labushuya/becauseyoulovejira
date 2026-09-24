// Comments of a ticket (E2 plan, T-11 and T-13). Visibility follows the ticket; only the author
// may edit or delete, enforced by the API rules (CLAUDE.md section 5).

import type PocketBase from 'pocketbase';
import type { Comment } from '../domain/ticket';
import { DataError, withDataErrors } from './errors';
import { currentUserId, type RequestOptions } from './options';

const COMMENTS = 'comments';
export const COMMENT_FIELDS = 'id,ticket,author,body,created,updated';

export interface CommentRecord {
	id: string;
	ticket: string;
	author: string;
	body: string;
	created: string;
	updated: string;
}

export function toComment(record: CommentRecord): Comment {
	return {
		id: record.id,
		ticket: record.ticket,
		author: record.author,
		body: record.body,
		created: record.created,
		updated: record.updated
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
			fields: COMMENT_FIELDS,
			signal
		});
		return records.map(toComment);
	});
}

/** Adds a comment of the signed-in user. */
export function createComment(
	pb: PocketBase,
	ticketId: string,
	body: string,
	{ signal }: RequestOptions = {}
) {
	return withDataErrors(signal, async (): Promise<Comment> => {
		const author = currentUserId(pb.authStore.record);
		if (author === null) throw new DataError('session');
		const record = await pb
			.collection(COMMENTS)
			.create<CommentRecord>(
				{ ticket: ticketId, author, body },
				{ fields: COMMENT_FIELDS, signal }
			);
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
			.update<CommentRecord>(id, { body }, { fields: COMMENT_FIELDS, signal });
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
