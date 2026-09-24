// Comments of the ticket in the detail panel (E2 plan, T-11, T-13 and package 9). Kept apart
// from the detail store: it loads, fails and updates independently of the ticket fields. Own
// answers and (from package 12) realtime events go through the same idempotent `upsertComment`
// and `removeComment`. Drafts (new comment, edited comments) are never overwritten by updates.

import type PocketBase from 'pocketbase';
import { createContext } from 'svelte';
import { SvelteMap, SvelteSet } from 'svelte/reactivity';
import { createComment, deleteComment, listComments, updateComment } from '$lib/data/comments';
import { toDataError } from '$lib/data/errors';
import type { RequestOptions } from '$lib/data/options';
import type { Comment } from '$lib/domain/ticket';
import type { LoadState, SessionGuard } from './ticket-list.svelte';

export const COMMENT_REQUIRED_MESSAGE = 'Der Kommentar darf nicht leer sein.';

export interface TicketActivityData {
	listComments(ticketId: string, options: RequestOptions): Promise<Comment[]>;
	createComment(ticketId: string, body: string): Promise<Comment>;
	updateComment(id: string, body: string): Promise<Comment>;
	deleteComment(id: string): Promise<void>;
}

export function ticketActivityData(pb: PocketBase): TicketActivityData {
	return {
		listComments: (ticketId, options) => listComments(pb, ticketId, options),
		createComment: (ticketId, body) => createComment(pb, ticketId, body),
		updateComment: (id, body) => updateComment(pb, id, body),
		deleteComment: (id) => deleteComment(pb, id)
	};
}

/** Oldest first (T-11); equal timestamps keep the server order (insertion order of the map). */
function byCreated(a: Comment, b: Comment): number {
	if (a.created === b.created) return 0;
	return a.created < b.created ? -1 : 1;
}

export class TicketActivityStore {
	readonly #data: TicketActivityData;
	readonly #session: SessionGuard;
	readonly #currentUser: () => string | null;

	readonly #comments = new SvelteMap<string, Comment>();
	/** Drafts of comments being edited, keyed by comment ID. */
	readonly #edits = new SvelteMap<string, string>();
	readonly #busy = new SvelteSet<string>();
	readonly #commentErrors = new SvelteMap<string, string>();
	#controller: AbortController | null = null;

	#ticketId = $state<string | null>(null);
	#state = $state<LoadState>('idle');
	#error = $state<string | null>(null);
	#newComment = $state('');
	#posting = $state(false);
	#postError = $state<string | null>(null);

	#sorted = $derived([...this.#comments.values()].sort(byCreated));

	constructor(data: TicketActivityData, session: SessionGuard, currentUser: () => string | null) {
		this.#data = data;
		this.#session = session;
		this.#currentUser = currentUser;
	}

	get ticketId(): string | null {
		return this.#ticketId;
	}

	/** Record ID of the signed-in user (T-9: "Du"). */
	get userId(): string | null {
		return this.#currentUser();
	}

	/** Comments of the ticket, oldest first. */
	get comments(): readonly Comment[] {
		return this.#sorted;
	}

	get commentsState(): LoadState {
		return this.#state;
	}

	get commentsError(): string | null {
		return this.#error;
	}

	/** Only the author may edit or delete; the API rules enforce it (T-13). */
	isOwn(comment: Comment): boolean {
		return comment.author !== '' && comment.author === this.#currentUser();
	}

	get newComment(): string {
		return this.#newComment;
	}

	setNewComment(value: string): void {
		this.#newComment = value;
		this.#postError = null;
	}

	get posting(): boolean {
		return this.#posting;
	}

	get postError(): string | null {
		return this.#postError;
	}

	isEditing(id: string): boolean {
		return this.#edits.has(id);
	}

	/** Text shown in the editor of a comment: its draft, else its body. */
	editValue(id: string): string {
		return this.#edits.get(id) ?? this.#comments.get(id)?.body ?? '';
	}

	/** True while saving or deleting the comment. */
	isBusy(id: string): boolean {
		return this.#busy.has(id);
	}

	commentError(id: string): string | null {
		return this.#commentErrors.get(id) ?? null;
	}

