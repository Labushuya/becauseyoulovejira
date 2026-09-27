// Comment store with a fake data layer (E2 plan, package 9): loading, posting, editing and
// deleting, idempotent updates, drafts that survive updates, and the session and error paths.

import { describe, expect, it, vi } from 'vitest';
import { DataError } from '$lib/data/errors';
import type { Comment, HistoryEntry } from '$lib/domain/ticket';
import {
	COMMENT_REQUIRED_MESSAGE,
	TicketActivityStore,
	type TicketActivityData
} from './ticket-activity.svelte';

const TICKET = 'ticket000000001';
const ME = 'user0000000001';
const OTHER = 'user0000000002';

function comment(overrides: Partial<Comment> = {}): Comment {
	return {
		id: 'comment00000001',
		ticket: TICKET,
		author: ME,
		body: 'Erster Kommentar',
		created: '2026-09-24 10:00:00.000Z',
		updated: '2026-09-24 10:00:00.000Z',
		...overrides
	};
}

function entry(overrides: Partial<HistoryEntry> = {}): HistoryEntry {
	return {
		id: 'hist00000000001',
		ticket: TICKET,
		field: 'created',
		oldValue: '',
		newValue: 'TASK-3',
		user: ME,
		created: '2026-09-24 09:00:00.000Z',
		...overrides
	};
}

