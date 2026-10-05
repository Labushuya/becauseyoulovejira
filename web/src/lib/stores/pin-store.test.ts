// Store of the own pinned tickets (PIN-1, ADR-0064) and the section "Angeheftet" of the list store:
// loading in the order of pinning, unavailable before the migration, pinning and releasing without
// optimism, a refusal as an error flag, realtime of other tabs and of the server, loading again after
// a reconnection; the list store shows the open pinned tickets of its area above, never twice, and
// keeps them out of the groups and the number.

import { describe, expect, it, vi } from 'vitest';
import { DataError } from '$lib/data/errors';
import { EMPTY_LIST_QUERY } from '$lib/domain/list-query';
import type { TicketSummary } from '$lib/domain/ticket';
import { fakePins, pinOf } from '$lib/test/fake-pins';
import { FlagStore } from './flags.svelte';
import { PinStore } from './pins.svelte';
import { TicketListStore, type TicketListData } from './ticket-list.svelte';

const SESSION = { ensureValid: () => true, logout: vi.fn() };

let sequence = 0;

function ticket(overrides: Partial<TicketSummary> = {}): TicketSummary {
	sequence += 1;
	return {
		id: `t${String(sequence).padStart(14, '0')}`,
		key: `TASK-${sequence}`,
		title: `Ticket ${sequence}`,
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
		created: `2026-09-${String(sequence).padStart(2, '0')} 10:00:00.000Z`,
		updated: '2026-09-01 10:00:00.000Z',
		...overrides
	};
}

function listData(open: TicketSummary[]): TicketListData {
	return {
		listOpen: vi.fn(async () => open),
		searchOpen: vi.fn(async (): Promise<string[]> => []),
		setDone: vi.fn(),
		update: vi.fn()
	};
}

describe('PinStore', () => {
	it('loads the own pins of every area in the order of pinning, oldest first', async () => {
		const fake = fakePins([pinOf('ticket000000002', 20), pinOf('ticket000000001', 10)]);
		const pins = new PinStore(fake.data, SESSION);
		expect(pins.available).toBe(false);
		await pins.load();
		expect(pins.available).toBe(true);
		expect(pins.ticketIds).toEqual(['ticket000000001', 'ticket000000002']);
		expect(pins.isPinned('ticket000000002')).toBe(true);
		expect(pins.isPinned('ticket000000003')).toBe(false);
	});

	it('stays unavailable before the migration and signs out when the session ended', async () => {
		const fake = fakePins();
		fake.data.list.mockRejectedValueOnce(new DataError('not_found', { status: 404 }));
		const pins = new PinStore(fake.data, SESSION);
		await pins.load();
		expect(pins.available).toBe(false);
		expect(await pins.toggle({ id: 'ticket000000001', key: 'TASK-1' })).toBe(false);
		expect(fake.data.pin).not.toHaveBeenCalled();

		const logout = vi.fn();
		fake.data.list.mockRejectedValueOnce(new DataError('session', { status: 401 }));
		await new PinStore(fake.data, { ensureValid: () => true, logout }).load();
		expect(logout).toHaveBeenCalledOnce();
	});

	it('pins and releases; a pin of another tab counts as done and loads again', async () => {
		const fake = fakePins();
		const pins = new PinStore(fake.data, SESSION);
		await pins.load();
		const target = { id: 'ticket000000001', key: 'TASK-1' };

		expect(await pins.toggle(target)).toBe(true);
		expect(pins.ticketIds).toEqual([target.id]);
		expect(await pins.toggle(target)).toBe(true);
		expect(pins.ticketIds).toEqual([]);
		expect(fake.data.unpin).toHaveBeenCalledWith(pinOf(target.id, 31).id);

		// Pinned in another tab meanwhile: the server answers "exists", the store reads its pins.
		fake.data.pin.mockResolvedValueOnce(null);
		fake.data.list.mockResolvedValueOnce([pinOf(target.id, 5)]);
		expect(await pins.toggle(target)).toBe(true);
		expect(pins.ticketIds).toEqual([target.id]);
	});

	it('names a failure in an error flag and leaves the pins as they were', async () => {
		const fake = fakePins();
		const flags = new FlagStore();
		const pins = new PinStore(fake.data, SESSION, flags);
		await pins.load();
		fake.data.pin.mockRejectedValueOnce(new DataError('network'));
		expect(await pins.toggle({ id: 'ticket000000001', key: 'TASK-1' })).toBe(false);
		expect(pins.ticketIds).toEqual([]);
		expect(flags.flags[0]).toMatchObject({
			tone: 'error',
			title: 'TASK-1 ließ sich nicht anheften.'
		});
		expect(pins.isPending('ticket000000001')).toBe(false);
	});

	it('follows the changes of other tabs and of the server, loads again after a reconnection and empties on stop', async () => {
		const fake = fakePins([pinOf('ticket000000001', 10)]);
		let reconnect: () => void = () => undefined;
		fake.data.reconnected.mockImplementation(async (callback: () => void) => {
			reconnect = callback;
			return async () => undefined;
		});
		const pins = new PinStore(fake.data, SESSION);
		const stop = pins.start();
		await vi.waitFor(() => expect(pins.available).toBe(true));
		await vi.waitFor(() => expect(fake.data.subscribe).toHaveBeenCalled());

		const created = pinOf('ticket000000002', 20);
		fake.emit({ action: 'create', record: created });
		expect(pins.ticketIds).toEqual(['ticket000000001', 'ticket000000002']);
		fake.emit({ action: 'delete', id: pinOf('ticket000000001', 10).id });
		expect(pins.ticketIds).toEqual(['ticket000000002']);

		fake.data.list.mockResolvedValueOnce([pinOf('ticket000000003', 30)]);
		reconnect();
		await vi.waitFor(() => expect(pins.ticketIds).toEqual(['ticket000000003']));

		stop();
		expect(pins.ticketIds).toEqual([]);
		expect(pins.available).toBe(false);
	});
});