	/**
	 * True while text would be lost by leaving the panel: a new comment with content or an
	 * edited comment that differs from the saved one.
	 */
	get dirty(): boolean {
		if (this.#newComment.trim() !== '') return true;
		for (const [id, draft] of this.#edits) {
			if (draft !== this.#comments.get(id)?.body) return true;
		}
		return false;
	}

	/** Shows the comments of a ticket; another ticket drops drafts and aborts loading. */
	open(ticketId: string): void {
		if (ticketId === this.#ticketId && this.#state !== 'error') return;
		this.reset();
		this.#ticketId = ticketId;
		void this.#load(ticketId);
	}

	/** Loads the comments again ("Erneut versuchen"). */
	async reload(): Promise<void> {
		if (this.#ticketId !== null) await this.#load(this.#ticketId);
	}

	/**
	 * Inserts or replaces a comment of the open ticket (own answer or realtime event). An older
	 * `updated` is ignored; a draft of the comment stays.
	 */
	upsertComment(comment: Comment): void {
		if (comment.ticket !== this.#ticketId) return;
		const existing = this.#comments.get(comment.id);
		if (existing !== undefined && existing.updated > comment.updated) return;
		this.#comments.set(comment.id, comment);
	}

	/** Removes a comment (deleted here or elsewhere), including its draft. */
	removeComment(id: string): void {
		this.#comments.delete(id);
		this.#edits.delete(id);
		this.#commentErrors.delete(id);
	}

	/** Sends the new comment; on success the field is emptied, on failure the text stays. */
	async post(): Promise<boolean> {
		const ticketId = this.#ticketId;
		const body = this.#newComment;
		if (ticketId === null || this.#posting) return false;
		if (body.trim() === '') {
			this.#postError = COMMENT_REQUIRED_MESSAGE;
			return false;
		}
		if (!this.#session.ensureValid()) return false;
		this.#posting = true;
		this.#postError = null;
		try {
			const comment = await this.#data.createComment(ticketId, body);
			this.upsertComment(comment);
			if (ticketId === this.#ticketId && this.#newComment === body) this.#newComment = '';
			return true;
		} catch (error) {
			const message = this.#failureMessage(error, 'body');
			if (message !== null && ticketId === this.#ticketId) this.#postError = message;
			return false;
		} finally {
			this.#posting = false;
		}
	}

	/** Starts editing an own comment with its body as draft. */
	startEdit(id: string): void {
		const comment = this.#comments.get(id);
		if (comment === undefined || !this.isOwn(comment) || this.#edits.has(id)) return;
		this.#edits.set(id, comment.body);
		this.#commentErrors.delete(id);
	}

	setEdit(id: string, value: string): void {
		if (this.#edits.has(id)) this.#edits.set(id, value);
	}

	cancelEdit(id: string): void {
		this.#edits.delete(id);
		this.#commentErrors.delete(id);
	}

	/**
	 * Saves an edited comment. Returns true if editing ended: saved, or unchanged without a
	 * request. On failure the draft stays and the comment shows the error.
	 */
	async saveEdit(id: string): Promise<boolean> {
		const draft = this.#edits.get(id);
		const comment = this.#comments.get(id);
		if (draft === undefined || comment === undefined) return true;
		if (this.#busy.has(id)) return false;
		if (draft.trim() === '') {
			this.#commentErrors.set(id, COMMENT_REQUIRED_MESSAGE);
			return false;
		}
		if (draft === comment.body) {
			this.cancelEdit(id);
			return true;
		}
		if (!this.#session.ensureValid()) return false;
		this.#busy.add(id);
		this.#commentErrors.delete(id);
		try {
			const saved = await this.#data.updateComment(id, draft);
			this.upsertComment(saved);
			if (this.#edits.get(id) === draft) this.#edits.delete(id);
			return true;
		} catch (error) {
			const message = this.#failureMessage(error, 'body');
			if (message !== null && this.#comments.has(id)) this.#commentErrors.set(id, message);
			return false;
		} finally {
			this.#busy.delete(id);
		}
	}

	/** Deletes an own comment (after the question in the UI, T-13). */
	async deleteComment(id: string): Promise<boolean> {
		const comment = this.#comments.get(id);
		if (comment === undefined || this.#busy.has(id)) return false;
		if (!this.#session.ensureValid()) return false;
		this.#busy.add(id);
		this.#commentErrors.delete(id);
		try {
			await this.#data.deleteComment(id);
			this.removeComment(id);
			return true;
		} catch (error) {
			// Already gone (deleted elsewhere): the goal is reached.
			if (toDataError(error).kind === 'not_found') {
				this.removeComment(id);
				return true;
			}
			const message = this.#failureMessage(error, 'body');
			if (message !== null && this.#comments.has(id)) this.#commentErrors.set(id, message);
			return false;
		} finally {
			this.#busy.delete(id);
		}
	}

	/** Empties the store and aborts a running request. */
	reset(): void {
		this.#controller?.abort();
		this.#controller = null;
		this.#comments.clear();
		this.#edits.clear();
		this.#busy.clear();
		this.#commentErrors.clear();
		this.#ticketId = null;
		this.#state = 'idle';
		this.#error = null;
		this.#newComment = '';
		this.#posting = false;
		this.#postError = null;
	}

	async #load(ticketId: string): Promise<void> {
		this.#controller?.abort();
		this.#controller = null;
		if (!this.#session.ensureValid()) return;
		const controller = new AbortController();
		this.#controller = controller;
		this.#state = 'loading';
		this.#error = null;
		try {
			const comments = await this.#data.listComments(ticketId, { signal: controller.signal });
			if (controller.signal.aborted) return;
			this.#comments.clear();
			for (const comment of comments) this.#comments.set(comment.id, comment);
			this.#state = 'ready';
		} catch (error) {
			if (controller.signal.aborted) return;
			const message = this.#failureMessage(error);
			if (message === null) return;
			this.#error = message;
			this.#state = 'error';
		} finally {
			if (this.#controller === controller) this.#controller = null;
		}
	}

	/**
	 * German message of a failed request, null if nothing is to be shown (aborted, or the
	 * session ended and the guard leads to the login). A field error of `field` wins.
	 */
	#failureMessage(error: unknown, field?: string): string | null {
		const failure = toDataError(error);
		if (failure.kind === 'aborted') return null;
		if (failure.kind === 'session') {
			this.#session.logout();
			return null;
		}
		const fieldMessage = field === undefined ? undefined : failure.fields[field]?.message;
		return fieldMessage ?? failure.message;
	}
}

const [getTicketActivityStore, setTicketActivityStore] = createContext<TicketActivityStore>();

/** Store of comments (and from package 10 the history) of the panel, set by the app layout. */
export { getTicketActivityStore, setTicketActivityStore };