function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (error: unknown) => void;
	const promise = new Promise<T>((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return { promise, resolve, reject };
}

function setup(initial: Comment[] = [comment()], history: HistoryEntry[] = [entry()]) {
	let clock = 0;
	const stamp = () => {
		clock += 1;
		return `2026-09-24 11:00:${String(clock).padStart(2, '0')}.000Z`;
	};
	const data = {
		listComments: vi.fn<TicketActivityData['listComments']>(async () => initial),
		createComment: vi.fn(async (ticket: string, body: string): Promise<Comment> => {
			const created = stamp();
			return comment({ id: `new${clock}`, ticket, body, created, updated: created });
		}),
		updateComment: vi.fn(async (id: string, body: string): Promise<Comment> => {
			const found = initial.find((entry) => entry.id === id) ?? comment({ id });
			return { ...found, body, updated: stamp() };
		}),
		deleteComment: vi.fn(async (): Promise<void> => undefined),
		listHistory: vi.fn<TicketActivityData['listHistory']>(async () => history)
	} satisfies TicketActivityData;
	const session = { ensureValid: vi.fn(() => true), logout: vi.fn() };
	const store = new TicketActivityStore(data, session, () => ME);
	return { store, data, session };
}

async function opened(initial?: Comment[]) {
	const context = setup(initial);
	context.store.open(TICKET);
	await vi.waitFor(() => expect(context.store.commentsState).toBe('ready'));
	return context;
}

describe('TicketActivityStore: loading', () => {
	it('loads the comments of the ticket oldest first', async () => {
		const newer = comment({ id: 'c2', created: '2026-09-24 12:00:00.000Z' });
		const older = comment({ id: 'c1', created: '2026-09-24 09:00:00.000Z' });
		const { store, data } = await opened([newer, older]);

		expect(data.listComments).toHaveBeenCalledWith(TICKET, expect.anything());
		expect(store.comments.map((entry) => entry.id)).toEqual(['c1', 'c2']);
	});

	it('keeps the server order for equal timestamps', async () => {
		const { store } = await opened([comment({ id: 'b' }), comment({ id: 'a' })]);

		expect(store.comments.map((entry) => entry.id)).toEqual(['b', 'a']);
	});

	it('aborts the request of the previous ticket', async () => {
		const { store, data } = setup();
		const first = deferred<Comment[]>();
		data.listComments.mockReturnValueOnce(first.promise);
		store.open(TICKET);
		const signal = data.listComments.mock.calls[0]?.[1].signal;

		store.open('ticket000000002');

		expect(signal?.aborted).toBe(true);
		first.resolve([comment()]);
		await vi.waitFor(() => expect(store.commentsState).toBe('ready'));
		expect(store.ticketId).toBe('ticket000000002');
	});

	it('shows a loading error and loads again', async () => {
		const { store, data } = setup();
		data.listComments.mockRejectedValueOnce(new DataError('network'));
		store.open(TICKET);
		await vi.waitFor(() => expect(store.commentsState).toBe('error'));

		expect(store.commentsError).toMatch(/Server nicht erreichbar/);
		await store.reload();
		expect(store.commentsState).toBe('ready');
		expect(store.comments).toHaveLength(1);
	});

	it('ends the session on 401 without an error message', async () => {
		const { store, data, session } = setup();
		data.listComments.mockRejectedValueOnce(new DataError('session', { status: 401 }));
		store.open(TICKET);
		await vi.waitFor(() => expect(session.logout).toHaveBeenCalled());

		expect(store.commentsError).toBeNull();
	});

	it('sends no request without a valid session', () => {
		const { store, data, session } = setup();
		session.ensureValid.mockReturnValue(false);

		store.open(TICKET);

		expect(data.listComments).not.toHaveBeenCalled();
	});
});

describe('TicketActivityStore: new comment', () => {
	it('posts the comment, appends it and empties the field', async () => {
		const { store, data } = await opened();
		store.setNewComment('Neuer **Text**');

		expect(await store.post()).toBe(true);

		expect(data.createComment).toHaveBeenCalledWith(TICKET, 'Neuer **Text**');
		expect(store.comments.at(-1)?.body).toBe('Neuer **Text**');
		expect(store.newComment).toBe('');
		expect(store.dirty).toBe(false);
	});

	it('rejects an empty comment without a request', async () => {
		const { store, data } = await opened();
		store.setNewComment('   ');

		expect(await store.post()).toBe(false);

		expect(data.createComment).not.toHaveBeenCalled();
		expect(store.postError).toBe(COMMENT_REQUIRED_MESSAGE);
	});

	it('keeps the text and shows the error on failure', async () => {
		const { store, data } = await opened();
		data.createComment.mockRejectedValueOnce(new DataError('server', { status: 500 }));
		store.setNewComment('Wichtig');

		expect(await store.post()).toBe(false);

		expect(store.newComment).toBe('Wichtig');
		expect(store.postError).toMatch(/Der Server hat mit einem Fehler geantwortet/);
		expect(store.dirty).toBe(true);
	});

	it('shows the field error of the server for the body', async () => {
		const { store, data } = await opened();
		data.createComment.mockRejectedValueOnce(
			new DataError('validation', {
				status: 400,
				fields: { body: { code: 'validation_max_text_constraint', message: 'Zu lang.' } }
			})
		);
		store.setNewComment('x');

		await store.post();

		expect(store.postError).toBe('Zu lang.');
	});

	it('posts only once while a request runs', async () => {
		const { store, data } = await opened();
		const pending = deferred<Comment>();
		data.createComment.mockReturnValueOnce(pending.promise);
		store.setNewComment('Einmal');

		const first = store.post();
		expect(store.posting).toBe(true);
		expect(await store.post()).toBe(false);
		pending.resolve(comment({ id: 'once', body: 'Einmal' }));
		await first;

		expect(data.createComment).toHaveBeenCalledOnce();
	});
});

describe('TicketActivityStore: editing and deleting', () => {
	it('offers editing only for own comments', async () => {
		const foreign = comment({ id: 'foreign', author: OTHER });
		const { store } = await opened([comment(), foreign]);

		expect(store.isOwn(comment())).toBe(true);
		expect(store.isOwn(foreign)).toBe(false);
		store.startEdit('foreign');
		expect(store.isEditing('foreign')).toBe(false);
	});

	it('saves an edited comment and ends editing', async () => {
		const { store, data } = await opened();
		store.startEdit('comment00000001');
		store.setEdit('comment00000001', 'Geändert');
		expect(store.dirty).toBe(true);

		expect(await store.saveEdit('comment00000001')).toBe(true);

		expect(data.updateComment).toHaveBeenCalledWith('comment00000001', 'Geändert');
		expect(store.isEditing('comment00000001')).toBe(false);
		expect(store.comments[0]?.body).toBe('Geändert');
		const [saved] = store.comments;
		expect(saved && saved.updated > saved.created).toBe(true);
	});

	it('ends an unchanged edit without a request', async () => {
		const { store, data } = await opened();
		store.startEdit('comment00000001');

		expect(await store.saveEdit('comment00000001')).toBe(true);
		expect(data.updateComment).not.toHaveBeenCalled();
		expect(store.dirty).toBe(false);
	});

	it('keeps the draft and shows the error when saving fails', async () => {
		const { store, data } = await opened();
		data.updateComment.mockRejectedValueOnce(new DataError('not_found', { status: 404 }));
		store.startEdit('comment00000001');
		store.setEdit('comment00000001', 'Geändert');

		expect(await store.saveEdit('comment00000001')).toBe(false);

		expect(store.editValue('comment00000001')).toBe('Geändert');
		expect(store.commentError('comment00000001')).toMatch(/Nicht gefunden/);
	});

	it('rejects an empty edit without a request', async () => {
		const { store, data } = await opened();
		store.startEdit('comment00000001');
		store.setEdit('comment00000001', ' ');

		expect(await store.saveEdit('comment00000001')).toBe(false);
		expect(data.updateComment).not.toHaveBeenCalled();
		expect(store.commentError('comment00000001')).toBe(COMMENT_REQUIRED_MESSAGE);
	});

	it('cancels an edit', async () => {
		const { store } = await opened();
		store.startEdit('comment00000001');
		store.setEdit('comment00000001', 'Verworfen');

		store.cancelEdit('comment00000001');

		expect(store.isEditing('comment00000001')).toBe(false);
		expect(store.editValue('comment00000001')).toBe('Erster Kommentar');
	});

	it('deletes a comment', async () => {
		const { store, data } = await opened();

		expect(await store.deleteComment('comment00000001')).toBe(true);

		expect(data.deleteComment).toHaveBeenCalledWith('comment00000001');
		expect(store.comments).toEqual([]);
	});

	it('treats a comment deleted elsewhere as deleted', async () => {
		const { store, data } = await opened();
		data.deleteComment.mockRejectedValueOnce(new DataError('not_found', { status: 404 }));

		expect(await store.deleteComment('comment00000001')).toBe(true);
		expect(store.comments).toEqual([]);
	});

	it('keeps the comment and shows the error when deleting fails', async () => {
		const { store, data } = await opened();
		data.deleteComment.mockRejectedValueOnce(new DataError('network'));

		expect(await store.deleteComment('comment00000001')).toBe(false);

		expect(store.comments).toHaveLength(1);
		expect(store.commentError('comment00000001')).toMatch(/Server nicht erreichbar/);
	});
});

describe('TicketActivityStore: ticking tasks of a comment (ADR-0032 section 6)', () => {
	const own = comment({ body: '- [ ] Anrufen\n- [ ] Schreiben' });
	const foreign = comment({ id: 'comment00000002', author: OTHER, body: '- [ ] Fremd' });

	it('ticks a task of an own comment and saves the body', async () => {
		const { store, data } = await opened([own, foreign]);

		expect(await store.toggleTask(own.id, 1, true)).toBe(true);

		expect(data.updateComment).toHaveBeenCalledExactlyOnceWith(
			own.id,
			'- [ ] Anrufen\n- [x] Schreiben'
		);
		expect(store.comments[0]?.body).toBe('- [ ] Anrufen\n- [x] Schreiben');
		expect(store.isBusy(own.id)).toBe(false);
	});

	it('refuses foreign comments, comments being edited and unknown tasks without a request', async () => {
		const { store, data } = await opened([own, foreign]);

		expect(await store.toggleTask(foreign.id, 0, true)).toBe(false);
		expect(await store.toggleTask(own.id, 7, true)).toBe(false);
		store.startEdit(own.id);
		expect(await store.toggleTask(own.id, 0, true)).toBe(false);
		expect(data.updateComment).not.toHaveBeenCalled();
	});

	it('shows the error at the comment when saving fails', async () => {
		const { store, data } = await opened([own]);
		data.updateComment.mockRejectedValueOnce(new DataError('network'));

		expect(await store.toggleTask(own.id, 0, true)).toBe(false);
		expect(store.commentError(own.id)).toMatch(/Server nicht erreichbar/);
		expect(store.comments[0]?.body).toBe(own.body);
	});
});

describe('TicketActivityStore: updates', () => {
	it('inserts, replaces and removes comments idempotently', async () => {
		const { store } = await opened();
		const added = comment({ id: 'c9', created: '2026-09-24 13:00:00.000Z' });

		store.upsertComment(added);
		store.upsertComment(added);
		expect(store.comments.map((entry) => entry.id)).toEqual(['comment00000001', 'c9']);

		store.removeComment('c9');
		store.removeComment('c9');
		expect(store.comments.map((entry) => entry.id)).toEqual(['comment00000001']);
	});

	it('ignores an older version and comments of other tickets', async () => {
		const { store } = await opened();
		store.upsertComment(comment({ body: 'neu', updated: '2026-09-24 12:00:00.000Z' }));

		store.upsertComment(comment({ body: 'alt', updated: '2026-09-24 11:00:00.000Z' }));
		store.upsertComment(comment({ id: 'elsewhere', ticket: 'ticket000000009' }));

		expect(store.comments.map((entry) => entry.body)).toEqual(['neu']);
	});

	it('keeps an edit draft when the comment changes elsewhere', async () => {
		const { store } = await opened();
		store.startEdit('comment00000001');
		store.setEdit('comment00000001', 'Mein Entwurf');

		store.upsertComment(comment({ body: 'fremd geändert', updated: '2026-09-24 12:00:00.000Z' }));

		expect(store.editValue('comment00000001')).toBe('Mein Entwurf');
		expect(store.comments[0]?.body).toBe('fremd geändert');
	});

	it('reset empties everything', async () => {
		const { store } = await opened();
		store.setNewComment('Entwurf');

		store.reset();

		expect(store.ticketId).toBeNull();
		expect(store.comments).toEqual([]);
		expect(store.newComment).toBe('');
		expect(store.commentsState).toBe('idle');
	});
});

describe('TicketActivityStore: history', () => {
	it('loads only the history; names come from the catalog (E3 plan, T-16)', async () => {
		const { store, data } = await opened();
		await vi.waitFor(() => expect(store.historyState).toBe('ready'));

		expect(data.listHistory).toHaveBeenCalledWith(TICKET, expect.anything());
		expect(store.history.map((item) => item.id)).toEqual(['hist00000000001']);
		expect(Object.keys(data)).not.toContain('listProjects');
		expect('lookups' in store).toBe(false);
	});

	it('shows a failed history and loads it again', async () => {
		const { store, data } = setup();
		data.listHistory.mockRejectedValueOnce(new DataError('network'));
		store.open(TICKET);
		await vi.waitFor(() => expect(store.historyState).toBe('error'));

		expect(store.historyError).toMatch(/Server nicht erreichbar/);
		expect(store.history).toEqual([]);
		await store.reloadHistory();
		expect(store.historyState).toBe('ready');
		expect(store.history).toHaveLength(1);
	});

	it('adds new entries newest first and ignores known ones and other tickets', async () => {
		const older = entry({ id: 'h1', created: '2026-09-24 09:00:00.000Z' });
		const { store } = setup([], [older]);
		store.open(TICKET);
		await vi.waitFor(() => expect(store.historyState).toBe('ready'));

		const first = entry({ id: 'h2', field: 'status', created: '2026-09-24 10:00:00.000Z' });
		const second = entry({ id: 'h3', field: 'priority', created: '2026-09-24 10:00:00.000Z' });
		store.upsertHistory(first);
		store.upsertHistory(second);
		store.upsertHistory(first);
		store.upsertHistory(entry({ id: 'h9', ticket: 'ticket000000009' }));

		expect(store.history.map((item) => item.id)).toEqual(['h3', 'h2', 'h1']);
	});

	it('aborts the history request of the previous ticket and empties it on reset', async () => {
		const { store, data } = setup();
		const pending = deferred<HistoryEntry[]>();
		data.listHistory.mockReturnValueOnce(pending.promise);
		store.open(TICKET);
		const signal = data.listHistory.mock.calls[0]?.[1].signal;

		store.reset();

		expect(signal?.aborted).toBe(true);
		pending.resolve([entry()]);
		await Promise.resolve();
		expect(store.history).toEqual([]);
		expect(store.historyState).toBe('idle');
	});
});
