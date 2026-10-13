// Unit tests of the store of the day plan (TP-1, ADR-0065) on a fake data layer: the plan of a day and
// its entries, the suggestions and the pool computed live from the open tickets, the check mark of a
// task and of an ongoing project with "Rückgängig", "Nur für heute abhaken", "Vorhaben abschließen",
// the question about open sub-tasks, "Auf morgen schieben", "Entfernen", the order, the kind, the
// settings, the automatic sources, realtime, the area and the entry "Zum Tagesplan" of the menus;
// since PL-1 pins as display only and the settings live from other tabs and members.

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DayPlanItem, DayPlanMeta, DayPlanSettingsRecord } from '$lib/data/day-plan';
import { DataError } from '$lib/data/errors';
import type { RecordChange } from '$lib/data/realtime';
import { DEFAULT_SOURCES, type SourceMode } from '$lib/domain/day-plan';
import type { TicketSummary } from '$lib/domain/ticket';
import {
	PLAN,
	SCOPE,
	TODAY,
	fakeDayPlanData as fakeData,
	fakeFlags,
	fakeSession as session,
	fakeTickets,
	planAnswer as answer,
	planItem as item,
	planTicket as ticket
} from '$lib/test/day-plan-fake';
import { fakePins, pinOf } from '$lib/test/fake-pins';
import {
	AUTO_SYNC_DELAY_MS,
	DayPlanEntryStore,
	DayPlanStore,
	type DayPlanLive,
	type DayPlanTickets
} from './day-plan.svelte';
import { DayPlanSortStore } from './day-plan-sort.svelte';
import type { FlagSink } from './flags.svelte';
import { PinStore } from './pins.svelte';
import type { LiveSource } from './realtime';
import { TicketListStore } from './ticket-list.svelte';

async function loaded(
	data: ReturnType<typeof fakeData>,
	tickets: DayPlanTickets,
	flags: FlagSink = fakeFlags().flags
) {
	const store = new DayPlanStore(data, tickets, session(), { flags, scope: () => SCOPE });
	store.show(null);
	await vi.waitFor(() => expect(store.state).toBe('ready'));
	return store;
}

const ids = (store: DayPlanStore) => store.rows.map((row) => row.item.ticketId);

afterEach(() => {
	vi.useRealTimers();
});

describe('loading the plan of a day', () => {
	it('asks for the plan of the area and today, then its entries, in the order of the plan', async () => {
		const tickets = fakeTickets([ticket('t000000000000a1'), ticket('t000000000000a2')]);
		const data = fakeData([
			item('item00000000001', 't000000000000a2', 1),
			item('item00000000002', 't000000000000a1', 0)
		]);
		const store = await loaded(data, tickets);
		expect(data.fetch).toHaveBeenCalledWith({ scope: SCOPE, date: null }, expect.anything());
		expect(data.listItems).toHaveBeenCalledWith(PLAN.id, expect.anything());
		expect(ids(store)).toEqual(['t000000000000a1', 't000000000000a2']);
		expect(store.rows[0]?.ticket?.key).toBe('TASK-a1');
		expect(store.progress).toEqual({ done: 0, total: 2 });
		expect(store.editable).toBe(true);
		expect(store.isToday).toBe(true);
	});

	it('shows another day once and keeps a day before read-only: no check mark changes', async () => {
		const tickets = fakeTickets([ticket('t000000000000a1')]);
		const data = fakeData(
			[item('item00000000001', 't000000000000a1', 0)],
			answer({ date: '2031-05-13', editable: false })
		);
		const store = new DayPlanStore(data, tickets, session(), { scope: () => SCOPE });
		store.show('2031-05-13');
		await vi.waitFor(() => expect(store.state).toBe('ready'));
		store.show('2031-05-13');
		expect(data.fetch).toHaveBeenCalledTimes(1);
		expect(data.fetch).toHaveBeenCalledWith(
			{ scope: SCOPE, date: '2031-05-13' },
			expect.anything()
		);
		expect(store.editable).toBe(false);
		await store.toggle('item00000000001');
		expect(data.check).not.toHaveBeenCalled();
		expect(store.suggestions).toEqual([]);
	});

	it('says "missing" before the restart and names a failure with "Erneut versuchen"', async () => {
		const data = fakeData();
		data.fetch.mockResolvedValueOnce({ kind: 'missing' } as never);
		const store = new DayPlanStore(data, fakeTickets([]), session());
		store.show(null);
		await vi.waitFor(() => expect(store.state).toBe('missing'));
		data.fetch.mockRejectedValueOnce(new DataError('network'));
		await store.reload();
		expect(store.state).toBe('error');
		expect(store.error).toBeTruthy();
		await store.reload();
		expect(store.state).toBe('ready');
	});

	it('drops the plan of the old area at once and loads the new one', async () => {
		const tickets = fakeTickets([ticket('t000000000000a1')]);
		const data = fakeData([item('item00000000001', 't000000000000a1', 0)]);
		const store = await loaded(data, tickets);
		data.listItems.mockResolvedValueOnce([]);
		store.rescope();
		expect(store.rows).toEqual([]);
		await vi.waitFor(() => expect(data.fetch).toHaveBeenCalledTimes(2));
	});
});

