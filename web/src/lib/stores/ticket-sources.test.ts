// Sources of the open ticket and linking (ADR-0031 sections 2 and 7): loading, realtime in and
// out, linking several entries with failures per entry and one flag, releasing, the file.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { DataError } from '$lib/data/errors';
import type { InboxItemSummary } from '$lib/domain/inbox';
import { FLAG_DURATION_MS, FlagStore } from './flags.svelte';
import type { LiveSource, RecordChange, Unsubscribe } from './realtime';
import { TicketSourcesStore, type TicketSourcesData } from './ticket-sources.svelte';

const TICKET = 'ticket000000001';

function item(id: string, overrides: Partial<InboxItemSummary> = {}): InboxItemSummary {
	return {
		id,
		channel: 'telegram',
		kind: 'message',
		title: `Nachricht ${id}`,
		sourceUrl: '',
		sourceRef: `42:${id}`,
		sourceDate: null,
		sourceMeta: {},
		original: '',
		state: 'converted',
		ticketId: TICKET,
		handledAt: '2026-09-25 09:00:00.000Z',
		created: '2026-09-25 08:00:00.000Z',
		updated: '2026-09-25 09:00:00.000Z',
		...overrides
	};
}

const released = (entry: InboxItemSummary): InboxItemSummary => ({
	...entry,
	state: 'new',
	ticketId: null,
	handledAt: null,
	updated: '2026-09-25 10:00:00.000Z'
});

function setup(sources: InboxItemSummary[] = [], valid = true) {
	const data = {
		list: vi.fn<TicketSourcesData['list']>(async () => sources),
		link: vi.fn<TicketSourcesData['link']>(async (id, ticketId) =>
			item(id, { ticketId, updated: '2026-09-25 10:00:00.000Z' })
		),
		release: vi.fn<TicketSourcesData['release']>(async (id) => released(item(id))),
		search: vi.fn<TicketSourcesData['search']>(async () => []),
		originalUrl: vi.fn<TicketSourcesData['originalUrl']>(async () => 'http://x/datei?token=t')
	} satisfies TicketSourcesData;
	const session = { ensureValid: vi.fn(() => valid), logout: vi.fn() };
	const flags = new FlagStore();
	const changed: InboxItemSummary[] = [];
	const store = new TicketSourcesStore(data, session, flags, (entry) => changed.push(entry));
	return { store, data, session, flags, changed };
}

function fakeLive() {
	const inbox: ((change: RecordChange<InboxItemSummary>) => void)[] = [];
	const reconnected: (() => void)[] = [];
	const add = <T>(list: T[], call: T): Promise<Unsubscribe> => {
		list.push(call);
		return Promise.resolve(async () => {
			list.splice(list.indexOf(call), 1);
		});
	};
	const never = (): Promise<Unsubscribe> => {
		throw new Error('The sources must not subscribe to anything else.');
	};
	const source: LiveSource = {
		tickets: never,
		ticket: never,
		comments: never,
		history: never,
		projects: never,
		tags: never,
		inbox: (call) => add(inbox, call),
		reads: never,
		reconnected: (call) => add(reconnected, call)
	};
	return {
		source,
		inbox,
		reconnected,
		send: (change: RecordChange<InboxItemSummary>) => {
			for (const call of [...inbox]) call(change);
		}
	};
}

afterEach(() => {
	vi.useRealTimers();
});

