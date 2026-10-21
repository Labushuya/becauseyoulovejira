// Comments and history of the ticket in the detail panel (E2 plan, T-10, T-11, T-13, packages 9
// and 10). Kept apart from the detail store: they load, fail and update independently of the
// ticket fields. Own answers and realtime events (ADR-0007, filtered to the open ticket) go
// through the same idempotent `upsertComment`, `removeComment` and `upsertHistory`. Drafts (new
// comment, edited comments) are never overwritten by updates. Project and tag names of the
// history come from the catalog (E3 plan, T-16), not from lists of this store. Every message of a
// failed request keeps the request beside it for "Details" (FP-1, ADR-0071), per place: the new
// comment, a comment, the list of comments and the history.
// Since OF-4b a comment the outbox keeps for later (without a connection, on a ticket "＋" created)
// shows from the outbox next to those of the server (`overlay`) until the server has it under the
// same ID: it never enters the comments of the server, so neither its `updated` nor a reconciliation
// decides about it. A ticket "＋" created has no comments on the server yet: nothing is loaded.

import type PocketBase from 'pocketbase';
import { createContext } from 'svelte';
import { SvelteMap, SvelteSet } from 'svelte/reactivity';
import { createComment, deleteComment, listComments, updateComment } from '$lib/data/comments';
import { problemOf, toDataError } from '$lib/data/errors';
import { listHistory } from '$lib/data/history';
import type { RequestOptions } from '$lib/data/options';
import { OFFLINE_TEXTS } from '$lib/domain/offline';
import type { ProblemEntry } from '$lib/domain/problems';
import type { Comment, HistoryEntry } from '$lib/domain/ticket';
import { toggleTask } from '$lib/markdown';
import { hold, type LiveSource } from './realtime';
import type { LoadState, SessionGuard } from './ticket-list.svelte';

export const COMMENT_REQUIRED_MESSAGE = 'Der Kommentar darf nicht leer sein.';

export interface TicketActivityData {
	listComments(ticketId: string, options: RequestOptions): Promise<Comment[]>;
	createComment(ticketId: string, body: string): Promise<Comment>;
	updateComment(id: string, body: string): Promise<Comment>;
	deleteComment(id: string): Promise<void>;
	listHistory(ticketId: string, options: RequestOptions): Promise<HistoryEntry[]>;
}

export function ticketActivityData(pb: PocketBase): TicketActivityData {
	return {
		listComments: (ticketId, options) => listComments(pb, ticketId, options),
		createComment: (ticketId, body) => createComment(pb, ticketId, body),
		updateComment: (id, body) => updateComment(pb, id, body),
		deleteComment: (id) => deleteComment(pb, id),
		listHistory: (ticketId, options) => listHistory(pb, ticketId, options)
	};
}

/** Oldest first (T-11); equal timestamps keep the server order (insertion order of the map). */
function byCreated(a: Comment, b: Comment): number {
	if (a.created === b.created) return 0;
	return a.created < b.created ? -1 : 1;
}

/** What the store needs of the outbox (OF-4b); null without it (tests, a server without it). */
export interface CommentOverlay {
	/** Comments kept for later on this ticket, oldest first. */
	keptComments(ticketId: string): readonly Comment[];
	/** Whether a record is one the outbox shows, never one of the server. */
	isCreatedView(record: object): boolean;
	/** The ticket is one "＋" created that the server does not have yet, null otherwise. */
	createdTicket(id: string): object | null;
	/** The connection is known to be missing (for the words after a kept comment). */
	readonly offline: boolean;
}

export class TicketActivityStore {
	readonly #data: TicketActivityData;
	readonly #session: SessionGuard;
	readonly #currentUser: () => string | null;
	readonly #overlay: CommentOverlay | null;

	readonly #comments = new SvelteMap<string, Comment>();
	/** Drafts of comments being edited, keyed by comment ID. */
	readonly #edits = new SvelteMap<string, string>();
	readonly #busy = new SvelteSet<string>();
	readonly #commentErrors = new SvelteMap<string, string>();
	/** The failed request behind a message, by place: "post", "comments", "history", "comment:<id>". */
	readonly #problems = new SvelteMap<string, ProblemEntry | null>();
	#controller: AbortController | null = null;
	#historyController: AbortController | null = null;
	#live: LiveSource | null = null;
	/** Ends the comment and history subscriptions of the open ticket. */
	#stopFollowing: (() => void) | null = null;

