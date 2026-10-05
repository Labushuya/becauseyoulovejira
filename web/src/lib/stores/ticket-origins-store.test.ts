// The origins of the open ticket (QT-1, ADR-0067): loading through the route, quiet loads after a
// change of a link, of a linked ticket or of the connection (not after other tickets), the state
// before the migration (503), adding and removing with flags, a refused circle as text with its
// chain, and the subscriptions only while a ticket is open.

import { describe, expect, it, vi } from 'vitest';
import type { RecordChange, Unsubscribe } from '$lib/data/realtime';
import type { TicketSourceLink } from '$lib/data/ticket-origins';
import type { TicketSummary } from '$lib/domain/ticket';
import type { TicketOrigin, TicketOrigins } from '$lib/domain/ticket-origins';
import type { FlagInput } from './flags.svelte';
import { LiveHealth } from './live-health.svelte';
import { TicketOriginsStore, type TicketOriginsData } from './ticket-origins.svelte';

const ID = 'ticket000000004';
/** The open ticket whose sources change. */
const TASK = { id: ID, key: 'TASK-4' };

function origin(id: string, key: string): TicketOrigin {
	return {
		link: `link-${id}`,
		id,
		key,
		title: key,
		status: 'open',
		trashed: false,
		created: '2026-10-01 08:00:00.000Z',
		createdBy: ''
	};
}

function origins(overrides: Partial<TicketOrigins> = {}): TicketOrigins {
	return {
		ticketId: ID,
		sources: [],
		followUps: [],
		descendants: [],
		already: false,
		...overrides
	};
}

function setup(answers: Partial<TicketOriginsData> = {}) {
	const live = {
		links: [] as ((change: RecordChange<TicketSourceLink>) => void)[],
		tickets: [] as ((change: RecordChange<TicketSummary>) => void)[],
		reconnected: [] as (() => void)[],
		stopped: 0
	};
	const stop: Unsubscribe = async () => {
		live.stopped += 1;
	};
	const data = {
		load: vi.fn<TicketOriginsData['load']>(async () =>
			origins({ sources: [origin('tick00000000001', 'HAUS-3')] })
		),
		add: vi.fn<TicketOriginsData['add']>(async () => origins()),
		remove: vi.fn<TicketOriginsData['remove']>(async () => origins()),
		links: vi.fn<TicketOriginsData['links']>(async (_id, onChange) => {
			live.links.push(onChange);
			return stop;
		}),
		tickets: vi.fn<TicketOriginsData['tickets']>(async (onChange) => {
			live.tickets.push(onChange);
			return stop;
		}),
		reconnected: vi.fn<TicketOriginsData['reconnected']>(async (callback) => {
			live.reconnected.push(callback);
			return stop;
		})
	} satisfies TicketOriginsData;
	const shown: FlagInput[] = [];
	const flags = { show: (input: FlagInput) => (shown.push(input), 'flag'), dismiss: vi.fn() };
	const session = { ensureValid: vi.fn(() => true), logout: vi.fn() };
	const store = new TicketOriginsStore({ ...data, ...answers }, session, flags, {
		health: new LiveHealth()
	});
	return { store, data, live, shown, session };
}

function summary(id: string): TicketSummary {
	return {
		id,
		key: id,
		title: id,
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
		created: '2026-09-01 10:00:00.000Z',
		updated: '2026-09-01 10:00:00.000Z'
	};
}

