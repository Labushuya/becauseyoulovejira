// Realtime in the stores with a fake source (E2 plan, package 12; ADR-0007 sections 2 to 4):
// create, update and delete act on single records, a late older event is ignored, the
// reconciliation after a reconnection inserts, replaces and removes without a loading state, a
// second reconnection aborts a running one, drafts stay, and no subscription is left behind.

import { SvelteMap } from 'svelte/reactivity';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DataError } from '$lib/data/errors';
import type { RequestOptions } from '$lib/data/options';
import type { DoneTicketPage } from '$lib/data/tickets';
import { EMPTY_LIST_QUERY } from '$lib/domain/list-query';
import type { Project } from '$lib/domain/project';
import type { Tag } from '$lib/domain/tag';
import type { Comment, HistoryEntry, Ticket, TicketSummary } from '$lib/domain/ticket';
import { hold, type LiveSource, type RecordChange, type Unsubscribe } from './realtime';
import { TicketActivityStore, type TicketActivityData } from './ticket-activity.svelte';
import {
	TicketDetailStore,
	type TicketDetailData,
	type TicketListSync
} from './ticket-detail.svelte';
import { TicketListStore, type TicketListData } from './ticket-list.svelte';

type Kind = 'tickets' | 'ticket' | 'comments' | 'history' | 'projects' | 'tags' | 'reconnected';

/** Realtime source for tests: records subscriptions and delivers events on demand. */
class FakeLive implements LiveSource {
	readonly #listeners: { kind: Kind; key: string; call: (value: never) => void }[] = [];

	tickets(onChange: (change: RecordChange<TicketSummary>) => void) {
		return this.#add('tickets', '*', onChange);
	}

	ticket(id: string, onChange: (change: RecordChange<Ticket>) => void) {
		return this.#add('ticket', id, onChange);
	}

	comments(ticketId: string, onChange: (change: RecordChange<Comment>) => void) {
		return this.#add('comments', ticketId, onChange);
	}

	history(ticketId: string, onChange: (change: RecordChange<HistoryEntry>) => void) {
		return this.#add('history', ticketId, onChange);
	}

	projects(onChange: (change: RecordChange<Project>) => void) {
		return this.#add('projects', '*', onChange);
	}

	tags(onChange: (change: RecordChange<Tag>) => void) {
		return this.#add('tags', '*', onChange);
	}

	reconnected(callback: () => void) {
		return this.#add('reconnected', '', callback);
	}

	/** Active subscriptions as "kind:key". */
	get active(): string[] {
		return this.#listeners.map(({ kind, key }) => `${kind}:${key}`).sort();
	}

	emit<T>(kind: Exclude<Kind, 'reconnected'>, key: string, change: RecordChange<T>): void {
		for (const listener of [...this.#listeners]) {
			if (listener.kind === kind && listener.key === key) {
				(listener.call as (value: RecordChange<T>) => void)(change);
			}
		}
	}

	reconnect(): void {
		for (const listener of [...this.#listeners]) {
			if (listener.kind === 'reconnected') (listener.call as () => void)();
		}
	}

	#add<T>(kind: Kind, key: string, call: (value: T) => void): Promise<Unsubscribe> {
		const listener = { kind, key, call: call as (value: never) => void };
		this.#listeners.push(listener);
		return Promise.resolve(async () => {
			const index = this.#listeners.indexOf(listener);
			if (index !== -1) this.#listeners.splice(index, 1);
		});
	}
}

function summary(overrides: Partial<TicketSummary> = {}): TicketSummary {
	return {
		id: 'ticket000000001',
		key: 'TASK-1',
		title: 'Steuer',
		status: 'open',
		priority: 'medium',
		due: null,
		projectId: null,
		tagIds: [],
		project: null,
		tags: [],
		recurring: false,
		completedAt: null,
		created: '2026-09-24 08:00:00.000Z',
		updated: '2026-09-24 08:00:00.000Z',
		...overrides
	};
}

function full(overrides: Partial<Ticket> = {}): Ticket {
	return { ...summary(), description: 'Belege sammeln', ...overrides };
}

function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((res) => {
		resolve = res;
	});
	return { promise, resolve };
}