describe('TicketListStore with pins', () => {
	async function listWith(open: TicketSummary[], pinned: ReturnType<typeof pinOf>[]) {
		const pins = new PinStore(fakePins(pinned).data, SESSION);
		await pins.load();
		const store = new TicketListStore(listData(open), SESSION, { pins });
		store.activate(EMPTY_LIST_QUERY);
		await vi.waitFor(() => expect(store.openState).toBe('ready'));
		return { store, pins };
	}

	it('shows the open pinned tickets of its area above, in the order of pinning, and not below', async () => {
		const [first, second, third] = [ticket(), ticket(), ticket()];
		const { store } = await listWith(
			[first, second, third],
			[pinOf(third.id, 10), pinOf(first.id, 20), pinOf('elsewhere000001', 5)]
		);
		expect(store.pinned.map((entry) => entry.id)).toEqual([third.id, first.id]);
		expect(store.visible.map((entry) => entry.id)).toEqual([second.id]);
		expect(store.visibleCount).toBe(1);
		expect(store.openCount).toBe(3);
	});

	it('keeps them whatever the filters, and names those that pass the filters', async () => {
		const high = ticket({ priority: 'high' });
		const low = ticket({ priority: 'low' });
		const other = ticket({ priority: 'high' });
		const { store } = await listWith([high, low, other], [pinOf(high.id, 10), pinOf(low.id, 11)]);
		store.activate({ ...EMPTY_LIST_QUERY, priority: 'high' });
		expect(store.pinned.map((entry) => entry.id)).toEqual([high.id, low.id]);
		expect(store.pinnedInFilter.map((entry) => entry.id)).toEqual([high.id]);
		expect(store.visible.map((entry) => entry.id)).toEqual([other.id]);
	});

	it('leaves the pinned tickets out of the groups', async () => {
		const [first, second] = [ticket(), ticket({ priority: 'high' })];
		const { store } = await listWith([first, second], [pinOf(second.id, 10)]);
		store.activate({ ...EMPTY_LIST_QUERY, grouping: 'priority' });
		const grouped = (store.groups ?? []).flatMap((group) => group.tickets.map((entry) => entry.id));
		expect(grouped).toEqual([first.id]);
	});

	it('follows pinning and releasing at once', async () => {
		const [first, second] = [ticket(), ticket()];
		const { store, pins } = await listWith([first, second], []);
		expect(store.pinned).toEqual([]);
		await pins.toggle(second);
		expect(store.pinned.map((entry) => entry.id)).toEqual([second.id]);
		expect(store.visible.map((entry) => entry.id)).toEqual([first.id]);
		await pins.toggle(second);
		expect(store.pinned).toEqual([]);
		expect(store.visible).toHaveLength(2);
	});
});
