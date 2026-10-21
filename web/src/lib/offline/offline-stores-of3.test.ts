// The stores with the outbox in OF-3 (acceptance of the concept OF-0 §8, ADR-0074 addendum OF-3): the
// day plan checks an entry without a connection with one tap, shows it as done with the mark and the
// flag "Wird übertragen, sobald die Verbindung zurück ist." and "Rückgängig", keeps it over a reload,
// and takes the answer once it is sent; "Rückgängig" offline only drops it. The due date of a cell and
// of the panel is kept the same way; the calendar stays the way of today (expected_updated). Without
// the capability of the day plan the plan goes the way of today.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DataError } from '$lib/data/errors';
import { EMPTY_LIST_QUERY } from '$lib/domain/list-query';
import { OFFLINE_TEXTS } from '$lib/domain/offline';
import { DayPlanStore, type DayPlanLive } from '$lib/stores/day-plan.svelte';
import { FlagStore } from '$lib/stores/flags.svelte';
import type { LiveSource } from '$lib/stores/realtime';
import { TicketDetailStore, type TicketDetailData } from '$lib/stores/ticket-detail.svelte';
import { TicketListStore, type TicketListData } from '$lib/stores/ticket-list.svelte';
import {
	fakeDayPlanData,
	fakeFlags,
	fakeSession,
	fakeTickets,
	planItem,
	planTicket
} from '$lib/test/day-plan-fake';
import {
	A,
	ALL_OPS,
	NOW,
	OPS,
	goOffline,
	goOnline,
	harness,
	settle,
	ticket
} from '$lib/test/outbox-fake';
import { offlineDayPlanData, offlineTicketDetailData, offlineTicketListData } from './offline-data';

const T1 = 't000000000000a1';
const I1 = 'item00000000001';

beforeEach(() => {
	vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
	vi.setSystemTime(NOW);
});

afterEach(() => {
	vi.useRealTimers();
});

/** Realtime of the plan and the tickets that brings nothing. */
function quietLive() {
	const live: DayPlanLive = {
		items: async () => async () => undefined,
		plan: async () => async () => undefined,
		settings: async () => async () => undefined
	};
	const tickets = {
		tickets: async () => async () => undefined,
		reconnected: async () => async () => undefined
	} as unknown as LiveSource;
	return { live, tickets };
}

/** The day plan of today with one task, its store on the shell of the outbox. */
async function dayPlan(support = ALL_OPS) {
	const h = harness({ support });
	await settle();
	const base = fakeDayPlanData([planItem(I1, T1, 0)]);
	const flags = fakeFlags();
	const store: DayPlanStore = new DayPlanStore(
		offlineDayPlanData(base, h.outbox, (id) => store.entryOf(id)),
		fakeTickets([planTicket(T1)]),
		fakeSession(),
		{ flags: flags.flags, overlay: h.outbox }
	);
	const { live, tickets } = quietLive();
	const stop = store.connect(tickets, live);
	store.show(null);
	await vi.waitFor(() => expect(store.state).toBe('ready'));
	return { h, store, base, flags, stop };
}

describe('the day plan without a connection (OF-3)', () => {
	it('checks an entry with one tap: done at once with the mark and the flag, kept over a reload, sent once the connection is back', async () => {
		const { h, store, base, flags } = await dayPlan();
		await goOffline(h);
		await store.toggle(I1);
		expect(store.rows[0]?.done).toBe(true);
		expect(h.outbox.isPending(I1)).toBe(true);
		expect(flags.last()).toMatchObject({
			title: 'TASK-a1 erledigt.',
			description: OFFLINE_TEXTS.pendingFlag,
			action: { label: 'Rückgängig' }
		});
		expect(base.check).not.toHaveBeenCalled();
		await store.reload();
		expect(store.rows[0]?.done).toBe(true);

		await goOnline(h);
		expect(h.sendDayPlan).toHaveBeenCalledTimes(1);
		expect(h.outbox.count).toBe(0);
		// The answer of the server came back to the plan: the ticket is done there.
		expect(store.rows[0]?.done).toBe(true);
		expect(store.rows[0]?.ticket?.status).toBe('done');
	});

	it('"Rückgängig" offline only drops the kept check mark', async () => {
		const { h, store, base, flags } = await dayPlan();
		await goOffline(h);
		await store.toggle(I1);
		flags.last()?.action?.run();
		await settle();
		expect(h.outbox.count).toBe(0);
		expect(store.rows[0]?.done).toBe(false);
		await goOnline(h);
		expect(h.sendDayPlan).not.toHaveBeenCalled();
		expect(base.uncheck).not.toHaveBeenCalled();
	});

	it('goes the way of today while the server does not take the check marks of the day plan', async () => {
		const { h, store, base } = await dayPlan(OPS);
		await goOffline(h);
		await store.toggle(I1);
		expect(base.check).toHaveBeenCalledTimes(1);
		expect(h.outbox.count).toBe(0);
	});
});