function abortable<T>(options: RequestOptions, value: Promise<T>): Promise<T> {
	return new Promise<T>((resolve, reject) => {
		options.signal?.addEventListener('abort', () => reject(new DataError('aborted')));
		value.then(resolve, reject);
	});
}

const session = () => ({ ensureValid: vi.fn(() => true), logout: vi.fn() });
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

const cleanups: (() => void)[] = [];

afterEach(() => {
	for (const cleanup of cleanups.splice(0)) cleanup();
});

describe('hold', () => {
	it('ends a subscription that is ready', async () => {
		const unsubscribe = vi.fn(async () => undefined);
		const stop = hold(Promise.resolve(unsubscribe));
		await flush();

		stop();
		stop();

		expect(unsubscribe).toHaveBeenCalledOnce();
	});

	it('ends a subscription that becomes ready after the stop', async () => {
		const unsubscribe = vi.fn(async () => undefined);
		const pending = deferred<Unsubscribe>();
		const stop = hold(pending.promise);

		stop();
		pending.resolve(unsubscribe);
		await flush();

		expect(unsubscribe).toHaveBeenCalledOnce();
	});

	it('ignores a failed subscription and a failed unsubscribe', async () => {
		const stopFailed = hold(Promise.reject(new Error('offline')));
		const stopBroken = hold(Promise.resolve(async () => Promise.reject(new Error('gone'))));
		await flush();

		expect(() => {
			stopFailed();
			stopBroken();
		}).not.toThrow();
		await flush();
	});
});