describe('suggestions and pool, live from the open tickets', () => {
	it('suggests by the rules of the server and follows a change of a ticket at once', async () => {
		const due = ticket('t000000000000a1', { due: TODAY });
		const tickets = fakeTickets([
			due,
			ticket('t000000000000a2', { status: 'in_progress' }),
			ticket('t000000000000a3')
		]);
		const store = await loaded(fakeData(), tickets);
		expect(store.suggestions.map((row) => [row.ticket.id, row.suggestion.reasons])).toEqual([
			['t000000000000a1', ['heute fällig']],
			['t000000000000a2', ['in Arbeit']]
		]);
		tickets.map.set(due.id, { ...due, due: '2031-05-11', updated: '2031-05-14 09:00:00.000Z' });
		expect(store.suggestions[0]?.suggestion.reasons).toEqual(['überfällig seit 11.05.']);
		tickets.map.set(due.id, { ...due, due: null, updated: '2031-05-14 09:00:01.000Z' });
		expect(store.suggestions.map((row) => row.ticket.id)).toEqual(['t000000000000a2']);
	});

	it('treats pins as display only: a pinned ticket due today is suggested, one without a source is not (PL-1)', async () => {
		// The real list store with real pins, as the layout of /tagesplan gets them: the section
		// "Angeheftet" of "Aufgaben" must not take its tickets out of the open ones of the plan.
		const pinnedDue = ticket('t000000000000a1', { due: TODAY });
		const pinnedOnly = ticket('t000000000000a2');
		const plain = ticket('t000000000000a3', { status: 'in_progress' });
		const open = [pinnedDue, pinnedOnly, plain];
		const pins = new PinStore(
			fakePins([pinOf(pinnedDue.id, 1), pinOf(pinnedOnly.id, 2)]).data,
			session()
		);
		const stopPins = pins.start();
		const list = new TicketListStore(
			{
				listOpen: vi.fn(async () => open),
				searchOpen: vi.fn(async () => []),
				setDone: vi.fn(),
				update: vi.fn()
			},
			session(),
			{ now: () => Date.parse(`${TODAY}T10:00:00.000Z`), pins }
		);
		list.loadOpen();
		await vi.waitFor(() => expect(list.pinned).toHaveLength(2));
		const store = await loaded(fakeData(), list);
		expect(store.suggestions.map((row) => [row.ticket.id, row.suggestion.reasons])).toEqual([
			['t000000000000a1', ['heute fällig']],
			['t000000000000a3', ['in Arbeit']]
		]);
		// The pool, too, holds every open ticket of the area, pinned or not.
		expect(store.pool.map((entry) => entry.id).sort()).toEqual(open.map((entry) => entry.id));
		stopPins();
	});

	it('leaves the tickets in the plan out of suggestions and pool', async () => {
		const tickets = fakeTickets([
			ticket('t000000000000a1', { due: TODAY }),
			ticket('t000000000000a2')
		]);
		const store = await loaded(fakeData([item('item00000000001', 't000000000000a1', 0)]), tickets);
		expect(store.suggestions).toEqual([]);
		expect(store.pool.map((entry) => entry.id)).toEqual(['t000000000000a2']);
	});

	it('asks for the plan again once when a ticket of an automatic source appears', async () => {
		vi.useFakeTimers();
		const project = ticket('t000000000000a1');
		const tickets = fakeTickets([project]);
		const data = fakeData();
		const store = new DayPlanStore(data, tickets, session(), { scope: () => SCOPE });
		store.show(null);
		await vi.waitFor(() => expect(store.state).toBe('ready'));
		expect(store.automatic).toEqual([]);
		tickets.map.set(project.id, {
			...project,
			kind: 'ongoing',
			updated: '2031-05-14 09:00:00.000Z'
		});
		expect(store.automatic).toEqual([project.id]);
		store.syncAutomatic();
		store.syncAutomatic();
		await vi.advanceTimersByTimeAsync(AUTO_SYNC_DELAY_MS);
		expect(data.fetch).toHaveBeenCalledTimes(2);
		store.syncAutomatic();
		await vi.advanceTimersByTimeAsync(AUTO_SYNC_DELAY_MS);
		expect(data.fetch).toHaveBeenCalledTimes(2);
	});

	it('adopts chosen suggestions in their order and says how many', async () => {
		const tickets = fakeTickets([
			ticket('t000000000000a1', { due: TODAY }),
			ticket('t000000000000a2', { due: '2031-05-10' }),
			ticket('t000000000000a3', { status: 'in_progress' })
		]);
		const data = fakeData();
		const { flags, last } = fakeFlags();
		const store = await loaded(data, tickets, flags);
		await store.adopt(['t000000000000a3', 't000000000000a1']);
		expect(data.adopt).toHaveBeenCalledWith(SCOPE, ['t000000000000a1', 't000000000000a3']);
		expect(ids(store)).toEqual(['t000000000000a1', 't000000000000a3']);
		expect(last()?.title).toBe('2 Vorschläge übernommen.');
		await store.adoptAll();
		expect(data.adopt).toHaveBeenLastCalledWith(SCOPE, ['t000000000000a2']);
		expect(store.suggestions).toEqual([]);
	});

	it('arranges suggestions and pool like "Aufgaben" and adopts in the order shown (TP-3)', async () => {
		const parent = ticket('t000000000000p1', { status: 'in_progress' });
		const sub = { parentId: parent.id };
		const tickets = fakeTickets([
			ticket('t000000000000s1', { due: TODAY, ...sub }),
			ticket('t000000000000a1', { due: '2031-05-10' }),
			parent,
			ticket('t000000000000s2', { status: 'done', ...sub })
		]);
		const data = fakeData();
		const store = await loaded(data, tickets);
		// The rules rank the overdue one, the sub-task due today and the parent in Arbeit; shown below
		// its parent, the sub-task follows it.
		expect(store.suggestions.map((row) => row.ticket.id)).toEqual([
			't000000000000a1',
			't000000000000s1',
			't000000000000p1'
		]);
		expect(store.suggestionRows.map((row) => [row.entry.ticket.id, row.nested])).toEqual([
			['t000000000000a1', false],
			['t000000000000p1', false],
			['t000000000000s1', true]
		]);
		expect(store.arrange(store.pool, (entry) => entry).map((row) => row.entry.id)).toEqual([
			't000000000000a1',
			't000000000000p1',
			't000000000000s1'
		]);
		// The chip of the parent counts the done sub-task as well.
		expect(store.progressOf(parent.id)).toEqual({ done: 1, total: 2 });
		await store.adoptAll();
		expect(data.adopt).toHaveBeenCalledWith(SCOPE, [
			't000000000000a1',
			't000000000000p1',
			't000000000000s1'
		]);
		expect(ids(store)).toEqual(['t000000000000a1', 't000000000000p1', 't000000000000s1']);
	});

	it('puts a ticket of the pool at a place and reads the positions again', async () => {
		const tickets = fakeTickets([ticket('t000000000000a1'), ticket('t000000000000a2')]);
		const data = fakeData([item('item00000000001', 't000000000000a1', 0)]);
		const store = await loaded(data, tickets);
		await store.add('t000000000000a2', 0);
		expect(data.add).toHaveBeenCalledWith({
			ticket: 't000000000000a2',
			scope: SCOPE,
			date: TODAY,
			index: 0
		});
		expect(data.listItems).toHaveBeenCalledTimes(2);
		expect(store.announcement).toBe('TASK-a2 im Tagesplan.');
	});
});

