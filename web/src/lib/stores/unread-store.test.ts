// "Neu" in the ticket list store (ADR-0015; E4 plan, package 4): read rows loaded with the open
// tickets, marks per ticket and project, marking as read (also when the row exists), "Alle als
// gelesen markieren", realtime from other tabs, nothing new before the migration or on failure.

import { describe, expect, it, vi } from 'vitest';
import { DataError } from '$lib/data/errors';
import type { TicketSummary } from '$lib/domain/ticket';
import { FlagStore } from './flags.svelte';
import type { LiveSource, ReadChange, Unsubscribe } from './realtime';
import { TicketListStore, type ReadsData, type TicketListData } from './ticket-list.svelte';

const BASE = '2026-09-25 08:00:00.000Z';

function ticket(id: string, overrides: Partial<TicketSummary> = {}): TicketSummary {
	return {
		id,
		key: `TASK-${id.slice(-1)}`,
		title: `Ticket ${id}`,
		status: 'open',
		priority: 'medium',
		due: null,
		projectId: null,
		tagIds: [],
		project: null,
		tags: [],
		recurring: false,
		source: null,
		completedAt: null,
		created: '2026-09-25 09:00:00.000Z',
		updated: '2026-09-25 09:00:00.000Z',
		...overrides
	};
}

const OLD = ticket('tick00000000001', { created: '2026-09-01 09:00:00.000Z' });
const READ = ticket('tick00000000002', { projectId: 'proj00000000001' });
const FRESH = ticket('tick00000000003', { projectId: 'proj00000000001' });
const LOOSE = ticket('tick00000000004');

function setup(options: { unreadSince?: string | null; withReads?: boolean } = {}) {
	const data: TicketListData = {
		listOpen: vi.fn(async () => [OLD, READ, FRESH, LOOSE]),
		listDone: vi.fn(async (page: number) => ({ items: [], page, hasMore: false })),
		searchOpen: vi.fn(async () => []),
		setDone: vi.fn(),
		update: vi.fn()
	};
	const reads = {
		unreadSince: vi.fn(() => (options.unreadSince === undefined ? BASE : options.unreadSince)),
		list: vi.fn<ReadsData['list']>(async () => [{ id: 'read00000000001', ticket: READ.id }]),
		markRead: vi.fn<ReadsData['markRead']>(async (ticketId) => ({
			id: 'read00000000009',
			ticket: ticketId
		})),
		markAllRead: vi.fn<ReadsData['markAllRead']>(async () => '2026-09-25 12:00:00.000Z')
	} satisfies ReadsData;
	const session = { ensureValid: vi.fn(() => true), logout: vi.fn() };
	const flags = new FlagStore();
	const store = new TicketListStore(data, session, {
		reads: options.withReads === false ? undefined : reads,
		flags
	});
	return { store, data, reads, session, flags };
}

async function loaded(options: Parameters<typeof setup>[0] = {}) {
	const context = setup(options);
	context.store.loadOpen();
	await vi.waitFor(() => expect(context.store.openState).toBe('ready'));
	await Promise.resolve();
	await Promise.resolve();
	return context;
}

function fakeLive() {
	const reads: ((change: ReadChange) => void)[] = [];
	const quiet = async (): Promise<Unsubscribe> => async () => undefined;
	const source: LiveSource = {
		tickets: quiet,
		ticket: quiet,
		comments: quiet,
		history: quiet,
		projects: quiet,
		tags: quiet,
		inbox: quiet,
		reads: async (call) => {
			reads.push(call);
			return async () => {
				reads.splice(reads.indexOf(call), 1);
			};
		},
		reconnected: quiet
	};
	return { source, reads, send: (change: ReadChange) => reads.forEach((call) => call(change)) };
}