describe('list store live', () => {
	function setup(open: TicketSummary[] = [summary()], done: TicketSummary[][] = []) {
		const data = {
			listOpen: vi.fn((options: RequestOptions) => abortable(options, Promise.resolve(open))),
			listDone: vi.fn((page: number, options: RequestOptions) =>
				abortable<DoneTicketPage>(
					options,
					Promise.resolve({ items: done[page - 1] ?? [], page, hasMore: page < done.length })
				)
			),
			searchOpen: vi.fn(async (): Promise<string[]> => []),
			setDone: vi.fn(async (id: string, isDone: boolean): Promise<TicketSummary> =>
				summary({
					id,
					status: isDone ? 'done' : 'open',
					completedAt: isDone ? '2026-09-24 10:00:00.000Z' : null,
					updated: '2026-09-24 10:00:00.000Z'
				})
			),
			update: vi.fn()
		} satisfies TicketListData;
		const store = new TicketListStore(data, session());
		const live = new FakeLive();
		cleanups.push(() => store.reset());
		const disconnect = store.connect(live);
		cleanups.push(disconnect);
		return { store, data, live, disconnect };
	}

	async function ready(open?: TicketSummary[], done?: TicketSummary[][], showDone = false) {
		const context = setup(open, done);
		context.store.activate({ ...EMPTY_LIST_QUERY, showDone });
		await vi.waitFor(() => expect(context.store.openState).toBe('ready'));
		if (showDone) await vi.waitFor(() => expect(context.store.doneState).toBe('ready'));
		return context;
	}

	it('inserts, updates and removes single tickets from events', async () => {
		const { store, live } = await ready();
		const created = summary({ id: 'ticket000000002', key: 'TASK-2', priority: 'urgent' });

		live.emit('tickets', '*', { action: 'create', record: created });
		expect(store.open.map((ticket) => ticket.id)).toEqual(['ticket000000002', 'ticket000000001']);

		live.emit('tickets', '*', {
			action: 'update',
			record: summary({ title: 'Geändert', updated: '2026-09-24 09:00:00.000Z' })
		});
		expect(store.find('ticket000000001')?.title).toBe('Geändert');

		live.emit('tickets', '*', { action: 'delete', id: 'ticket000000002' });
		expect(store.open.map((ticket) => ticket.id)).toEqual(['ticket000000001']);
	});

	it('ignores a late older event and events for deleted tickets', async () => {
		const { store, live } = await ready();
		live.emit('tickets', '*', {
			action: 'update',
			record: summary({ title: 'Neu', updated: '2026-09-24 09:00:00.000Z' })
		});

		live.emit('tickets', '*', { action: 'update', record: summary({ title: 'Alt' }) });
		expect(store.find('ticket000000001')?.title).toBe('Neu');

		live.emit('tickets', '*', { action: 'delete', id: 'ticket000000001' });
		live.emit('tickets', '*', {
			action: 'update',
			record: summary({ updated: '2026-09-24 11:00:00.000Z' })
		});
		expect(store.open).toEqual([]);
	});

	it('moves a ticket done elsewhere out of the open tickets', async () => {
		const { store, live } = await ready();

		live.emit('tickets', '*', {
			action: 'update',
			record: summary({
				status: 'done',
				completedAt: '2026-09-24 09:00:00.000Z',
				updated: '2026-09-24 09:00:00.000Z'
			})
		});

		expect(store.open).toEqual([]);
	});

	it('reconciles after a reconnection: inserts, replaces and removes without loading state', async () => {
		const kept = summary();
		const gone = summary({ id: 'ticket000000002', key: 'TASK-2' });
		const { store, data, live } = await ready([kept, gone]);
		const changed = summary({ title: 'Anderswo geändert', updated: '2026-09-24 09:00:00.000Z' });
		const added = summary({ id: 'ticket000000003', key: 'TASK-3' });
		const pending = deferred<TicketSummary[]>();
		data.listOpen.mockImplementationOnce((options) => abortable(options, pending.promise));

		live.reconnect();
		expect(store.openState).toBe('ready');
		expect(store.open).toHaveLength(2);
		pending.resolve([changed, added]);
		await flush();

		expect(store.open.map((ticket) => [ticket.id, ticket.title]).sort()).toEqual([
			['ticket000000001', 'Anderswo geändert'],
			['ticket000000003', 'Steuer']
		]);
	});

	it('keeps a row with "Rückgängig" and a ticket created during the reconciliation', async () => {
		const first = summary();
		const { store, data, live } = await ready([first]);
		await store.setDone(first.id, true);
		expect(store.isLingering(first.id)).toBe(true);
		const pending = deferred<TicketSummary[]>();
		data.listOpen.mockImplementationOnce((options) => abortable(options, pending.promise));

		live.reconnect();
		const created = summary({ id: 'ticket000000009', key: 'TASK-9' });
		store.upsert(created);
		pending.resolve([]);
		await flush();

		expect(store.isLingering(first.id)).toBe(true);
		expect(store.open.map((ticket) => ticket.id).sort()).toEqual([first.id, created.id].sort());
	});

	it('reconciles the loaded pages of done tickets', async () => {
		const oldDone = summary({
			id: 'done00000000001',
			status: 'done',
			completedAt: '2026-09-20 08:00:00.000Z'
		});
		const { store, data, live } = await ready([], [[oldDone]], true);
		const newDone = summary({
			id: 'done00000000002',
			status: 'done',
			completedAt: '2026-09-24 08:00:00.000Z'
		});
		data.listDone.mockImplementationOnce((page, options) =>
			abortable(options, Promise.resolve({ items: [newDone], page, hasMore: false }))
		);

		live.reconnect();
		await flush();

		expect(store.done.map((ticket) => ticket.id)).toEqual(['done00000000002']);
		expect(data.listDone).toHaveBeenCalledTimes(2);
	});

	it('aborts a running reconciliation on the next reconnection', async () => {
		const { data, live } = await ready();
		const pending = deferred<TicketSummary[]>();
		data.listOpen.mockImplementationOnce((options) => abortable(options, pending.promise));

		live.reconnect();
		const firstSignal = data.listOpen.mock.lastCall?.[0].signal;
		live.reconnect();

		expect(firstSignal?.aborted).toBe(true);
		expect(data.listOpen.mock.lastCall?.[0].signal?.aborted).toBe(false);
	});

	it('loads a list that failed to load again after a reconnection', async () => {
		const { store, data, live } = setup();
		data.listOpen.mockRejectedValueOnce(new DataError('network'));
		store.activate(EMPTY_LIST_QUERY);
		await vi.waitFor(() => expect(store.openState).toBe('error'));

		live.reconnect();

		await vi.waitFor(() => expect(store.openState).toBe('ready'));
	});

	it('ends both subscriptions on cleanup', async () => {
		const { live, disconnect } = await ready();
		await flush();
		expect(live.active).toEqual(['reconnected:', 'tickets:*']);

		disconnect();
		await flush();

		expect(live.active).toEqual([]);
	});
});

