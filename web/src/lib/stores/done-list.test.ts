// Store of the view "Erledigte" (ER-1, ADR-0066) with a fake data layer: pages and their number,
// the filters of the address (a search after its pause, sub projects of the catalog), the area of
// the tab, realtime (completed elsewhere at the top, reopened ones leave, a search asks the server),
// the reconciliation after a gap and "Wieder öffnen" with "Rückgängig" and the way out of a series.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DataError } from '$lib/data/errors';
import { EMPTY_DONE_QUERY, type DoneQuery } from '$lib/domain/done-view';
import type { TicketSummary } from '$lib/domain/ticket';
import { ANSWERED, doneTicket, fakeDoneData, fakeDoneLive } from '$lib/test/done-list-fake';
import { DoneListStore, doneAnnouncement } from './done-list.svelte';
import { FlagStore } from './flags.svelte';
import { SEARCH_DEBOUNCE_MS } from './ticket-list.svelte';

const TODAY = '2026-10-07';
const PROJECT = 'proj00000000001';
const GARDEN = 'proj00000000011';

const query = (overrides: Partial<DoneQuery> = {}): DoneQuery => ({
	...EMPTY_DONE_QUERY,
	...overrides
});

function session(valid = true) {
	return { ensureValid: vi.fn(() => valid), logout: vi.fn() };
}

function storeOf(
	data: ReturnType<typeof fakeDoneData>,
	options: { children?: () => string[]; guard?: ReturnType<typeof session> } = {}
) {
	const flags = new FlagStore();
	const open = { upsert: vi.fn<(ticket: TicketSummary) => void>() };
	const store = new DoneListStore(data, options.guard ?? session(), {
		today: () => TODAY,
		subProjectsOf: (id) => (id === PROJECT ? (options.children?.() ?? []) : []),
		flags,
		open
	});
	return { store, flags, open };
}

async function settle() {
	await vi.advanceTimersByTimeAsync(0);
}

const ids = (tickets: readonly TicketSummary[]) => tickets.map((ticket) => ticket.id);

beforeEach(() => {
	vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
	vi.setSystemTime(Date.UTC(2026, 9, 7, 10));
});

afterEach(() => {
	vi.useRealTimers();
});