describe('new tickets in the list store', () => {
	it('marks tickets after the base line without an own read row, also per project', async () => {
		const { store, reads } = await loaded();
		await vi.waitFor(() => expect(store.newCount).toBe(2));
		expect(reads.list).toHaveBeenCalledWith(BASE, expect.anything());
		expect(store.isNew(OLD)).toBe(false);
		expect(store.isNew(READ)).toBe(false);
		expect(store.isNew(FRESH)).toBe(true);
		expect(store.isNew(LOOSE)).toBe(true);
		expect(store.newInProject('proj00000000001')).toBe(1);
		expect(store.newInProjects).toBe(1);
	});

	it('marks nothing before the migration, without data or while the rows are missing', async () => {
		const before = await loaded({ unreadSince: null });
		expect(before.reads.list).not.toHaveBeenCalled();
		expect(before.store.newCount).toBe(0);

		const without = await loaded({ withReads: false });
		expect(without.store.isNew(FRESH)).toBe(false);

		const failing = setup();
		failing.reads.list.mockRejectedValueOnce(new DataError('network'));
		failing.store.loadOpen();
		await vi.waitFor(() => expect(failing.store.openState).toBe('ready'));
		await vi.waitFor(() => expect(failing.reads.list).toHaveBeenCalled());
		expect(failing.store.isNew(FRESH)).toBe(false);
	});

	it('marks a ticket as read once and takes an existing row as success', async () => {
		const { store, reads } = await loaded();
		await vi.waitFor(() => expect(store.isNew(FRESH)).toBe(true));
		await store.markRead(FRESH);
		expect(reads.markRead).toHaveBeenCalledWith(FRESH.id);
		expect(store.isNew(FRESH)).toBe(false);
		await store.markRead(FRESH);
		await store.markRead(OLD);
		expect(reads.markRead).toHaveBeenCalledOnce();

		reads.markRead.mockResolvedValueOnce(null);
		await store.markRead(LOOSE);
		expect(store.isNew(LOOSE)).toBe(false);
		expect(store.newCount).toBe(0);
	});

	it('keeps the mark when marking fails and logs out on an ended session', async () => {
		const { store, reads, session } = await loaded();
		await vi.waitFor(() => expect(store.isNew(FRESH)).toBe(true));
		reads.markRead.mockRejectedValueOnce(new DataError('network'));
		await store.markRead(FRESH);
		expect(store.isNew(FRESH)).toBe(true);
		reads.markRead.mockRejectedValueOnce(new DataError('session', { status: 401 }));
		await store.markRead(FRESH);
		expect(session.logout).toHaveBeenCalledOnce();
	});

	it('moves the base line with "Alle als gelesen markieren"', async () => {
		const { store, reads, flags } = await loaded();
		await vi.waitFor(() => expect(store.newCount).toBe(2));
		await store.markAllRead();
		expect(reads.markAllRead).toHaveBeenCalledOnce();
		expect(store.newCount).toBe(0);
		expect(flags.flags[0]).toMatchObject({
			tone: 'success',
			title: 'Alle Tickets als gelesen markiert.'
		});

		reads.markAllRead.mockRejectedValueOnce(new DataError('network'));
		await store.markAllRead();
		expect(flags.flags[0]?.tone).toBe('error');
		expect(flags.flags[0]?.title).toMatch(
			/Die Tickets konnten nicht als gelesen markiert werden\./
		);
		flags.clear();
	});

	it('follows read rows and the base line of other tabs', async () => {
		const { store } = await loaded();
		await vi.waitFor(() => expect(store.newCount).toBe(2));
		const live = fakeLive();
		const stop = store.connect(live.source);
		await vi.waitFor(() => expect(live.reads).toHaveLength(1));

		live.send({ action: 'create', read: { id: 'read00000000002', ticket: FRESH.id } });
		expect(store.isNew(FRESH)).toBe(false);
		live.send({ action: 'delete', id: 'read00000000002' });
		expect(store.isNew(FRESH)).toBe(true);
		live.send({ action: 'baseline', unreadSince: '2026-09-25 10:00:00.000Z' });
		expect(store.newCount).toBe(0);

		stop();
		await vi.waitFor(() => expect(live.reads).toHaveLength(0));
	});

	it('does not subscribe to read rows before the migration', async () => {
		const { store } = await loaded({ unreadSince: null });
		const live = fakeLive();
		store.connect(live.source);
		await Promise.resolve();
		expect(live.reads).toHaveLength(0);
	});

	it('forgets rows and base line on reset', async () => {
		const { store } = await loaded();
		await vi.waitFor(() => expect(store.newCount).toBe(2));
		store.reset();
		expect(store.newCount).toBe(0);
		expect(store.isNew(FRESH)).toBe(false);
	});
});
