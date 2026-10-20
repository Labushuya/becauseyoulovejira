// The stores with the outbox (OF-2, acceptance of the concept OF-0 §8): offline the check mark
// shows "erledigt" at once with the mark and the flag "Wird übertragen, sobald die Verbindung
// zurück ist." and "Rückgängig"; a reconciliation does not bring the ticket back; the connection
// back, the change goes out on its own. The panel shows the kept status as well. Without the
// outbox the stores behave as before (their own tests run without one).

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DataError } from '$lib/data/errors';
import { EMPTY_LIST_QUERY } from '$lib/domain/list-query';
import { OFFLINE_TEXTS } from '$lib/domain/offline';
import type { Status } from '$lib/domain/status';
import type { Ticket, TicketSummary } from '$lib/domain/ticket';
import { FlagStore } from '$lib/stores/flags.svelte';
import { TicketDetailStore, type TicketDetailData } from '$lib/stores/ticket-detail.svelte';
import { TicketListStore, type TicketListData } from '$lib/stores/ticket-list.svelte';
import { ConnectivityStore } from './connectivity.svelte';
import { offlineTicketDetailData, offlineTicketListData } from './offline-data';
import { OutboxStore, type OutboxDeps } from './outbox.svelte';
import { MemoryOutboxStorage } from './outbox-storage';

const NOW = Date.UTC(2026, 9, 20, 12, 30, 0);
const USER = 'user00000000001';

function ticket(id: string, status: Status = 'open', updated = '2026-10-20 08:00:00.000Z'): Ticket {
	return {
		id,
		key: `HAUS-${id.slice(-2)}`,
		title: `Ticket ${id.slice(-2)}`,
		status,
		priority: 'medium',
		due: null,
		projectId: null,
		tagIds: [],
		project: null,
		tags: [],
		recurring: false,
		source: null,
		completedAt: status === 'done' ? '2026-10-20 12:31:00.000Z' : null,
		created: '2026-10-01 08:00:00.000Z',
		updated,
		description: 'Text',
		sourceItem: null
	};
}

const A = 'tick00000000001';

async function settle() {
	await vi.advanceTimersByTimeAsync(0);
}

/** Without a connection the data layer of today answers with "network". */
async function unreachable(): Promise<never> {
	throw new DataError('network');
}

function setup() {
	const server = { reachable: true, tickets: [ticket(A)] as Ticket[] };
	const find = (id: string) => server.tickets.find((entry) => entry.id === id) ?? ticket(id);
	const openOnServer = () => server.tickets.filter((entry) => entry.status !== 'done');
	const connectivity = new ConnectivityStore(async () => server.reachable);
	const send = vi.fn<OutboxDeps['send']>(async (action) => {
		const saved = ticket(action.target, action.payload.status, '2026-10-20 12:31:00.000Z');
		server.tickets = server.tickets.map((entry) => (entry.id === saved.id ? saved : entry));
		return saved;
	});
	let call = 0;
	const outbox = new OutboxStore({
		storage: new MemoryOutboxStorage(),
		connectivity,
		send,
		get: async (id) => find(id),
		tab: 'tab-a',
		fill: (bytes) => bytes.fill(call++ % 26)
	});
	const flags = new FlagStore();
	const base: TicketListData = {
		listOpen: vi.fn(async () => openOnServer()),
		searchOpen: vi.fn(async () => []),
		setDone: vi.fn(unreachable),
		update: vi.fn(unreachable)
	};
	const session = { ensureValid: () => true, logout: vi.fn() };
	const list: TicketListStore = new TicketListStore(
		offlineTicketListData(base, outbox, (id) => list.find(id)),
		session,
		{ flags, overlay: outbox, now: () => NOW }
	);
	const detailBase: TicketDetailData = {
		get: vi.fn(async (id: string) => find(id)),
		update: vi.fn(unreachable),
		create: vi.fn(async () => ticket(A)),
		delete: vi.fn(async () => null)
	};
	const shown = (id: string) => (detail.ticket?.id === id ? detail.ticket : null);
	const detail: TicketDetailStore = new TicketDetailStore(
		offlineTicketDetailData(detailBase, outbox, shown),
		session,
		list,
		null,
		undefined,
		flags,
		undefined,
		outbox
	);
	outbox.attach(USER);
	outbox.setSupport({ version: 1, kinds: ['ticket.update'] });
	outbox.setFrame(true);
	outbox.connect({
		upsert: (entry: TicketSummary) => {
			list.upsert(entry);
			const current = detail.ticket ?? ticket(entry.id);
			if (detail.id === entry.id) detail.upsert({ ...current, ...entry });
		},
		flags,
		sessionEnded: vi.fn()
	});
	return { server, connectivity, outbox, list, detail, flags, send, base };
}