describe('check marks', () => {
	it('completes a task; "Rückgängig" opens it again with the status before', async () => {
		const tickets = fakeTickets([ticket('t000000000000a1', { status: 'in_progress' })]);
		const data = fakeData([item('item00000000001', 't000000000000a1', 0)]);
		const { flags, last } = fakeFlags();
		const store = await loaded(data, tickets, flags);
		await store.toggle('item00000000001');
		expect(data.check).toHaveBeenCalledWith('item00000000001', 'check', null);
		expect(store.rows[0]?.done).toBe(true);
		expect(store.progress).toEqual({ done: 1, total: 1 });
		const flag = last();
		expect(flag?.title).toBe('TASK-a1 erledigt.');
		expect(flag?.action?.label).toBe('Rückgängig');
		await flag?.action?.run();
		await vi.waitFor(() =>
			expect(data.uncheck).toHaveBeenCalledWith('item00000000001', {
				action: 'complete',
				status: 'in_progress'
			})
		);
	});

	it('checks an ongoing project for the day; "Rückgängig" takes only the mark of the day back', async () => {
		const tickets = fakeTickets([ticket('t000000000000a1', { kind: 'ongoing' })]);
		const data = fakeData(
			[item('item00000000001', 't000000000000a1', 0, { origin: 'ongoing', addedBy: '' })],
			answer(),
			['t000000000000a1']
		);
		const { flags, last } = fakeFlags();
		const store = await loaded(data, tickets, flags);
		await store.toggle('item00000000001');
		expect(store.rows[0]).toMatchObject({ done: true, kind: 'ongoing' });
		expect(store.rows[0]?.ticket?.status).toBe('open');
		expect(last()?.title).toBe('TASK-a1 für heute abgehakt.');
		await last()?.action?.run();
		await vi.waitFor(() =>
			expect(data.uncheck).toHaveBeenCalledWith('item00000000001', { action: 'today' })
		);
	});

	it('takes a check mark back with the check mark itself', async () => {
		const tickets = fakeTickets([ticket('t000000000000a1')]);
		const data = fakeData([item('item00000000001', 't000000000000a1', 0, { doneToday: true })]);
		const store = await loaded(data, tickets);
		expect(store.rows[0]?.done).toBe(true);
		await store.toggle('item00000000001');
		expect(data.uncheck).toHaveBeenCalledWith('item00000000001', {});
		expect(store.rows[0]?.done).toBe(false);
	});

	it('offers the other way: "Nur für heute abhaken" and "Vorhaben abschließen"', async () => {
		const tickets = fakeTickets([ticket('t000000000000a1')]);
		const data = fakeData([item('item00000000001', 't000000000000a1', 0)]);
		const store = await loaded(data, tickets);
		await store.checkToday('item00000000001');
		expect(data.check).toHaveBeenLastCalledWith('item00000000001', 'today', null);
		await store.complete('item00000000001');
		expect(data.check).toHaveBeenLastCalledWith('item00000000001', 'complete', null);
	});

	it('asks about open blocking sub-tasks like the list and completes with the answer', async () => {
		const tickets = fakeTickets([ticket('t000000000000a1')]);
		const data = fakeData([item('item00000000001', 't000000000000a1', 0)]);
		data.check.mockRejectedValueOnce(
			new DataError('validation', {
				status: 400,
				fields: {
					status: {
						code: 'validation_parent_open_children',
						message: 'x',
						params: { count: 2, keys: ['TASK-7', 'TASK-8'] }
					}
				}
			})
		);
		const store = await loaded(data, tickets);
		await store.toggle('item00000000001');
		expect(store.completion).toMatchObject({
			key: 'TASK-a1',
			count: 2,
			keys: ['TASK-7', 'TASK-8']
		});
		await store.confirmCompletion('complete_children');
		expect(data.check).toHaveBeenLastCalledWith('item00000000001', 'check', 'complete_children');
		expect(store.completion).toBeNull();
	});

	it('names a refusal of the server in an error flag', async () => {
		const tickets = fakeTickets([ticket('t000000000000a1')]);
		const data = fakeData([item('item00000000001', 't000000000000a1', 0)]);
		data.check.mockRejectedValueOnce(
			new DataError('validation', {
				status: 400,
				fields: {
					date: {
						code: 'validation_dayplan_readonly',
						message: 'Vergangene Tage lassen sich nicht mehr ändern.'
					}
				}
			})
		);
		const { flags, last } = fakeFlags();
		const store = await loaded(data, tickets, flags);
		await store.toggle('item00000000001');
		expect(last()).toMatchObject({
			tone: 'error',
			title: 'TASK-a1 konnte nicht abgehakt werden.',
			description: 'Vergangene Tage lassen sich nicht mehr ändern.'
		});
	});
});