/** "Aufgaben" and the panel on a data layer that does not reach the server. */
function ticketStores() {
	const h = harness({ support: ALL_OPS });
	const unreachable = async (): Promise<never> => {
		throw new DataError('network');
	};
	const base: TicketListData = {
		listOpen: vi.fn(async () => [ticket(A)]),
		searchOpen: vi.fn(async () => []),
		setDone: vi.fn(unreachable),
		update: vi.fn(unreachable)
	};
	const session = { ensureValid: () => true, logout: vi.fn() };
	const flags = new FlagStore();
	const list: TicketListStore = new TicketListStore(
		offlineTicketListData(base, h.outbox, (id) => list.find(id)),
		session,
		{ flags, overlay: h.outbox, now: () => NOW }
	);
	const detailBase: TicketDetailData = {
		get: vi.fn(async () => ticket(A)),
		update: vi.fn(unreachable),
		create: vi.fn(async () => ticket(A)),
		delete: vi.fn(async () => null)
	};
	const shown = (id: string) => (detail.ticket?.id === id ? detail.ticket : null);
	const detail: TicketDetailStore = new TicketDetailStore(
		offlineTicketDetailData(detailBase, h.outbox, shown),
		session,
		list,
		null,
		undefined,
		flags,
		undefined,
		h.outbox
	);
	return { h, list, detail, base, detailBase };
}

describe('the due date without a connection (OF-3)', () => {
	it('keeps the due date of a cell with the mark, also over an event of the server', async () => {
		const { h, list, base } = ticketStores();
		list.activate(EMPTY_LIST_QUERY);
		await settle();
		await goOffline(h);
		expect(await list.changeField(A, { due: '2026-10-22' })).toBe(true);
		expect(list.find(A)?.due).toBe('2026-10-22');
		expect(h.outbox.isPending(A)).toBe(true);
		expect(base.update).not.toHaveBeenCalled();
		list.upsert({ ...ticket(A), title: 'Neu', updated: '2026-10-20 12:40:00.000Z' });
		expect(list.find(A)).toMatchObject({ title: 'Neu', due: '2026-10-22' });
		await goOnline(h);
		expect(h.server.due.get(A)).toBe('2026-10-22');
	});

	it('keeps the due date of the panel, also after loading the ticket again', async () => {
		const { h, detail, detailBase } = ticketStores();
		detail.open(A);
		await settle();
		await goOffline(h);
		detail.edit('due');
		detail.setDraft('due', '2026-10-22');
		expect(await detail.save('due')).toBe(true);
		expect(detail.ticket?.due).toBe('2026-10-22');
		expect(detailBase.update).not.toHaveBeenCalled();
		await detail.reload();
		expect(detail.ticket?.due).toBe('2026-10-22');
		expect(h.outbox.isPending(A)).toBe(true);
	});

	it('leaves moving in the calendar the way of today, with its guard', async () => {
		const { h, list, base } = ticketStores();
		list.activate(EMPTY_LIST_QUERY);
		await settle();
		await goOffline(h);
		await list.moveDue(A, '2026-10-22');
		expect(base.update).toHaveBeenCalledWith(
			A,
			{ due: '2026-10-22' },
			expect.objectContaining({ expectedUpdated: expect.any(String) })
		);
		expect(h.outbox.count).toBe(0);
	});
});
