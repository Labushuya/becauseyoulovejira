// The comments of the panel with the outbox (OF-4b, ADR-0074 addendum OF-4b): a comment kept for later
// shows from the outbox after those of the server and never enters them; the comment of the server
// under the same ID takes its place without a double and without a gap, also from realtime before the
// action went and with a clock of the device ahead (the lesson of OF-4a A4); a ticket "＋" created
// loads no comments; the shell of the data access sends through the outbox only where it takes them.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Comment, TicketSummary } from '$lib/domain/ticket';
import { A, ALL_OPS, NOW, USER, goOffline, goOnline, harness, settle } from '$lib/test/outbox-fake';
import { TicketActivityStore, type TicketActivityData } from '$lib/stores/ticket-activity.svelte';
import { offlineActivityData } from './offline-data';

const SESSION = { ensureValid: () => true, logout: vi.fn() };
const ON_A = { id: A, key: 'HAUS-01', title: 'Ticket 01', scope: `u:${USER}` };
const SERVER_COMMENT: Comment = {
	id: 'comm00000000001',
	ticket: A,
	author: 'user00000000002',
	body: 'Von Anna',
	created: '2026-10-20 10:00:00.000Z',
	updated: '2026-10-20 10:00:00.000Z'
};

beforeEach(() => {
	vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
	vi.setSystemTime(NOW);
});

afterEach(() => {
	vi.useRealTimers();
});

function data(base: Partial<TicketActivityData> = {}): TicketActivityData {
	return {
		listComments: vi.fn(async () => [SERVER_COMMENT]),
		createComment: vi.fn(async () => {
			throw new Error('Not through the outbox.');
		}),
		updateComment: vi.fn(),
		deleteComment: vi.fn(),
		listHistory: vi.fn(async () => []),
		...base
	};
}

async function setup(tickets: Record<string, TicketSummary | null> = {}) {
	const h = harness({ support: ALL_OPS });
	h.server.strict = true;
	h.server.status.set(A, 'open');
	await settle();
	const base = data();
	const find = (id: string) =>
		id === A ? ON_A : (tickets[id] ?? h.outbox.createdTicket(id) ?? null);
	const store = new TicketActivityStore(
		offlineActivityData(base, h.outbox, find),
		SESSION,
		() => USER,
		h.outbox
	);
	// The outbox shows the comment of the server in the panel, as the layout wires it.
	h.sink.upsertComment.mockImplementation((comment: Comment) => store.upsertComment(comment));
	return { h, store, base };
}

describe('a comment kept for later in the panel (OF-4b)', () => {
	it('shows after those of the server with its mark, empties the field and says that it is kept', async () => {
		const { h, store } = await setup();
		store.open(A);
		await settle();
		await goOffline(h);
		store.setNewComment('Bitte bis Freitag bestätigen.');
		expect(await store.post()).toBe(true);
		expect(store.newComment).toBe('');
		expect(store.postNote).toBe(
			'Kommentar gemerkt. Er wird übertragen, sobald die Verbindung zurück ist.'
		);
		expect(store.comments.map((comment) => comment.body)).toEqual([
			'Von Anna',
			'Bitte bis Freitag bestätigen.'
		]);
		const kept = store.comments[1] as Comment;
		expect(store.isKept(kept)).toBe(true);
		expect(store.isOwn(kept)).toBe(true);
		expect(h.outbox.markOf(kept.id)).toBe('pending');
		// Typing again clears the note.
		store.setNewComment('x');
		expect(store.postNote).toBeNull();
	});

	it('is replaced by the comment of the server under the same ID, without a double or a gap', async () => {
		const { h, store } = await setup();
		store.open(A);
		await settle();
		await goOffline(h);
		store.setNewComment('Bitte bis Freitag bestätigen.');
		await store.post();
		const id = store.comments[1]?.id ?? '';
		const seen: number[] = [];
		h.sink.upsertComment.mockImplementation((comment: Comment) => {
			store.upsertComment(comment);
			seen.push(store.comments.filter((entry) => entry.id === id).length);
		});
		await goOnline(h);
		// Each time the outbox shows it (its answer, then its arrival) it stands exactly once.
		expect(seen.length).toBeGreaterThan(0);
		expect(new Set(seen)).toEqual(new Set([1]));
		expect(store.comments.map((comment) => comment.id)).toEqual([SERVER_COMMENT.id, id]);
		expect(store.isKept(store.comments[1] as Comment)).toBe(false);
		expect(store.comments[1]).toMatchObject({ offline: true });
	});

	it('takes the comment of the server from realtime before the action went, also with the clock of the device ahead (OF-4a A4)', async () => {
		const { h, store } = await setup();
		store.open(A);
		await settle();
		await goOffline(h);
		// The clock of the device is a day ahead: the kept comment is "newer" than the one of the server.
		vi.setSystemTime(NOW + 24 * 60 * 60_000);
		store.setNewComment('Bitte bis Freitag bestätigen.');
		await store.post();
		vi.setSystemTime(NOW);
		const id = store.comments[1]?.id ?? '';
		const served: Comment = {
			id,
			ticket: A,
			author: USER,
			body: 'Bitte bis Freitag bestätigen.',
			created: '2026-10-20 12:31:00.000Z',
			updated: '2026-10-20 12:31:00.000Z',
			offline: true,
			deviceAt: '2026-10-21 12:30:00.000Z'
		};
		// Realtime brings it while the outbox still keeps the action.
		store.upsertComment(served);
		expect(h.outbox.count).toBe(1);
		expect(store.comments.filter((comment) => comment.id === id)).toEqual([served]);
	});

	it('loads nothing for a ticket "＋" created and shows its kept comments', async () => {
		const { h, store, base } = await setup();
		await goOffline(h);
		const created = await h.outbox.createTicket({
			title: 'Zahnarzt anrufen',
			description: '',
			status: 'open',
			priority: 'medium',
			due: null,
			project: null,
			tags: []
		});
		store.open(created.value.id);
		expect(store.commentsState).toBe('ready');
		expect(store.historyState).toBe('ready');
		expect(base.listComments).not.toHaveBeenCalled();
		expect(base.listHistory).not.toHaveBeenCalled();
		store.setNewComment('Rückruf erbeten');
		expect(await store.post()).toBe(true);
		expect(store.comments.map((comment) => comment.body)).toEqual(['Rückruf erbeten']);
		await goOnline(h);
		expect(store.comments.map((comment) => comment.body)).toEqual(['Rückruf erbeten']);
		expect(store.isKept(store.comments[0] as Comment)).toBe(false);
		expect(h.outbox.count).toBe(0);
	});

	it('sends a comment the way of today where the outbox does not take it', async () => {
		const h = harness({ support: ALL_OPS, frame: false });
		await settle();
		const create = vi.fn(async (ticketId: string, body: string) => ({
			...SERVER_COMMENT,
			id: 'comm00000000002',
			ticket: ticketId,
			body
		}));
		const shell = offlineActivityData(data({ createComment: create }), h.outbox, () => ON_A);
		await shell.createComment(A, 'Direkt');
		expect(create).toHaveBeenCalledWith(A, 'Direkt');
		expect(h.sendComment).not.toHaveBeenCalled();
	});
});