describe('changing the plan', () => {
	it('moves an entry to tomorrow and removes one with "Rückgängig" at its place', async () => {
		const tickets = fakeTickets([
			ticket('t000000000000a1'),
			ticket('t000000000000a2'),
			ticket('t000000000000a3')
		]);
		const data = fakeData([
			item('item00000000001', 't000000000000a1', 0),
			item('item00000000002', 't000000000000a2', 1),
			item('item00000000003', 't000000000000a3', 2)
		]);
		const { flags, last } = fakeFlags();
		const store = await loaded(data, tickets, flags);
		await store.moveToTomorrow('item00000000001');
		expect(ids(store)).toEqual(['t000000000000a2', 't000000000000a3']);
		expect(last()?.title).toBe('TASK-a1 auf morgen geschoben.');
		await store.remove('item00000000003');
		expect(ids(store)).toEqual(['t000000000000a2']);
		expect(last()?.title).toBe('TASK-a3 aus dem Tagesplan entfernt.');
		await last()?.action?.run();
		await vi.waitFor(() =>
			expect(data.add).toHaveBeenCalledWith({
				ticket: 't000000000000a3',
				scope: SCOPE,
				date: TODAY,
				index: 1
			})
		);
	});

	it('changes the order at once, up, down and to a place, and sets it back when the server refuses', async () => {
		const tickets = fakeTickets([
			ticket('t000000000000a1'),
			ticket('t000000000000a2'),
			ticket('t000000000000a3')
		]);
		const data = fakeData([
			item('item00000000001', 't000000000000a1', 0),
			item('item00000000002', 't000000000000a2', 1),
			item('item00000000003', 't000000000000a3', 2)
		]);
		const { flags, last } = fakeFlags();
		const store = await loaded(data, tickets, flags);
		expect(await store.moveUp('item00000000001')).toBe(false);
		expect(await store.moveDown('item00000000001')).toBe(true);
		expect(data.move).toHaveBeenLastCalledWith('item00000000001', 1);
		expect(ids(store)).toEqual(['t000000000000a2', 't000000000000a1', 't000000000000a3']);
		expect(store.announcement).toBe('TASK-a1 steht jetzt an Stelle 2 von 3.');
		await store.moveTo('item00000000003', 0);
		expect(ids(store)).toEqual(['t000000000000a3', 't000000000000a2', 't000000000000a1']);
		expect(await store.moveDown('item00000000001')).toBe(false);
		data.move.mockRejectedValueOnce(new DataError('network'));
		await store.moveUp('item00000000001');
		expect(ids(store)).toEqual(['t000000000000a3', 't000000000000a2', 't000000000000a1']);
		expect(last()).toMatchObject({
			tone: 'error',
			title: 'Die Reihenfolge wurde nicht gespeichert.'
		});
	});

	it('marks a ticket as an ongoing project and back; the list store learns it', async () => {
		const tickets = fakeTickets([ticket('t000000000000a1')]);
		const data = fakeData([item('item00000000001', 't000000000000a1', 0)]);
		const { flags, last } = fakeFlags();
		const store = await loaded(data, tickets, flags);
		await store.setKind('t000000000000a1', 'ongoing');
		expect(data.setKind).toHaveBeenCalledWith('t000000000000a1', 'ongoing');
		expect(tickets.upsert).toHaveBeenCalled();
		expect(store.rows[0]?.kind).toBe('ongoing');
		expect(last()?.title).toBe('TASK-a1 ist jetzt ein laufendes Vorhaben.');
	});

	it('saves the mode of a source of the area', async () => {
		const store = await loaded(fakeData(), fakeTickets([]));
		await store.saveSetting('in_progress', 'off');
		expect(store.settings.in_progress).toBe('off');
	});
});