describe('loading page by page', () => {
	it('loads the first page with the filters, groups it and knows the number on all pages', async () => {
		const today = doneTicket('2026-10-07 08:00:00.000Z');
		const yesterday = doneTicket('2026-10-06 08:00:00.000Z');
		const september = doneTicket('2026-09-15 08:00:00.000Z');
		const data = fakeDoneData([[today, yesterday], [september]], 3);
		const { store } = storeOf(data);

		expect(store.state).toBe('idle');
		store.show(query({ tag: 'tag000000000001' }));
		expect(store.state).toBe('loading');
		await settle();

		expect(store.state).toBe('ready');
		expect(data.list).toHaveBeenCalledExactlyOnceWith(1, {
			signal: expect.any(AbortSignal),
			filter: { query: query({ tag: 'tag000000000001' }) }
		});
		expect(ids(store.tickets)).toEqual([today.id, yesterday.id]);
		expect(store.groups.map((group) => [group.label, ids(group.tickets)])).toEqual([
			['Heute', [today.id]],
			['Gestern', [yesterday.id]]
		]);
		expect(store.total).toBe(3);
		expect(store.hasMore).toBe(true);
	});

	it('loads the next page once at a time and stops after the last', async () => {
		const first = doneTicket('2026-10-07 08:00:00.000Z');
		const second = doneTicket('2026-09-20 08:00:00.000Z');
		const data = fakeDoneData([[first], [second]]);
		const { store } = storeOf(data);
		store.show(EMPTY_DONE_QUERY);
		await settle();

		const loading = store.loadMore();
		expect(store.loadingMore).toBe(true);
		await store.loadMore();
		await loading;

		expect(data.list).toHaveBeenCalledTimes(2);
		expect(data.list).toHaveBeenLastCalledWith(2, expect.anything());
		expect(ids(store.tickets)).toEqual([first.id, second.id]);
		expect(store.groups.map((group) => group.label)).toEqual(['Heute', 'September 2026']);
		expect(store.hasMore).toBe(false);
		expect(store.announcement).toBe('1 weitere geladen, 2 von 2 angezeigt.');
		await store.loadMore();
		expect(data.list).toHaveBeenCalledTimes(2);
	});

	it('shows a failure of the first page with a way to try again, keeps the pages on a later one', async () => {
		const first = doneTicket('2026-10-07 08:00:00.000Z');
		const data = fakeDoneData([[first], [doneTicket('2026-09-20 08:00:00.000Z')]]);
		data.list.mockRejectedValueOnce(new DataError('network'));
		const { store } = storeOf(data);

		store.show(EMPTY_DONE_QUERY);
		await settle();
		expect(store.state).toBe('error');
		expect(store.error).toMatch(/Server nicht erreichbar/);

		await store.reload();
		expect(store.state).toBe('ready');
		data.list.mockRejectedValueOnce(new DataError('network'));
		await store.loadMore();
		expect(store.moreError).toMatch(/Server nicht erreichbar/);
		expect(ids(store.tickets)).toEqual([first.id]);
		expect(store.state).toBe('ready');
	});

	it('ends the session on a session error and asks nothing without a valid session', async () => {
		const data = fakeDoneData([[]]);
		data.list.mockRejectedValueOnce(new DataError('session'));
		const guard = session();
		const { store } = storeOf(data, { guard });
		store.show(EMPTY_DONE_QUERY);
		await settle();
		expect(guard.logout).toHaveBeenCalledOnce();
		expect(store.error).toBeNull();

		const invalid = fakeDoneData([[]]);
		storeOf(invalid, { guard: session(false) }).store.show(EMPTY_DONE_QUERY);
		expect(invalid.list).not.toHaveBeenCalled();
	});
});

describe('filters', () => {
	it('loads page 1 again for other filters, aborts a stale request and announces the number', async () => {
		const data = fakeDoneData([[doneTicket('2026-10-07 08:00:00.000Z')]], 1);
		const { store } = storeOf(data);
		store.show(EMPTY_DONE_QUERY);
		await settle();
		expect(store.announcement).toBe('');

		store.show(query({ charm: 'auto' }));
		store.show(query({ charm: 'zug' }));
		await settle();

		expect(data.list).toHaveBeenCalledTimes(3);
		expect(data.list.mock.calls[1]?.[1].signal?.aborted).toBe(true);
		expect(data.list.mock.calls[2]?.[1].filter.query.charm).toBe('zug');
		expect(store.announcement).toBe('1 erledigtes Ticket.');
		// The same filters again: nothing is loaded.
		store.show(query({ charm: 'zug' }));
		expect(data.list).toHaveBeenCalledTimes(3);
		expect(doneAnnouncement(0)).toBe('Keine erledigten Tickets für diese Filter.');
	});

	it('waits for the pause after the last key of a search, then asks once', async () => {
		const data = fakeDoneData([[]]);
		const { store } = storeOf(data);
		store.show(EMPTY_DONE_QUERY);
		await settle();

		store.show(query({ search: 'Mi' }));
		store.show(query({ search: 'Mie' }));
		await settle();
		expect(data.list).toHaveBeenCalledOnce();
		await vi.advanceTimersByTimeAsync(SEARCH_DEBOUNCE_MS);

		expect(data.list).toHaveBeenCalledTimes(2);
		expect(data.list.mock.calls[1]?.[1].filter.query.search).toBe('Mie');
		// The same search again asks nothing; back to one character the search ends at once.
		store.show(query({ search: 'Mie', tag: null }));
		expect(data.list).toHaveBeenCalledTimes(2);
		store.show(query({ search: 'M' }));
		await vi.advanceTimersByTimeAsync(SEARCH_DEBOUNCE_MS);
		expect(data.list).toHaveBeenCalledTimes(3);
		expect(data.list.mock.calls[2]?.[1].filter.query.search).toBe('M');
	});

	it('asks the server for the sub projects and loads again when the catalog learns one', async () => {
		const data = fakeDoneData([[]]);
		let children: string[] = [];
		const { store } = storeOf(data, { children: () => children });
		store.show(query({ project: PROJECT }));
		await settle();
		expect(data.list.mock.calls[0]?.[1].filter).toEqual({ query: query({ project: PROJECT }) });

		children = [GARDEN];
		store.followSubProjects();
		await settle();
		expect(data.list).toHaveBeenCalledTimes(2);
		expect(data.list.mock.calls[1]?.[1].filter).toEqual({
			query: query({ project: PROJECT }),
			withSubProjects: true
		});
		store.followSubProjects();
		expect(data.list).toHaveBeenCalledTimes(2);

		store.show(query({ project: PROJECT, subProjects: false }));
		await settle();
		expect(data.list.mock.calls[2]?.[1].filter).toEqual({
			query: query({ project: PROJECT, subProjects: false })
		});
	});
});