	#ticketId = $state<string | null>(null);
	#state = $state<LoadState>('idle');
	#error = $state<string | null>(null);
	#newComment = $state('');
	#posting = $state(false);
	#postError = $state<string | null>(null);
	/** The comment the last "Kommentieren" created, so the list can show it (ADR-0044 §1). */
	#lastPosted = $state<string | null>(null);
	/** What happened to the last comment the outbox kept for later (OF-4b), null otherwise. */
	#postNote = $state<string | null>(null);

	/** Newest first (T-11), as the server sorts it (`-created,-@rowid`). */
	#history = $state.raw<readonly HistoryEntry[]>([]);
	#historyState = $state<LoadState>('idle');
	#historyError = $state<string | null>(null);

	/**
	 * The comments of the server oldest first, then those the outbox keeps for later in the order they
	 * were written (OF-4b): they reach the server last, so they keep their place once it has them.
	 */
	#sorted = $derived.by(() => {
		const own = [...this.#comments.values()].sort(byCreated);
		const ticketId = this.#ticketId;
		if (ticketId === null || this.#overlay === null) return own;
		const kept = this.#overlay
			.keptComments(ticketId)
			.filter((entry) => !this.#comments.has(entry.id));
		return kept.length === 0 ? own : [...own, ...kept];
	});

	constructor(
		data: TicketActivityData,
		session: SessionGuard,
		currentUser: () => string | null,
		overlay: CommentOverlay | null = null
	) {
		this.#data = data;
		this.#session = session;
		this.#currentUser = currentUser;
		this.#overlay = overlay;
	}

	/** A comment the outbox keeps for later (OF-4b): not on the server yet, nothing to edit or pin. */
	isKept(comment: Comment): boolean {
		return this.#overlay?.isCreatedView(comment) === true;
	}

	/** What happened to the last comment kept for later (OF-4b), null otherwise. */
	get postNote(): string | null {
		return this.#postNote;
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

	/** The failed request behind `commentsError` (FP-1, ADR-0071). */
	get commentsProblem(): ProblemEntry | null {
		return this.#error === null ? null : (this.#problems.get('comments') ?? null);
	}

	/** History of the ticket, newest first. */
	get history(): readonly HistoryEntry[] {
		return this.#history;
	}

	get historyState(): LoadState {
		return this.#historyState;
	}

	get historyError(): string | null {
		return this.#historyError;
	}

	/** The failed request behind `historyError` (FP-1, ADR-0071). */
	get historyProblem(): ProblemEntry | null {
		return this.#historyError === null ? null : (this.#problems.get('history') ?? null);
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
		if (value !== '') this.#postNote = null;
	}

	get posting(): boolean {
		return this.#posting;
	}

	get postError(): string | null {
		return this.#postError;
	}

	/** The failed request behind `postError` (FP-1, ADR-0071). */
	get postProblem(): ProblemEntry | null {
		return this.#postError === null ? null : (this.#problems.get('post') ?? null);
	}

	/** ID of the comment the last successful "Kommentieren" created, null before one. */
	get lastPostedId(): string | null {
		return this.#lastPosted;
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

	/** The failed request behind `commentError(id)` (FP-1, ADR-0071). */
	commentProblem(id: string): ProblemEntry | null {
		return this.commentError(id) === null ? null : (this.#problems.get(`comment:${id}`) ?? null);
	}

	/** A message at `place`, with the failed request behind it (null for a text of the app). */
	#noteProblem(place: string, error: unknown): void {
		this.#problems.set(place, error === null ? null : problemOf(error));
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

	/**
	 * Follows comments and history of the open ticket live (ADR-0007 section 2); after a
	 * reconnection both are loaded again without a loading state (section 3), as after a
	 * subscription that came only after failed attempts. Returns the cleanup, which ends every
	 * subscription.
	 */
	connect(live: LiveSource): () => void {
		this.#live = live;
		if (this.#ticketId !== null) this.#follow(this.#ticketId);
		const refresh = () => void this.#refresh();
		const stopReconnect = hold((guard) => live.reconnected(guard(refresh)), {
			recovered: refresh
		});
		return () => {
			stopReconnect();
			this.#stopFollowing?.();
			this.#stopFollowing = null;
			if (this.#live === live) this.#live = null;
		};
	}

	/**
	 * Shows the comments of a ticket; another ticket drops drafts and aborts loading. A ticket "＋"
	 * created that the server does not have yet (OF-4b) has neither comments nor a history there:
	 * nothing is loaded, the comments kept for it show from the outbox.
	 */
	open(ticketId: string): void {
		if (ticketId === this.#ticketId && this.#state !== 'error') return;
		this.reset();
		this.#ticketId = ticketId;
		this.#follow(ticketId);
		if (this.#overlay?.createdTicket(ticketId) != null) {
			this.#state = 'ready';
			this.#historyState = 'ready';
			return;
		}
		void this.#load(ticketId);
		void this.#loadHistory(ticketId);
	}

	/** Loads the comments again ("Erneut versuchen"). */
	async reload(): Promise<void> {
		if (this.#ticketId !== null) await this.#load(this.#ticketId);
	}

	/** Loads the history again ("Erneut versuchen"). */
	async reloadHistory(): Promise<void> {
		if (this.#ticketId !== null) await this.#loadHistory(this.#ticketId);
	}

	/**
	 * Adds a history entry of the open ticket (realtime). Entries never change, so a known ID is
	 * ignored. A new entry goes before the first one that is not newer, which keeps the server
	 * order for entries written in the same millisecond.
	 */
	upsertHistory(entry: HistoryEntry): void {
		if (entry.ticket !== this.#ticketId || this.#historyState !== 'ready') return;
		if (this.#history.some((known) => known.id === entry.id)) return;
		const index = this.#history.findIndex((known) => known.created <= entry.created);
		const next = [...this.#history];
		next.splice(index === -1 ? next.length : index, 0, entry);
		this.#history = next;
	}

	/**
	 * Inserts or replaces a comment of the open ticket (own answer or realtime event). An older
	 * `updated` is ignored; a draft of the comment stays. A comment the outbox keeps for later never
	 * enters (OF-4b): the one of the server under its ID replaces it without a comparison of `updated`.
	 */
	upsertComment(comment: Comment): void {
		if (comment.ticket !== this.#ticketId) return;
		if (this.#overlay?.isCreatedView(comment) === true) return;
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

	/**
	 * Sends the new comment; on success the field is emptied, on failure the text stays. One the outbox
	 * keeps for later (OF-4b) empties the field as well and says so (`postNote`); it shows from the
	 * outbox until the server has it.
	 */
	async post(): Promise<boolean> {
		const ticketId = this.#ticketId;
		const body = this.#newComment;
		if (ticketId === null || this.#posting) return false;
		if (body.trim() === '') {
			this.#postError = COMMENT_REQUIRED_MESSAGE;
			this.#noteProblem('post', null);
			return false;
		}
		if (!this.#session.ensureValid()) return false;
		this.#posting = true;
		this.#postError = null;
		this.#postNote = null;
		try {
			const comment = await this.#data.createComment(ticketId, body);
			const kept = this.isKept(comment);
			if (!kept) this.upsertComment(comment);
			if (ticketId === this.#ticketId) {
				this.#lastPosted = comment.id;
				if (kept) this.#postNote = OFFLINE_TEXTS.keptComment(this.#overlay?.offline ?? true);
			}
			if (ticketId === this.#ticketId && this.#newComment === body) this.#newComment = '';
			return true;
		} catch (error) {
			const message = this.#failureMessage(error, 'body');
			if (message !== null && ticketId === this.#ticketId) {
				this.#postError = message;
				this.#noteProblem('post', error);
			}
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
			this.#noteProblem(`comment:${id}`, null);
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
			this.#failComment(id, error);
			return false;
		} finally {
			this.#busy.delete(id);
		}
	}

	/**
	 * Ticks or unticks task `index` of an own comment in the view (ADR-0032 section 6); not while
	 * it is edited or saved. Only the author may change a comment (API rules), so foreign comments
	 * are refused here already. A failure shows at the comment.
	 */
	async toggleTask(id: string, index: number, checked: boolean): Promise<boolean> {
		const comment = this.#comments.get(id);
		if (comment === undefined || !this.isOwn(comment)) return false;
		if (this.#edits.has(id) || this.#busy.has(id)) return false;
		const body = toggleTask(comment.body, index, checked);
		if (body === null) return false;
		if (body === comment.body) return true;
		if (!this.#session.ensureValid()) return false;
		this.#busy.add(id);
		this.#commentErrors.delete(id);
		try {
			this.upsertComment(await this.#data.updateComment(id, body));
			return true;
		} catch (error) {
			this.#failComment(id, error);
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
			this.#failComment(id, error);
			return false;
		} finally {
			this.#busy.delete(id);
		}
	}

	/** The error of a failed request at its comment, with the request for "Details". */
	#failComment(id: string, error: unknown): void {
		const message = this.#failureMessage(error, 'body');
		if (message === null || !this.#comments.has(id)) return;
		this.#commentErrors.set(id, message);
		this.#noteProblem(`comment:${id}`, error);
	}

	/** Empties the store and aborts a running request. */
	reset(): void {
		this.#stopFollowing?.();
		this.#stopFollowing = null;
		this.#controller?.abort();
		this.#controller = null;
		this.#historyController?.abort();
		this.#historyController = null;
		this.#history = [];
		this.#historyState = 'idle';
		this.#historyError = null;
		this.#comments.clear();
		this.#edits.clear();
		this.#busy.clear();
		this.#commentErrors.clear();
		this.#problems.clear();
		this.#ticketId = null;
		this.#state = 'idle';
		this.#error = null;
		this.#newComment = '';
		this.#posting = false;
		this.#postError = null;
		this.#lastPosted = null;
		this.#postNote = null;
	}

	#follow(ticketId: string): void {
		this.#stopFollowing?.();
		this.#stopFollowing = null;
		const live = this.#live;
		if (live === null) return;
		const refresh = () => void this.#refresh();
		const stops = [
			hold(
				(guard) =>
					live.comments(
						ticketId,
						guard((change) => {
							if (change.action === 'delete') this.removeComment(change.id);
							else this.upsertComment(change.record);
						})
					),
				{ recovered: refresh }
			),
			hold(
				(guard) =>
					live.history(
						ticketId,
						guard((change) => {
							if (change.action === 'create') this.upsertHistory(change.record);
						})
					),
				{ recovered: refresh }
			)
		];
		this.#stopFollowing = () => {
			for (const stop of stops) stop();
		};
	}

	/**
	 * Loads comments and history again after a reconnection. Comments are merged (new ones in,
	 * changed ones replaced, missing ones out), so drafts and the scroll position stay; the
	 * history is replaced. A tab that failed to load is simply loaded again.
	 */
	async #refresh(): Promise<void> {
		const ticketId = this.#ticketId;
		if (ticketId === null) return;
		await Promise.all([
			this.#state === 'ready' ? this.#refreshComments(ticketId) : this.reload(),
			this.#historyState === 'ready' ? this.#loadHistory(ticketId, true) : this.reloadHistory()
		]);
	}

	async #refreshComments(ticketId: string): Promise<void> {
		this.#controller?.abort();
		if (!this.#session.ensureValid()) return;
		const controller = new AbortController();
		this.#controller = controller;
		try {
			const comments = await this.#data.listComments(ticketId, { signal: controller.signal });
			if (controller.signal.aborted) return;
			const ids = new SvelteSet(comments.map((comment) => comment.id));
			for (const id of [...this.#comments.keys()]) {
				if (!ids.has(id)) this.removeComment(id);
			}
			for (const comment of comments) this.upsertComment(comment);
		} catch (error) {
			if (controller.signal.aborted) return;
			// Nothing to show: the comments stay as they are, the next reconnection tries again.
			this.#failureMessage(error);
		} finally {
			if (this.#controller === controller) this.#controller = null;
		}
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
			this.#noteProblem('comments', error);
			this.#state = 'error';
		} finally {
			if (this.#controller === controller) this.#controller = null;
		}
	}

	/** History of the ticket, newest first; `quiet` (reconciliation) keeps the tab as it is. */
	async #loadHistory(ticketId: string, quiet = false): Promise<void> {
		this.#historyController?.abort();
		this.#historyController = null;
		if (!this.#session.ensureValid()) return;
		const controller = new AbortController();
		this.#historyController = controller;
		if (!quiet) {
			this.#historyState = 'loading';
			this.#historyError = null;
		}
		try {
			const history = await this.#data.listHistory(ticketId, { signal: controller.signal });
			if (controller.signal.aborted) return;
			this.#history = history;
			this.#historyState = 'ready';
		} catch (error) {
			if (controller.signal.aborted) return;
			const message = this.#failureMessage(error);
			if (message === null || quiet) return;
			this.#historyError = message;
			this.#noteProblem('history', error);
			this.#historyState = 'error';
		} finally {
			if (this.#historyController === controller) this.#historyController = null;
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

/** Store of comments and history of the panel, set by the app layout. */
export { getTicketActivityStore, setTicketActivityStore };