describe('detail store live', () => {
	const ID = 'ticket000000001';

	function setup() {
		let current = full();
		const data = {
			get: vi.fn<TicketDetailData['get']>(async () => current),
			update: vi.fn(),
			create: vi.fn(),
			delete: vi.fn(async (): Promise<void> => undefined)
		} satisfies TicketDetailData;
		const listTickets = new SvelteMap<string, TicketSummary>();
		const list = {
			find: (id: string) => listTickets.get(id) ?? null,
			upsert: vi.fn(),
			completed: vi.fn(),
			remove: vi.fn(),
			announce: vi.fn()
		} satisfies TicketListSync;
		const store = new TicketDetailStore(data, session(), list);
		const live = new FakeLive();
		const disconnect = store.connect(live);
		cleanups.push(disconnect, () => store.reset());
		return {
			store,
			data,
			live,
			disconnect,
			setCurrent: (ticket: Ticket) => {
				current = ticket;
			}
		};
	}

	async function opened() {
		const context = setup();
		context.store.open(ID);
		await vi.waitFor(() => expect(context.store.state).toBe('ready'));
		await flush();
		return context;
	}

	it('follows the shown ticket including its description and keeps a draft', async () => {
		const { store, live } = await opened();
		store.edit('title');
		store.setDraft('title', 'Mein Entwurf');

		live.emit('ticket', ID, {
			action: 'update',
			record: full({
				title: 'Fremd',
				description: 'Neue Beschreibung',
				updated: '2026-09-24 09:00:00.000Z'
			})
		});

		expect(store.ticket?.description).toBe('Neue Beschreibung');
		expect(store.ticket?.title).toBe('Fremd');
		expect(store.value('title')).toBe('Mein Entwurf');
	});

	it('says so when the shown ticket is deleted elsewhere', async () => {
		const { store, live } = await opened();
		store.edit('description');
		store.setDraft('description', 'weg');

		live.emit('ticket', ID, { action: 'delete', id: ID });

		expect(store.state).toBe('deleted');
		expect(store.dirty).toBe(false);
		live.emit('ticket', ID, {
			action: 'update',
			record: full({ updated: '2026-09-24 12:00:00.000Z' })
		});
		expect(store.state).toBe('deleted');
	});

	it('does not report its own deletion as a deletion elsewhere', async () => {
		const { store, data, live } = await opened();
		data.delete.mockImplementationOnce(async () => {
			live.emit('ticket', ID, { action: 'delete', id: ID });
		});

		expect((await store.deleteTicket()).ok).toBe(true);
		expect(store.state).toBe('ready');
	});

	it('moves the subscription on a panel switch and ends it on reset', async () => {
		const { store, live } = await opened();
		expect(live.active).toEqual(['reconnected:', `ticket:${ID}`]);

		store.open('ticket000000002');
		await flush();
		expect(live.active).toEqual(['reconnected:', 'ticket:ticket000000002']);

		store.reset();
		await flush();
		expect(live.active).toEqual(['reconnected:']);
	});

	it('loads the ticket again after a reconnection without a loading state', async () => {
		const { store, data, live, setCurrent } = await opened();
		store.edit('description');
		store.setDraft('description', 'Entwurf');
		setCurrent(full({ title: 'Während der Lücke', updated: '2026-09-24 09:00:00.000Z' }));

		live.reconnect();
		expect(store.state).toBe('ready');
		await flush();

		expect(data.get).toHaveBeenCalledTimes(2);
		expect(store.ticket?.title).toBe('Während der Lücke');
		expect(store.value('description')).toBe('Entwurf');
	});

	it('shows a ticket deleted during the gap as deleted', async () => {
		const { store, data, live } = await opened();
		data.get.mockRejectedValueOnce(new DataError('not_found', { status: 404 }));

		live.reconnect();
		await flush();

		expect(store.state).toBe('deleted');
	});

	it('ends every subscription on cleanup', async () => {
		const { live, disconnect } = await opened();

		disconnect();
		await flush();

		expect(live.active).toEqual([]);
	});
});