describe('area of the tab (ADR-0059)', () => {
	it('drops the done tickets of the old area and loads those of the new one for the same filters', async () => {
		const privat = doneTicket('2026-10-07 08:00:00.000Z', { title: 'Privat' });
		const household = doneTicket('2026-10-07 09:00:00.000Z', { title: 'Haushalt' });
		const data = fakeDoneData([[privat]]);
		const { store } = storeOf(data);
		store.show(query({ charm: 'auto' }));
		await settle();

		data.list.mockResolvedValueOnce({ items: [household], page: 1, hasMore: false, total: 1 });
		store.rescope();
		expect(store.tickets).toEqual([]);
		expect(store.state).toBe('loading');
		await settle();

		expect(ids(store.tickets)).toEqual([household.id]);
		expect(data.list.mock.calls[1]?.[1].filter.query.charm).toBe('auto');
	});

	it('loads nothing for a view that was never shown', () => {
		const data = fakeDoneData([[]]);
		storeOf(data).store.rescope();
		expect(data.list).not.toHaveBeenCalled();
	});
});

describe('realtime', () => {
	async function connected(pages: TicketSummary[][], total?: number, filters = EMPTY_DONE_QUERY) {
		const data = fakeDoneData(pages, total);
		const context = storeOf(data);
		const live = fakeDoneLive();
		const stop = context.store.connect(live.live);
		context.store.show(filters);
		await settle();
		await vi.waitFor(() => expect(live.live.tickets).toHaveBeenCalled());
		return { ...context, ...live, data, stop };
	}

	it('puts a ticket completed elsewhere at the top and counts it', async () => {
		const older = doneTicket('2026-10-06 08:00:00.000Z');
		const { store, send } = await connected([[older]], 1);

		const fresh = doneTicket('2026-10-07 09:00:00.000Z');
		send({ action: 'update', record: fresh });

		expect(ids(store.tickets)).toEqual([fresh.id, older.id]);
		expect(store.groups[0]?.label).toBe('Heute');
		expect(store.total).toBe(2);
		// A later event of the same ticket replaces it without counting twice.
		send({ action: 'update', record: { ...fresh, title: 'Neu', updated: ANSWERED } });
		expect(store.tickets[0]?.title).toBe('Neu');
		expect(store.total).toBe(2);
		// An older version is ignored.
		send({ action: 'update', record: { ...fresh, title: 'Alt' } });
		expect(store.tickets[0]?.title).toBe('Neu');
	});

	it('lets a reopened, deleted or moved ticket leave at once', async () => {
		const first = doneTicket('2026-10-07 08:00:00.000Z');
		const second = doneTicket('2026-10-06 08:00:00.000Z');
		const third = doneTicket('2026-10-05 08:00:00.000Z');
		const { store, send } = await connected([[first, second, third]], 3);

		send({
			action: 'update',
			record: { ...first, status: 'open', completedAt: null, updated: ANSWERED }
		});
		expect(ids(store.tickets)).toEqual([second.id, third.id]);
		expect(store.total).toBe(2);

		send({ action: 'delete', id: second.id });
		expect(ids(store.tickets)).toEqual([third.id]);
		expect(store.total).toBe(1);
		// An open ticket the view never had changes nothing.
		send({ action: 'update', record: { ...first, id: 'open00000000001', status: 'open' } });
		expect(store.total).toBe(1);
	});

	it('keeps tickets out that the filters do not let through, and lets one leave that no longer passes', async () => {
		const inProject = doneTicket('2026-10-07 08:00:00.000Z', { projectId: PROJECT });
		const { store, send } = await connected([[inProject]], 1, query({ project: PROJECT }));

		send({ action: 'update', record: doneTicket('2026-10-07 09:00:00.000Z') });
		expect(ids(store.tickets)).toEqual([inProject.id]);

		send({ action: 'update', record: { ...inProject, projectId: null, updated: ANSWERED } });
		expect(store.tickets).toEqual([]);
		expect(store.total).toBe(0);
	});

	it('leaves an older ticket beyond the loaded pages to "Mehr laden" and asks for the number', async () => {
		const loaded = doneTicket('2026-10-07 08:00:00.000Z');
		const { store, send, data } = await connected(
			[[loaded], [doneTicket('2026-08-01 08:00:00.000Z')]],
			7
		);
		data.count.mockResolvedValueOnce(8);

		send({ action: 'update', record: doneTicket('2026-07-01 08:00:00.000Z') });
		expect(ids(store.tickets)).toEqual([loaded.id]);
		await vi.advanceTimersByTimeAsync(SEARCH_DEBOUNCE_MS);
		expect(data.count).toHaveBeenCalledOnce();
		expect(store.total).toBe(8);
	});

	it('asks the server whether a ticket of an event matches the search', async () => {
		const { store, send, data } = await connected([[]], 0, query({ search: 'Miete' }));
		data.matches.mockResolvedValueOnce(false);
		const other = doneTicket('2026-10-07 09:00:00.000Z', { title: 'Garten' });
		send({ action: 'update', record: other });
		await settle();
		expect(data.matches).toHaveBeenCalledWith(
			other.id,
			{ query: query({ search: 'Miete' }) },
			{ signal: expect.any(AbortSignal) }
		);
		expect(store.tickets).toEqual([]);

		const hit = doneTicket('2026-10-07 09:30:00.000Z', { title: 'Nebenkosten' });
		send({ action: 'update', record: hit });
		await settle();
		expect(ids(store.tickets)).toEqual([hit.id]);
		expect(store.total).toBe(1);
	});

	it('reconciles the loaded pages after a reconnection without a loading state', async () => {
		const kept = doneTicket('2026-10-07 08:00:00.000Z');
		const gone = doneTicket('2026-10-06 08:00:00.000Z');
		const { store, data, reconnect } = await connected([[kept, gone]], 2);
		const added = doneTicket('2026-10-07 09:00:00.000Z');
		data.list.mockResolvedValueOnce({ items: [added, kept], page: 1, hasMore: false, total: 2 });

		reconnect();
		expect(store.state).toBe('ready');
		await settle();

		expect(ids(store.tickets)).toEqual([added.id, kept.id]);
		expect(store.total).toBe(2);
	});
});