describe('blocks of the plan (TP-4)', () => {
	const A1 = 't000000000000a1';
	const A2 = 't000000000000a2';
	const P = 't000000000000p1';
	const Q = 't000000000000q1';
	const S1 = 't000000000000s1';
	const S2 = 't000000000000s2';
	const T1 = 't000000000000t1';
	const of = (parentId: string) => ({ parentId });
	/** Entries in this order, each named after its ticket: item0000000000a1 for A1 and so on. */
	const entries = (...tickets: string[]) =>
		tickets.map((id, position) => item(`item0000000000${id.slice(-2)}`, id, position));
	const entryOf = (id: string) => `item0000000000${id.slice(-2)}`;
	const family = () =>
		fakeTickets([
			ticket(A1),
			ticket(P),
			ticket(S1, of(P)),
			ticket(S2, of(P)),
			ticket(A2),
			ticket(Q),
			ticket(T1, of(Q))
		]);
	const tp4 = answer({ supportsOrder: true });

	it('moves a parent with its block in one request of the order: up, down and dropped at a place', async () => {
		const data = fakeData(entries(A1, P, S1, S2, A2), tp4);
		const store = await loaded(data, family());
		expect(store.nested).toEqual([false, false, true, true, false]);
		expect(store.blockOf(entryOf(P))).toEqual([entryOf(P), entryOf(S1), entryOf(S2)]);
		expect(store.blockOf(entryOf(S1))).toEqual([entryOf(S1)]);
		expect(store.blockOf(entryOf(A1))).toEqual([entryOf(A1)]);

		expect(await store.moveUp(entryOf(P))).toBe(true);
		// Only the part that changed goes to the server.
		expect(data.order).toHaveBeenLastCalledWith(PLAN.id, [
			entryOf(P),
			entryOf(S1),
			entryOf(S2),
			entryOf(A1)
		]);
		expect(data.move).not.toHaveBeenCalled();
		expect(ids(store)).toEqual([P, S1, S2, A1, A2]);
		expect(store.announcement).toBe('TASK-p1 mit 2 Unteraufgaben an Stelle 1 von 5 verschoben.');
		expect(await store.moveUp(entryOf(P))).toBe(false);

		await store.moveDown(entryOf(P));
		expect(ids(store)).toEqual([A1, P, S1, S2, A2]);
		await store.moveDown(entryOf(P));
		expect(ids(store)).toEqual([A1, A2, P, S1, S2]);
		expect(await store.moveDown(entryOf(P))).toBe(false);
		expect(store.announcement).toBe('TASK-p1 mit 2 Unteraufgaben an Stelle 3 von 5 verschoben.');

		// Dropped before the first entry; dropped into its own block, nothing changes.
		expect(await store.drop(entryOf(P), 4)).toBe(false);
		expect(await store.drop(entryOf(P), 0)).toBe(true);
		expect(ids(store)).toEqual([P, S1, S2, A1, A2]);
		expect(await store.drop(entryOf(P), 5)).toBe(true);
		expect(ids(store)).toEqual([A1, A2, P, S1, S2]);
		expect(data.order).toHaveBeenCalledTimes(5);
	});

	it('moves a sub-task alone, also out of its block; the block follows the new order', async () => {
		const data = fakeData(entries(A1, P, S1, S2, A2), tp4);
		const store = await loaded(data, family());
		expect(await store.moveDown(entryOf(S2))).toBe(true);
		expect(data.move).toHaveBeenLastCalledWith(entryOf(S2), 4);
		expect(data.order).not.toHaveBeenCalled();
		expect(ids(store)).toEqual([A1, P, S1, A2, S2]);
		expect(store.announcement).toBe('TASK-s2 steht jetzt an Stelle 5 von 5.');
		expect(store.blockOf(entryOf(P))).toEqual([entryOf(P), entryOf(S1)]);
		// A parent without a sub-task below it moves alone as well.
		await store.drop(entryOf(S1), 5);
		expect(ids(store)).toEqual([A1, P, A2, S2, S1]);
		expect(store.blockOf(entryOf(P))).toEqual([entryOf(P)]);
		await store.moveUp(entryOf(P));
		expect(data.move).toHaveBeenLastCalledWith(entryOf(P), 0);
	});

	it('takes a block past the whole block next to it, so neither is torn apart', async () => {
		const data = fakeData(entries(Q, T1, P, S1, S2), tp4);
		const store = await loaded(data, family());
		await store.moveUp(entryOf(P));
		expect(ids(store)).toEqual([P, S1, S2, Q, T1]);
		await store.moveDown(entryOf(P));
		expect(ids(store)).toEqual([Q, T1, P, S1, S2]);
		expect(store.nested).toEqual([false, true, false, true, true]);
	});

	it('sets the block back and says so when the server refuses', async () => {
		const data = fakeData(entries(A1, P, S1, S2, A2), tp4);
		const { flags, last } = fakeFlags();
		const store = await loaded(data, family(), flags);
		data.order.mockRejectedValueOnce(new DataError('network'));
		expect(await store.moveUp(entryOf(P))).toBe(false);
		expect(ids(store)).toEqual([A1, P, S1, S2, A2]);
		expect(last()).toMatchObject({
			tone: 'error',
			title: 'Die Reihenfolge wurde nicht gespeichert.'
		});
		expect(store.isPending(entryOf(S1))).toBe(false);
	});

	it('moves a parent alone like before while the server does not know the order (before its restart)', async () => {
		const data = fakeData(entries(A1, P, S1, S2, A2));
		const store = await loaded(data, family());
		expect(store.nested).toEqual([false, false, true, true, false]);
		expect(store.blockOf(entryOf(P))).toEqual([entryOf(P)]);
		expect(await store.moveUp(entryOf(P))).toBe(true);
		expect(data.move).toHaveBeenLastCalledWith(entryOf(P), 0);
		expect(data.order).not.toHaveBeenCalled();
		expect(ids(store)).toEqual([P, A1, S1, S2, A2]);
		expect(store.announcement).toBe('TASK-p1 steht jetzt an Stelle 1 von 5.');
	});

	it('takes the places of add and adopt from the answer of the server', async () => {
		// The server puts a sub-task directly after its parent (the rule of the hook is tested there).
		const place = (ticketId: string, list: readonly DayPlanItem[]) => {
			const parent = list.findIndex((entry) => entry.ticketId === P);
			return ticketId.startsWith('t000000000000s') && parent !== -1 ? parent + 1 : list.length;
		};
		// S2 due today: a suggestion to adopt.
		const tickets = fakeTickets([
			ticket(A1),
			ticket(P),
			ticket(S1, of(P)),
			ticket(S2, { ...of(P), due: TODAY }),
			ticket(A2)
		]);
		const data = fakeData(entries(A1, P, A2), tp4, [], place);
		const store = await loaded(data, tickets);
		await store.add(S1);
		expect(ids(store)).toEqual([A1, P, S1, A2]);
		expect(store.nested).toEqual([false, false, true, false]);
		await store.adopt([S2]);
		expect(ids(store)).toEqual([A1, P, S2, S1, A2]);
		// The answers named every place: the entries were not read again.
		expect(data.listItems).toHaveBeenCalledTimes(1);
	});

	it('keeps to the end and reads the places of a drop again without positions in the answer', async () => {
		const data = fakeData(entries(A1, P, A2));
		const store = await loaded(data, family());
		await store.add(S1);
		expect(ids(store)).toEqual([A1, P, A2, S1]);
		expect(data.listItems).toHaveBeenCalledTimes(1);
		await store.add(S2, 0);
		await vi.waitFor(() => expect(ids(store)).toEqual([S2, A1, P, A2, S1]));
		expect(data.listItems).toHaveBeenCalledTimes(2);
	});
});