describe('TicketOriginsStore', () => {
	it('loads the origins of the open ticket and follows them only while it is open', async () => {
		const { store, data, live } = setup();
		expect(data.links).not.toHaveBeenCalled();
		store.open(ID);
		await vi.waitFor(() => expect(store.state).toBe('ready'));
		expect(store.sources.map((entry) => entry.key)).toEqual(['HAUS-3']);
		expect(data.links).toHaveBeenCalledWith(ID, expect.any(Function));
		await vi.waitFor(() => expect(live.tickets).toHaveLength(1));

		// The same ticket again loads nothing more.
		store.open(ID);
		expect(data.load).toHaveBeenCalledTimes(1);

		store.reset();
		await vi.waitFor(() => expect(live.stopped).toBe(3));
		expect(store.ticketId).toBeNull();
		expect(store.sources).toEqual([]);
	});

	it('loads again quietly after a change of a link, a linked ticket or the connection, not of other tickets', async () => {
		const { store, data, live } = setup();
		store.open(ID);
		await vi.waitFor(() => expect(live.reconnected).toHaveLength(1));
		await vi.waitFor(() => expect(store.state).toBe('ready'));

		live.tickets[0]?.({ action: 'update', record: summary('tick00000000099') });
		expect(data.load).toHaveBeenCalledTimes(1);

		live.tickets[0]?.({ action: 'delete', id: 'tick00000000001' });
		await vi.waitFor(() => expect(data.load).toHaveBeenCalledTimes(2));
		expect(store.state).toBe('ready');

		live.links[0]?.({ action: 'delete', id: 'link-x' });
		await vi.waitFor(() => expect(data.load).toHaveBeenCalledTimes(3));

		live.reconnected[0]?.();
		await vi.waitFor(() => expect(data.load).toHaveBeenCalledTimes(4));
	});

	it('is not available before the migration and offers nothing then', async () => {
		const { store } = setup({
			load: vi.fn<TicketOriginsData['load']>(async () => {
				throw { status: 503, response: { reason: 'missing' } };
			})
		});
		store.open(ID);
		await vi.waitFor(() => expect(store.available).toBe(false));
		expect(store.state).toBe('ready');
		expect(store.origins).toBeNull();
	});

	it('shows a failure to load with its text', async () => {
		const { store } = setup({
			load: vi.fn<TicketOriginsData['load']>(async () => {
				throw { status: 500, response: {} };
			})
		});
		store.open(ID);
		await vi.waitFor(() => expect(store.state).toBe('error'));
		expect(store.error).toMatch(/Server/);
	});

	it('adds a source with a flag and gives a refused circle back as text with its chain', async () => {
		const { store, data, shown } = setup();
		store.open(ID);
		await vi.waitFor(() => expect(store.state).toBe('ready'));
		const both = [origin('tick00000000001', 'HAUS-3'), origin('tick00000000008', 'HAUS-8')];
		data.add.mockResolvedValueOnce(origins({ sources: both }));
		expect(await store.add(TASK, { id: 'tick00000000008', key: 'HAUS-8' })).toEqual({ ok: true });
		expect(store.sources.map((entry) => entry.key)).toEqual(['HAUS-3', 'HAUS-8']);
		expect(shown.at(-1)?.title).toBe('TASK-4 stammt jetzt aus HAUS-8.');

		data.add.mockRejectedValueOnce({
			status: 400,
			response: {
				data: {
					source: {
						code: 'validation_ticket_source_cycle',
						message: '',
						params: { path: ['HAUS-9', 'HAUS-12', 'TASK-4'] }
					}
				}
			}
		});
		expect(await store.add(TASK, { id: 'tick00000000009', key: 'HAUS-9' })).toEqual({
			ok: false,
			message: 'HAUS-9 stammt bereits (über HAUS-12) von TASK-4 ab.'
		});
		expect(store.isPending('tick00000000009')).toBe(false);
	});

	it('removes a source with a flag, a failure as an error flag; a lost session signs out', async () => {
		const { store, data, shown, session } = setup();
		const source = { id: 'tick00000000001', key: 'HAUS-3' };
		store.open(ID);
		await vi.waitFor(() => expect(store.state).toBe('ready'));
		expect(await store.remove(TASK, source)).toEqual({ ok: true });
		expect(store.sources).toEqual([]);
		expect(shown.at(-1)?.title).toBe('HAUS-3 ist keine Quelle von TASK-4 mehr.');

		data.remove.mockRejectedValueOnce({ status: 404, response: {} });
		expect((await store.remove(TASK, source)).ok).toBe(false);
		expect(shown.at(-1)).toMatchObject({
			tone: 'error',
			title: 'HAUS-3 ließ sich nicht als Quelle entfernen.'
		});

		data.remove.mockRejectedValueOnce({ status: 401, response: {} });
		expect(await store.remove(TASK, source)).toEqual({ ok: false, message: null });
		expect(session.logout).toHaveBeenCalled();
	});
});