describe('"Wieder öffnen"', () => {
	it('reopens at once, hands the ticket to the open list and offers "Rückgängig"', async () => {
		const ticket = doneTicket('2026-10-06 08:00:00.000Z');
		const data = fakeDoneData([[ticket]], 1);
		const { store, flags, open } = storeOf(data);
		store.show(EMPTY_DONE_QUERY);
		await settle();

		const running = store.reopen(ticket.id);
		expect(store.isPending(ticket.id)).toBe(true);
		await running;

		expect(data.setDone).toHaveBeenCalledWith(ticket.id, false);
		expect(store.tickets).toEqual([]);
		expect(store.total).toBe(0);
		expect(open.upsert).toHaveBeenCalledWith(
			expect.objectContaining({ id: ticket.id, status: 'open' })
		);
		const [flag] = flags.flags;
		expect(flag).toMatchObject({ tone: 'success', title: `${ticket.key} wieder offen.` });
		expect(flag?.action?.label).toBe('Rückgängig');

		flag?.action?.run();
		await vi.waitFor(() => expect(data.setDone).toHaveBeenLastCalledWith(ticket.id, true));
		await settle();
		// Completed again now: the server sets the time, so it stands under "Heute".
		expect(ids(store.tickets)).toEqual([ticket.id]);
		expect(store.groups[0]?.label).toBe('Heute');
		expect(store.total).toBe(1);
		expect(flags.flags.map((entry) => entry.title)).toContain(`${ticket.key} wieder erledigt.`);
	});

	it('closes the flag when the ticket is done again by another way', async () => {
		const ticket = doneTicket('2026-10-06 08:00:00.000Z');
		const data = fakeDoneData([[ticket]], 1);
		const { store, flags } = storeOf(data);
		const live = fakeDoneLive();
		store.connect(live.live);
		store.show(EMPTY_DONE_QUERY);
		await settle();
		await vi.waitFor(() => expect(live.live.tickets).toHaveBeenCalled());

		await store.reopen(ticket.id);
		expect(flags.flags).toHaveLength(1);
		live.send({
			action: 'update',
			record: {
				...ticket,
				completedAt: '2026-10-07 11:00:00.000Z',
				updated: '2026-10-07 13:00:00.000Z'
			}
		});
		expect(flags.flags).toEqual([]);
	});

	it('offers to reopen an older instance as a normal ticket when the series refuses (ADR-0023 addendum 4)', async () => {
		const ticket = doneTicket('2026-10-06 08:00:00.000Z', {
			recurring: true,
			recurrenceId: 'rule00000000001'
		});
		const data = fakeDoneData([[ticket]], 1);
		const message =
			'Von dieser Serie ist schon HAUS-14 offen, und dieses Ticket ist nicht das zuletzt erledigte. Du kannst es als normales Ticket wieder öffnen (aus der Serie lösen).';
		data.setDone.mockRejectedValueOnce(
			new DataError('validation', {
				status: 400,
				fields: {
					status: {
						code: 'validation_recurrence_reopen_older',
						message,
						params: { key: 'HAUS-14' }
					}
				}
			})
		);
		const { store, flags, open } = storeOf(data);
		store.show(EMPTY_DONE_QUERY);
		await settle();

		await store.reopen(ticket.id);
		const [refusal] = flags.flags;
		expect(refusal).toMatchObject({
			tone: 'error',
			title: `${ticket.key} konnte nicht wieder geöffnet werden. ${message}`
		});
		expect(ids(store.tickets)).toEqual([ticket.id]);
		expect(refusal?.action?.label).toBe('Als normales Ticket wieder öffnen (aus der Serie lösen)');

		refusal?.action?.run();
		await vi.waitFor(() =>
			expect(data.update).toHaveBeenCalledWith(ticket.id, { status: 'open', detachSeries: true })
		);
		await settle();
		expect(store.tickets).toEqual([]);
		expect(open.upsert).toHaveBeenCalledOnce();
		expect(flags.flags.map((flag) => flag.title)).toContain(
			`${ticket.key} ist wieder offen, als normales Ticket.`
		);
	});

	it('keeps the ticket and says why when reopening fails', async () => {
		const ticket = doneTicket('2026-10-06 08:00:00.000Z');
		const data = fakeDoneData([[ticket]], 1);
		data.setDone.mockRejectedValueOnce(new DataError('network'));
		const { store, flags } = storeOf(data);
		store.show(EMPTY_DONE_QUERY);
		await settle();

		await store.reopen(ticket.id);
		expect(ids(store.tickets)).toEqual([ticket.id]);
		expect(flags.flags[0]?.tone).toBe('error');
		expect(flags.flags[0]?.title).toMatch(/konnte nicht wieder geöffnet werden/);
		expect(store.isPending(ticket.id)).toBe(false);
	});
});