describe('TicketSourcesStore', () => {
	it('loads the sources of a ticket with the main source first', async () => {
		const main = item('m', { handledAt: '2026-09-26 09:00:00.000Z' });
		const { store, data } = setup([item('a'), main]);
		store.open(TICKET, 'm');
		expect(store.state).toBe('loading');
		await vi.waitFor(() => expect(store.state).toBe('ready'));
		expect(store.items.map((entry) => entry.id)).toEqual(['m', 'a']);
		expect(store.isMain('m')).toBe(true);
		expect(data.list).toHaveBeenCalledWith(
			TICKET,
			expect.objectContaining({ signal: expect.anything() })
		);

		// The same ticket again only updates the main source.
		store.open(TICKET, null);
		expect(data.list).toHaveBeenCalledOnce();
		expect(store.isMain('m')).toBe(false);
	});

	it('shows a failure to load and loads again', async () => {
		const { store, data } = setup();
		data.list.mockRejectedValueOnce(new DataError('network'));
		store.open(TICKET, null);
		await vi.waitFor(() => expect(store.state).toBe('error'));
		expect(store.error).toBeTruthy();
		await store.reload();
		expect(store.state).toBe('ready');
	});

	it('takes entries in and out through realtime events', async () => {
		const { store } = setup([item('a')]);
		store.open(TICKET, null);
		await vi.waitFor(() => expect(store.state).toBe('ready'));
		const live = fakeLive();
		const stop = store.connect(live.source);
		await vi.waitFor(() => expect(live.inbox).toHaveLength(1));

		live.send({ action: 'update', record: item('b') });
		live.send({ action: 'update', record: item('c', { ticketId: 'ticket000000002' }) });
		expect(store.items.map((entry) => entry.id)).toEqual(['a', 'b']);
		live.send({ action: 'update', record: released(item('a')) });
		live.send({ action: 'delete', id: 'b' });
		expect(store.items).toEqual([]);

		stop();
		await vi.waitFor(() => expect(live.inbox).toHaveLength(0));
		expect(live.reconnected).toHaveLength(0);
	});

	it('links several entries one after the other, keeps failures and names the result', async () => {
		const { store, data, flags, changed } = setup();
		store.open(TICKET, null);
		data.link.mockImplementation(async (id, ticketId) => {
			if (id === 'b') {
				throw new DataError('validation', {
					fields: { ticket: { code: 'validation_scope_mismatch', message: 'Nicht gefunden.' } }
				});
			}
			return item(id, { ticketId });
		});
		const outcome = await store.link(
			[
				{ id: 'a', title: 'A' },
				{ id: 'b', title: 'B' },
				{ id: 'c', title: 'C' }
			],
			{ id: TICKET, key: 'TASK-4' }
		);
		expect(data.link.mock.calls.map(([id]) => id)).toEqual(['a', 'b', 'c']);
		expect(outcome.linked.map((entry) => entry.id)).toEqual(['a', 'c']);
		expect(outcome.failures).toEqual([{ id: 'b', title: 'B', message: 'Nicht gefunden.' }]);
		expect(changed.map((entry) => entry.id)).toEqual(['a', 'c']);
		expect(flags.flags.map(({ tone, title }) => ({ tone, title }))).toEqual([
			{ tone: 'info', title: '2 Einträge mit TASK-4 verknüpft.' }
		]);
		await vi.waitFor(() => expect(store.items.map((entry) => entry.id)).toEqual(['a', 'c']));
	});

	it('stops linking when the session is gone', async () => {
		const { store, data, flags } = setup([], false);
		const outcome = await store.link([{ id: 'a', title: 'A' }], { id: TICKET, key: 'TASK-4' });
		expect(data.link).not.toHaveBeenCalled();
		expect(outcome).toEqual({ linked: [], failures: [] });
		expect(flags.flags).toEqual([]);
	});

	it('releases a source with a success flag and reports a refused one', async () => {
		vi.useFakeTimers();
		const a = item('a');
		const { store, data, flags, changed } = setup([a]);
		store.open(TICKET, null);
		await vi.waitFor(() => expect(store.state).toBe('ready'));
		const result = await store.release(a);
		expect(result.ok).toBe(true);
		expect(store.items).toEqual([]);
		expect(changed.map((entry) => entry.state)).toEqual(['new']);
		expect(flags.flags.at(-1)?.title).toBe('„Nachricht a“ ist wieder im Eingang.');
		vi.advanceTimersByTime(FLAG_DURATION_MS);

		data.release.mockRejectedValueOnce(
			new DataError('validation', {
				fields: {
					state: {
						code: 'validation_inbox_primary_source',
						message: 'Die Hauptquelle eines Tickets lässt sich nicht lösen.'
					}
				}
			})
		);
		const refused = await store.release(a);
		expect(refused).toEqual({
			ok: false,
			message: 'Die Hauptquelle eines Tickets lässt sich nicht lösen.'
		});
		expect(flags.flags.at(-1)).toMatchObject({
			tone: 'error',
			title:
				'„Nachricht a“ ließ sich nicht lösen: Die Hauptquelle eines Tickets lässt sich nicht lösen.'
		});
	});

	it('asks for the file with a fresh token and leads to the login after the session ended', async () => {
		const { store, data, session } = setup();
		expect(await store.originalUrl(item('a', { original: 'datei.eml' }))).toEqual({
			ok: true,
			value: 'http://x/datei?token=t'
		});
		data.originalUrl.mockRejectedValueOnce(new DataError('session'));
		expect(await store.originalUrl(item('a', { original: 'datei.eml' }))).toEqual({
			ok: false,
			message: null
		});
		expect(session.logout).toHaveBeenCalledOnce();
	});

	it('searches tickets through the data layer and forgets everything on reset', async () => {
		const { store, data } = setup([item('a')]);
		data.search.mockResolvedValueOnce([
			{ id: TICKET, key: 'TASK-4', title: 'Ziel', status: 'open' }
		]);
		expect(await store.search('4')).toEqual([
			{ id: TICKET, key: 'TASK-4', title: 'Ziel', status: 'open' }
		]);
		store.open(TICKET, null);
		await vi.waitFor(() => expect(store.items).toHaveLength(1));
		store.reset();
		expect(store.ticketId).toBeNull();
		expect(store.items).toEqual([]);
		expect(store.state).toBe('idle');
	});
});