describe('sorting the plan (TP-5)', () => {
	const A1 = 't000000000000a1';
	const A2 = 't000000000000a2';
	const D1 = 't000000000000d1';
	const P = 't000000000000p1';
	const S1 = 't000000000000s1';
	const S2 = 't000000000000s2';
	const HOUSE = 'h:house0000000001';
	const entryOf = (id: string) => `item0000000000${id.slice(-2)}`;
	/** Manual order: S2, A1, P, D1 (checked for today), S1, A2. */
	const entries = () => [
		item(entryOf(S2), S2, 0),
		item(entryOf(A1), A1, 1),
		item(entryOf(P), P, 2),
		item(entryOf(D1), D1, 3, { doneToday: true }),
		item(entryOf(S1), S1, 4),
		item(entryOf(A2), A2, 5)
	];
	const family = () =>
		fakeTickets([
			ticket(A1, { priority: 'low', title: 'Zelt' }),
			ticket(A2, { priority: 'urgent', title: 'Brief' }),
			ticket(D1, { priority: 'urgent', title: 'Anruf' }),
			ticket(P, { priority: 'medium', title: 'Wochenputz' }),
			ticket(S1, { priority: 'urgent', title: 'Fenster', parentId: P }),
			ticket(S2, { priority: 'high', title: 'Bad', parentId: P })
		]);
	const tp4 = answer({ supportsOrder: true });
	const shownIds = (store: DayPlanStore) =>
		store.shown.map(({ entry, nested }) => `${nested ? '  ' : ''}${entry.item.ticketId}`);

	async function sortable(
		data: ReturnType<typeof fakeData>,
		tickets: DayPlanTickets = family(),
		flags: FlagSink = fakeFlags().flags
	) {
		const sorting = new DayPlanSortStore();
		const store = new DayPlanStore(data, tickets, session(), {
			flags,
			scope: () => SCOPE,
			sorting
		});
		store.show(null);
		await vi.waitFor(() => expect(store.state).toBe('ready'));
		return { store, sorting };
	}

	it('shows the plan sorted as a view: the stored order stays and nothing moves (S1, S3)', async () => {
		const data = fakeData(entries(), tp4);
		const { store, sorting } = await sortable(data);
		expect(store.sorted).toBe(false);
		// "Manuell" indents only directly below the parent (TP-3): none here.
		expect(shownIds(store)).toEqual([S2, A1, P, D1, S1, A2]);

		store.setSort({ key: 'priority', direction: 'descending' });
		expect(sorting.sort).toEqual({ key: 'priority', direction: 'descending' });
		expect(store.sorted).toBe(true);
		// The parent with both sub-tasks as a unit (by the parent), the entry checked for today last.
		expect(shownIds(store)).toEqual([A2, P, `  ${S1}`, `  ${S2}`, A1, D1]);
		expect(store.announcement).toBe('Sortiert nach Priorität, absteigend: Dringende zuerst.');
		// The stored order is the same, and no way of moving changes it.
		expect(ids(store)).toEqual([S2, A1, P, D1, S1, A2]);
		expect(await store.moveUp(entryOf(A2))).toBe(false);
		expect(await store.moveDown(entryOf(S2))).toBe(false);
		expect(await store.drop(entryOf(A2), 0)).toBe(false);
		expect(await store.moveTo(entryOf(A1), 0)).toBe(false);
		expect(data.move).not.toHaveBeenCalled();
		expect(data.order).not.toHaveBeenCalled();

		store.setSort({ key: 'priority', direction: 'ascending' });
		expect(shownIds(store)).toEqual([A1, P, `  ${S2}`, `  ${S1}`, A2, D1]);

		// Back to "Manuell": the order of before at once, moving works again.
		store.setSort({ key: 'manual', direction: 'ascending' });
		expect(store.announcement).toBe('Manuelle Reihenfolge.');
		expect(shownIds(store)).toEqual([S2, A1, P, D1, S1, A2]);
		expect(await store.moveUp(entryOf(A1))).toBe(true);
		expect(data.move).toHaveBeenCalledWith(entryOf(A1), 0);
	});

	it('follows a check mark at once in the sorted plan: the entry goes to the end', async () => {
		const data = fakeData(entries(), tp4);
		const { store } = await sortable(data);
		store.setSort({ key: 'title', direction: 'ascending' });
		// Open: Brief, Wochenputz (Bad, Fenster below), Zelt; checked: Anruf.
		expect(shownIds(store)).toEqual([A2, P, `  ${S2}`, `  ${S1}`, A1, D1]);
		await store.toggle(entryOf(A2));
		expect(shownIds(store)).toEqual([P, `  ${S2}`, `  ${S1}`, A1, D1, A2]);
	});

	it('sorts by "Zuständigkeit" only in a household, by the names of the accounts, and "Projekt" through the catalog', async () => {
		const context = {
			selfId: 'user00000000001',
			selfName: 'Anna Beispiel',
			names: { nameOf: (id: string) => ({ user00000000002: 'Bert Beispiel' })[id] ?? null }
		};
		const house = { id: 'p00000000000001', name: 'Haus', code: 'HAUS', archived: false };
		const car = { id: 'p00000000000002', name: 'Auto', code: 'AUTO', archived: false };
		const tickets = Object.assign(
			fakeTickets([
				ticket(A1, { assignee: 'user00000000002', projectId: house.id, project: car }),
				ticket(A2, { assignee: 'user00000000001', projectId: car.id, project: house }),
				ticket(P)
			]),
			{
				assigneeContext: context,
				// The catalog knows the projects under other names than the expanded ones.
				projectOf: (entry: TicketSummary) =>
					entry.projectId === house.id ? house : entry.projectId === car.id ? car : null
			}
		);
		const items = [item(entryOf(P), P, 0), item(entryOf(A1), A1, 1), item(entryOf(A2), A2, 2)];
		const shared = answer({ scope: HOUSE, plan: { ...PLAN, scope: HOUSE } });
		const { store } = await sortable(fakeData(items, shared), tickets);
		expect(store.household).toBe(true);
		store.setSort({ key: 'assignee', direction: 'ascending' });
		// Anna before Bert, nobody last.
		expect(shownIds(store)).toEqual([A2, A1, P]);
		store.setSort({ key: 'project', direction: 'ascending' });
		// Auto (A2) before Haus (A1) as the catalog names them, no project last.
		expect(shownIds(store)).toEqual([A2, A1, P]);

		// Privately nobody is assigned: the choice applies as "Manuell" and stays for the household.
		const own = await sortable(fakeData(items), tickets);
		own.store.setSort({ key: 'assignee', direction: 'ascending' });
		expect(own.sorting.sort.key).toBe('assignee');
		expect(own.store.sort.key).toBe('manual');
		expect(own.store.sorted).toBe(false);
		expect(shownIds(own.store)).toEqual([P, A1, A2]);
	});

	it('adopts the order shown as the manual one in one request, then shows "Manuell"; "Rückgängig" puts the order of before back (S4)', async () => {
		const data = fakeData(entries(), tp4);
		const { flags, last } = fakeFlags();
		const { store, sorting } = await sortable(data, family(), flags);
		store.setSort({ key: 'priority', direction: 'descending' });
		expect(store.canAdoptOrder).toBe(true);
		expect(await store.adoptOrder()).toBe(true);
		// The whole plan in the order shown.
		expect(data.order).toHaveBeenCalledWith(
			PLAN.id,
			[A2, P, S1, S2, A1, D1].map((id) => entryOf(id))
		);
		expect(ids(store)).toEqual([A2, P, S1, S2, A1, D1]);
		expect(store.sort.key).toBe('manual');
		expect(sorting.sort.key).toBe('manual');
		expect(shownIds(store)).toEqual([A2, P, `  ${S1}`, `  ${S2}`, A1, D1]);
		expect(store.announcement).toBe('Als manuelle Reihenfolge übernommen. Sortierung: Manuell.');
		const flag = last();
		expect(flag).toMatchObject({ tone: 'success', title: 'Als manuelle Reihenfolge übernommen.' });
		expect(flag?.action?.label).toBe('Rückgängig');

		flag?.action?.run();
		await vi.waitFor(() =>
			expect(last()).toMatchObject({
				tone: 'success',
				title: 'Vorherige Reihenfolge wiederhergestellt.'
			})
		);
		expect(ids(store)).toEqual([S2, A1, P, D1, S1, A2]);
		expect(data.order).toHaveBeenLastCalledWith(
			PLAN.id,
			[S2, A1, P, D1, S1, A2].map((id) => entryOf(id))
		);
		expect(store.announcement).toBe('Vorherige Reihenfolge wiederhergestellt.');
		expect(store.sort.key).toBe('manual');
	});

	it('"Rückgängig" leaves out an entry removed meanwhile; one added meanwhile keeps its place', async () => {
		const data = fakeData(entries(), tp4);
		const { flags, shown } = fakeFlags();
		const { store } = await sortable(data, family(), flags);
		store.setSort({ key: 'priority', direction: 'descending' });
		await store.adoptOrder();
		const undo = shown.find((entry) => entry.title === 'Als manuelle Reihenfolge übernommen.');
		await store.remove(entryOf(A1));
		await store.add('t000000000000n1');
		expect(ids(store)).toEqual([A2, P, S1, S2, D1, 't000000000000n1']);
		undo?.action?.run();
		await vi.waitFor(() =>
			expect(data.order).toHaveBeenLastCalledWith(
				PLAN.id,
				[S2, P, D1, S1, A2].map((id) => entryOf(id))
			)
		);
		await vi.waitFor(() => expect(ids(store)).toEqual([S2, P, D1, S1, A2, 't000000000000n1']));
	});

	it('sets the order back and stays sorted when the server refuses, and so does "Rückgängig"', async () => {
		const data = fakeData(entries(), tp4);
		const { flags, last } = fakeFlags();
		const { store } = await sortable(data, family(), flags);
		store.setSort({ key: 'title', direction: 'ascending' });
		data.order.mockRejectedValueOnce(new DataError('network'));
		expect(await store.adoptOrder()).toBe(false);
		expect(ids(store)).toEqual([S2, A1, P, D1, S1, A2]);
		expect(store.sort).toEqual({ key: 'title', direction: 'ascending' });
		expect(store.adopting).toBe(false);
		expect(last()).toMatchObject({
			tone: 'error',
			title: 'Die Reihenfolge wurde nicht übernommen.'
		});

		expect(await store.adoptOrder()).toBe(true);
		const adopted = [A2, P, S2, S1, A1, D1];
		expect(ids(store)).toEqual(adopted);
		const undo = last()?.action;
		data.order.mockRejectedValueOnce(new DataError('network'));
		undo?.run();
		await vi.waitFor(() =>
			expect(last()).toMatchObject({
				tone: 'error',
				title: 'Die vorherige Reihenfolge wurde nicht wiederhergestellt.'
			})
		);
		expect(ids(store)).toEqual(adopted);
	});

	it('offers "Als manuelle Reihenfolge übernehmen" only sorted, in a plan that can change, with two entries and the route of the order', async () => {
		const sorted = { key: 'priority', direction: 'descending' } as const;
		// Manual: nothing to adopt.
		const manual = await sortable(fakeData(entries(), tp4));
		expect(manual.store.canAdoptOrder).toBe(false);
		// Before the restart after TP-4 the server does not know the route.
		const before = await sortable(fakeData(entries()));
		before.store.setSort(sorted);
		expect(before.store.canAdoptOrder).toBe(false);
		expect(await before.store.adoptOrder()).toBe(false);
		// A day before is read-only.
		const old = await sortable(
			fakeData(entries(), answer({ supportsOrder: true, date: '2031-05-13', editable: false }))
		);
		old.store.setSort(sorted);
		expect(old.store.sorted).toBe(true);
		expect(old.store.canAdoptOrder).toBe(false);
		// One entry has no other order.
		const one = await sortable(fakeData([item(entryOf(A1), A1, 0)], tp4));
		one.store.setSort(sorted);
		expect(one.store.canAdoptOrder).toBe(false);
		for (const data of [before, old, one]) expect(await data.store.adoptOrder()).toBe(false);
	});
});