beforeEach(() => {
	vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
	vi.setSystemTime(NOW);
});

afterEach(() => {
	vi.useRealTimers();
});

describe('the check mark without a connection', () => {
	it('shows "erledigt" at once with the mark and the flag, and sends it once the connection is back', async () => {
		const { server, connectivity, outbox, list, flags, send } = setup();
		list.activate(EMPTY_LIST_QUERY);
		await settle();
		server.reachable = false;
		await connectivity.check();
		await list.setDone(A, true);
		expect(list.open.map((entry) => entry.id)).toEqual([]);
		expect(outbox.markOf(A)).toBe('pending');
		const shown = flags.flags.map((flag) => [flag.title, flag.description, flag.action?.label]);
		expect(shown).toEqual([['HAUS-01 erledigt.', OFFLINE_TEXTS.pendingFlag, 'Rückgängig']]);
		expect(OFFLINE_TEXTS.pendingFlag).toBe('Wird übertragen, sobald die Verbindung zurück ist.');
		expect(send).not.toHaveBeenCalled();

		// A reconciliation brings the state of the server, but the kept change stays laid over it.
		await list.reconcile();
		expect(list.open.map((entry) => entry.id)).toEqual([]);

		server.reachable = true;
		await connectivity.check();
		await settle();
		expect(send).toHaveBeenCalledTimes(1);
		expect(outbox.count).toBe(0);
		expect(flags.flags.map((flag) => flag.title)).toContain('1 Änderung übertragen.');
	});

	it('"Rückgängig" of a kept completion only drops it from the outbox', async () => {
		const { server, connectivity, outbox, list, flags, send } = setup();
		list.activate(EMPTY_LIST_QUERY);
		await settle();
		server.reachable = false;
		await connectivity.check();
		await list.setDone(A, true);
		const undo = flags.flags[0]?.action;
		undo?.run();
		await settle();
		expect(outbox.count).toBe(0);
		expect(list.open.map((entry) => entry.id)).toEqual([A]);
		server.reachable = true;
		await connectivity.check();
		await settle();
		expect(send).not.toHaveBeenCalled();
	});

	it('shows a status of a cell with the mark and keeps the row', async () => {
		const { server, connectivity, outbox, list } = setup();
		list.activate(EMPTY_LIST_QUERY);
		await settle();
		server.reachable = false;
		await connectivity.check();
		expect(await list.changeField(A, { status: 'waiting' })).toBe(true);
		expect(list.find(A)?.status).toBe('waiting');
		expect(outbox.isPending(A)).toBe(true);
		// An event of the server with another field keeps the kept status laid over it.
		list.upsert({ ...ticket(A), title: 'Neu', updated: '2026-10-20 12:40:00.000Z' });
		expect(list.find(A)).toMatchObject({ title: 'Neu', status: 'waiting' });
	});
});

describe('the panel without a connection', () => {
	it('shows the kept status of the panel, also after loading the ticket again', async () => {
		const { server, connectivity, outbox, detail } = setup();
		detail.open(A);
		await settle();
		server.reachable = false;
		await connectivity.check();
		await detail.choose('status', 'in_progress');
		expect(detail.ticket?.status).toBe('in_progress');
		expect(outbox.isPending(A)).toBe(true);
		await detail.reload();
		expect(detail.ticket?.status).toBe('in_progress');
	});
});