describe('activity store live', () => {
	const TICKET = 'ticket000000001';
	const ME = 'user0000000001';

	function comment(overrides: Partial<Comment> = {}): Comment {
		return {
			id: 'comment00000001',
			ticket: TICKET,
			author: ME,
			body: 'Hallo',
			created: '2026-09-24 08:00:00.000Z',
			updated: '2026-09-24 08:00:00.000Z',
			...overrides
		};
	}

	function entry(overrides: Partial<HistoryEntry> = {}): HistoryEntry {
		return {
			id: 'hist00000000001',
			ticket: TICKET,
			field: 'created',
			oldValue: '',
			newValue: 'TASK-1',
			user: ME,
			created: '2026-09-24 08:00:00.000Z',
			...overrides
		};
	}

	async function opened() {
		const data = {
			listComments: vi.fn<TicketActivityData['listComments']>(async () => [comment()]),
			createComment: vi.fn(),
			updateComment: vi.fn(),
			deleteComment: vi.fn(),
			listHistory: vi.fn<TicketActivityData['listHistory']>(async () => [entry()])
		} satisfies TicketActivityData;
		const store = new TicketActivityStore(data, session(), () => ME);
		const live = new FakeLive();
		const disconnect = store.connect(live);
		cleanups.push(disconnect, () => store.reset());
		store.open(TICKET);
		await vi.waitFor(() => expect(store.commentsState).toBe('ready'));
		await vi.waitFor(() => expect(store.historyState).toBe('ready'));
		await flush();
		return { store, data, live, disconnect };
	}

	it('subscribes to comments and history of the open ticket only', async () => {
		const { live } = await opened();

		expect(live.active).toEqual(['comments:' + TICKET, 'history:' + TICKET, 'reconnected:']);
	});

	it('adds, replaces and removes comments from events and keeps an edit draft', async () => {
		const { store, live } = await opened();
		store.startEdit('comment00000001');
		store.setEdit('comment00000001', 'Mein Entwurf');

		live.emit('comments', TICKET, {
			action: 'create',
			record: comment({ id: 'comment00000002', created: '2026-09-24 09:00:00.000Z' })
		});
		live.emit('comments', TICKET, {
			action: 'update',
			record: comment({ body: 'Fremd', updated: '2026-09-24 09:30:00.000Z' })
		});

		expect(store.comments.map((item) => item.id)).toEqual(['comment00000001', 'comment00000002']);
		expect(store.comments[0]?.body).toBe('Fremd');
		expect(store.editValue('comment00000001')).toBe('Mein Entwurf');

		live.emit('comments', TICKET, { action: 'delete', id: 'comment00000002' });
		expect(store.comments.map((item) => item.id)).toEqual(['comment00000001']);
	});

	it('adds new history entries on top', async () => {
		const { store, live } = await opened();

		live.emit('history', TICKET, {
			action: 'create',
			record: entry({ id: 'hist00000000002', field: 'title', created: '2026-09-24 09:00:00.000Z' })
		});

		expect(store.history.map((item) => item.id)).toEqual(['hist00000000002', 'hist00000000001']);
	});

	it('moves the subscriptions on a panel switch and ends them on reset', async () => {
		const { store, live } = await opened();

		store.open('ticket000000002');
		await flush();
		expect(live.active).toEqual([
			'comments:ticket000000002',
			'history:ticket000000002',
			'reconnected:'
		]);

		store.reset();
		await flush();
		expect(live.active).toEqual(['reconnected:']);
	});

	it('merges comments and replaces the history after a reconnection', async () => {
		const { store, data, live } = await opened();
		store.setNewComment('Halb geschrieben');
		data.listComments.mockResolvedValueOnce([
			comment({ id: 'comment00000003', created: '2026-09-24 09:00:00.000Z' })
		]);
		data.listHistory.mockResolvedValueOnce([
			entry({ id: 'hist00000000005', field: 'status', created: '2026-09-24 09:00:00.000Z' }),
			entry()
		]);

		live.reconnect();
		expect(store.commentsState).toBe('ready');
		expect(store.historyState).toBe('ready');
		await flush();

		expect(store.comments.map((item) => item.id)).toEqual(['comment00000003']);
		expect(store.history.map((item) => item.id)).toEqual(['hist00000000005', 'hist00000000001']);
		expect(store.newComment).toBe('Halb geschrieben');
	});

	it('ends every subscription on cleanup', async () => {
		const { live, disconnect } = await opened();

		disconnect();
		await flush();

		expect(live.active).toEqual([]);
	});
});