describe('realtime', () => {
	function fakeLiveSources() {
		let onItem: ((change: RecordChange<DayPlanItem>) => void) | null = null;
		let onPlan: ((change: RecordChange<DayPlanMeta>) => void) | null = null;
		let onTicket: ((change: RecordChange<TicketSummary>) => void) | null = null;
		let onSettings: ((change: RecordChange<DayPlanSettingsRecord>) => void) | null = null;
		const live = {
			items: vi.fn(async (_id: string, callback: (change: RecordChange<DayPlanItem>) => void) => {
				onItem = callback;
				return async () => undefined;
			}),
			plan: vi.fn(async (_id: string, callback: (change: RecordChange<DayPlanMeta>) => void) => {
				onPlan = callback;
				return async () => undefined;
			}),
			settings: vi.fn(
				async (_scope: string, callback: (change: RecordChange<DayPlanSettingsRecord>) => void) => {
					onSettings = callback;
					return async () => undefined;
				}
			)
		} satisfies DayPlanLive;
		const tickets = {
			tickets: vi.fn(async (callback: (change: RecordChange<TicketSummary>) => void) => {
				onTicket = callback;
				return async () => undefined;
			}),
			reconnected: vi.fn(async () => async () => undefined)
		} as unknown as LiveSource;
		return {
			live,
			tickets,
			item: (change: RecordChange<DayPlanItem>) => onItem?.(change),
			plan: (change: RecordChange<DayPlanMeta>) => onPlan?.(change),
			ticket: (change: RecordChange<TicketSummary>) => onTicket?.(change),
			settings: (change: RecordChange<DayPlanSettingsRecord>) => onSettings?.(change)
		};
	}

	it('follows the settings of the area changed in another tab or by another member (PL-1)', async () => {
		vi.useFakeTimers();
		const working = ticket('t000000000000a1', { status: 'in_progress' });
		const data = fakeData();
		const store = await loaded(data, fakeTickets([working]));
		const sources = fakeLiveSources();
		const stop = store.connect(sources.tickets, sources.live);
		await vi.waitFor(() =>
			expect(sources.live.settings).toHaveBeenCalledWith(SCOPE, expect.any(Function))
		);
		expect(store.suggestions.map((row) => row.ticket.id)).toEqual([working.id]);
		const settings = (mode: SourceMode) => ({ ...DEFAULT_SOURCES, in_progress: mode });

		sources.settings({
			action: 'update',
			record: { id: 'sett00000000001', scope: SCOPE, settings: settings('off') }
		});
		expect(store.settings.in_progress).toBe('off');
		expect(store.suggestions).toEqual([]);
		// The settings of another area are not those of this plan.
		sources.settings({
			action: 'update',
			record: { id: 'sett00000000002', scope: 'h:house0000000001', settings: settings('auto') }
		});
		expect(store.settings.in_progress).toBe('off');

		// Switched to "Automatisch übernehmen": the server is asked to take the ticket in.
		sources.settings({
			action: 'update',
			record: { id: 'sett00000000001', scope: SCOPE, settings: settings('auto') }
		});
		expect(store.automatic).toEqual([working.id]);
		await vi.advanceTimersByTimeAsync(AUTO_SYNC_DELAY_MS);
		expect(data.fetch).toHaveBeenCalledTimes(2);
		stop();
	});

	it('follows the entries and the plan of the shown day, and the tickets of its entries', async () => {
		const tickets = fakeTickets([ticket('t000000000000a1'), ticket('t000000000000a2')]);
		const data = fakeData([item('item00000000001', 't000000000000a1', 0)]);
		const store = await loaded(data, tickets);
		const sources = fakeLiveSources();
		const stop = store.connect(sources.tickets, sources.live);
		await vi.waitFor(() =>
			expect(sources.live.items).toHaveBeenCalledWith(PLAN.id, expect.any(Function))
		);
		sources.item({
			action: 'create',
			record: item('item00000000002', 't000000000000a2', 1, { addedBy: 'user00000000002' })
		});
		expect(ids(store)).toEqual(['t000000000000a1', 't000000000000a2']);
		sources.item({
			action: 'update',
			record: item('item00000000002', 't000000000000a2', 1, {
				doneToday: true,
				updated: '2031-05-14 11:00:00.000Z'
			})
		});
		expect(store.rows[1]?.done).toBe(true);
		sources.item({ action: 'delete', id: 'item00000000001' });
		expect(ids(store)).toEqual(['t000000000000a2']);
		sources.plan({ action: 'update', record: { ...PLAN, dismissed: ['t000000000000a1'] } });
		expect(store.plan?.dismissed).toEqual(['t000000000000a1']);
		// A ticket of the plan done elsewhere: the plan shows it done, though the list drops it.
		sources.ticket({
			action: 'update',
			record: ticket('t000000000000a2', { status: 'done', updated: '2031-05-14 12:00:00.000Z' })
		});
		tickets.map.delete('t000000000000a2');
		expect(store.rows[0]?.ticket?.status).toBe('done');
		stop();
	});
});

describe('"Zum Tagesplan" in the menus of a ticket', () => {
	it('puts the ticket into the plan of today of its area and offers the way to the plan', async () => {
		const add = vi.fn(async () => ({
			item: item('item00000000001', 't000000000000a1', 0),
			plan: PLAN,
			already: false,
			positions: null
		}));
		const open = vi.fn();
		const { flags, last } = fakeFlags();
		const store = new DayPlanEntryStore({ add }, session(), flags, open);
		await store.add({ id: 't000000000000a1', key: 'TASK-a1' });
		expect(add).toHaveBeenCalledWith('t000000000000a1');
		expect(last()?.title).toBe('TASK-a1 im Tagesplan von heute.');
		expect(last()?.action?.label).toBe('Tagesplan öffnen');
		await last()?.action?.run();
		expect(open).toHaveBeenCalled();
		add.mockResolvedValueOnce({
			item: item('item00000000001', 't000000000000a1', 0),
			plan: PLAN,
			already: true,
			positions: null
		});
		await store.add({ id: 't000000000000a1', key: 'TASK-a1' });
		expect(last()?.title).toBe('TASK-a1 steht schon im Tagesplan.');
		add.mockRejectedValueOnce(
			new DataError('validation', {
				status: 400,
				fields: {
					ticket: {
						code: 'validation_dayplan_ticket_done',
						message: 'Erledigte Tickets kommen nicht in den Tagesplan.'
					}
				}
			})
		);
		await store.add({ id: 't000000000000a1', key: 'TASK-a1' });
		expect(last()).toMatchObject({
			tone: 'error',
			title: 'TASK-a1 kam nicht in den Tagesplan.',
			description: 'Erledigte Tickets kommen nicht in den Tagesplan.'
		});
	});
});
