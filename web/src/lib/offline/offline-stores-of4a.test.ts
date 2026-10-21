// The stores with tickets and entries "＋" created without a connection (OF-4a, concept §3.5): the list,
// the panel and the inbox show them from the outbox ("Neu" instead of the key) until the server delivers
// them under the same ID; a reconciliation keeps them; opening one shows it instead of "nicht
// gefunden"; a change of its status goes into its creation; its answer takes its place without a gap.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DataError } from '$lib/data/errors';
import type { InboxItem } from '$lib/domain/inbox';
import { EMPTY_LIST_QUERY } from '$lib/domain/list-query';
import { OFFLINE_TEXTS } from '$lib/domain/offline';
import type { Ticket, TicketDraft, TicketSummary } from '$lib/domain/ticket';
import { FlagStore } from '$lib/stores/flags.svelte';
import { InboxStore, type InboxData } from '$lib/stores/inbox.svelte';
import { TicketDetailStore, type TicketDetailData } from '$lib/stores/ticket-detail.svelte';
import { TicketListStore, type TicketListData } from '$lib/stores/ticket-list.svelte';
import { ALL_OPS, NOW, USER, fakeServer, ticket } from '$lib/test/outbox-fake';
import { ConnectivityStore } from './connectivity.svelte';
import { offlineTicketDetailData, offlineTicketListData } from './offline-data';
import { OutboxStore } from './outbox.svelte';
import { MemoryOutboxStorage } from './outbox-storage';

const A = 'tick00000000001';
const ID = 'aaaaaaaaaaaaaaa';

async function settle() {
	await vi.advanceTimersByTimeAsync(0);
}

async function unreachable(): Promise<never> {
	throw new DataError('network');
}

function draft(title = 'Zahnarzt anrufen'): TicketDraft {
	return {
		title,
		description: '',
		status: 'open',
		priority: 'medium',
		due: null,
		project: null,
		tags: []
	};
}

function setup() {
	const fake = fakeServer();
	fake.server.strict = true;
	fake.server.status.set(A, 'open');
	const connectivity = new ConnectivityStore(async () => fake.server.health);
	let call = 0;
	const outbox = new OutboxStore({
		storage: new MemoryOutboxStorage(),
		connectivity,
		send: fake.send,
		sendDue: fake.sendDue,
		sendCreate: fake.sendCreate,
		sendItem: fake.sendItem,
		get: async (id) => fake.read(id),
		getItem: async (id) => fake.readItem(id),
		tab: 'tab-a',
		fill: (bytes) => bytes.fill(call++ % 26)
	});
	const flags = new FlagStore();
	const getTicket = vi.fn(async (id: string) => fake.read(id));
	const base: TicketListData = {
		listOpen: vi.fn(async () => [fake.read(A)]),
		searchOpen: vi.fn(async () => []),
		setDone: vi.fn(unreachable),
		update: vi.fn(unreachable)
	};
	const session = { ensureValid: () => true, logout: vi.fn() };
	// The read rows of the account: none yet, the base line long before (every new ticket is "neu").
	const reads = {
		unreadSince: () => '2026-01-01 00:00:00.000Z',
		list: vi.fn(async () => []),
		markRead: vi.fn(async () => null),
		markAllRead: vi.fn(async () => '2026-10-20 12:30:00.000Z')
	};
	const list: TicketListStore = new TicketListStore(
		offlineTicketListData(base, outbox, (id) => list.find(id)),
		session,
		{ flags, overlay: outbox, now: () => NOW, reads }
	);
	const detailBase: TicketDetailData = {
		get: getTicket,
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
	const getItem = vi.fn(async (id: string): Promise<InboxItem> => fake.readItem(id));
	const inboxData = {
		listNew: vi.fn(async () => []),
		get: getItem
	} as unknown as InboxData;
	const inbox = new InboxStore(inboxData, session, flags, () => [], outbox);
	outbox.attach(USER);
	outbox.setSupport(ALL_OPS);
	outbox.setFrame(true);
	outbox.connect({
		upsert: (entry: TicketSummary) => {
			list.upsert(entry);
			if (detail.id === entry.id) detail.upsert(entry as Ticket);
		},
		upsertItem: (item) => inbox.upsert(item),
		markRead: vi.fn(),
		flags,
		sessionEnded: vi.fn()
	});
	const offline = async () => {
		// The outbox reads the device first; only then it watches the connection.
		await settle();
		fake.server.health = false;
		await connectivity.check();
		expect(outbox.offline).toBe(true);
	};
	const online = async () => {
		fake.server.health = true;
		await connectivity.check();
		await settle();
	};
	return { fake, outbox, list, detail, inbox, flags, getTicket, getItem, offline, online };
}

beforeEach(() => {
	vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
	vi.setSystemTime(NOW);
});

afterEach(() => {
	vi.useRealTimers();
});

describe('the list with a ticket "＋" created (OF-4a)', () => {
	it('shows it next to the tickets of the server, keeps it through a reconciliation, and takes the one of the server in its place', async () => {
		const { outbox, list, offline, online, fake } = setup();
		list.activate(EMPTY_LIST_QUERY);
		await settle();
		await offline();
		await outbox.createTicket(draft());
		expect(list.open.map((entry) => [entry.id, entry.key])).toEqual([
			[ID, ''],
			[A, 'HAUS-01']
		]);
		expect(list.find(ID)?.title).toBe('Zahnarzt anrufen');
		expect(list.isCreated(ID)).toBe(true);
		expect(list.openCount).toBe(2);
		await list.reconcile();
		expect(list.open.map((entry) => entry.id)).toContain(ID);

		await online();
		expect(outbox.count).toBe(0);
		expect(list.open.filter((entry) => entry.id === ID).map((entry) => entry.key)).toEqual([
			'TASK-1'
		]);
		expect(list.isCreated(ID)).toBe(false);
		expect(fake.server.counter).toBe(1);
	});

	it('never shows a ticket "＋" created as "neu" for its own account', async () => {
		const { outbox, list, offline } = setup();
		list.activate(EMPTY_LIST_QUERY);
		await settle();
		await offline();
		await outbox.createTicket(draft());
		const created = list.find(ID);
		expect(created).not.toBeNull();
		expect(list.isNew(created as TicketSummary)).toBe(false);
		// A ticket of the server created after the base line is "neu", as before.
		expect(list.isNew({ ...(created as TicketSummary), id: 'tick00000000009' })).toBe(true);
	});

	it('takes the check mark into the creation and names the ticket by its title in the flag', async () => {
		const { outbox, list, flags, offline, online, fake } = setup();
		list.activate(EMPTY_LIST_QUERY);
		await settle();
		await offline();
		await outbox.createTicket(draft());
		await list.setDone(ID, true);
		expect(outbox.count).toBe(1);
		expect(list.open.map((entry) => entry.id)).toEqual([A]);
		expect(flags.flags.map((flag) => [flag.title, flag.description])).toEqual([
			['Neues Ticket „Zahnarzt anrufen“ erledigt.', OFFLINE_TEXTS.pendingDone(false)]
		]);
		// "Rückgängig" sets it open again, still in the creation.
		flags.flags[0]?.action?.run();
		await settle();
		expect(list.open.map((entry) => entry.id)).toEqual([ID, A]);
		await online();
		expect(fake.server.status.get(ID)).toBe('open');
		expect(fake.send).not.toHaveBeenCalled();
	});
});

describe('the panel of a ticket "＋" created (OF-4a)', () => {
	it('shows it from the outbox instead of "nicht gefunden", without a request, and the ticket of the server once it arrived', async () => {
		const { outbox, detail, getTicket, offline, online } = setup();
		await offline();
		await outbox.createTicket(draft());
		detail.open(ID);
		await settle();
		expect(getTicket).not.toHaveBeenCalled();
		expect(detail.state).toBe('ready');
		expect(detail.created).toBe(true);
		expect(detail.ticket).toMatchObject({ id: ID, key: '', title: 'Zahnarzt anrufen' });

		await detail.choose('status', 'in_progress');
		expect(detail.ticket?.status).toBe('in_progress');
		expect(outbox.count).toBe(1);

		await online();
		expect(detail.created).toBe(false);
		expect(detail.ticket).toMatchObject({ id: ID, key: 'TASK-1', status: 'in_progress' });
	});

	it('says "nicht gefunden" once a creation that never left the device is discarded', async () => {
		const { outbox, detail, offline } = setup();
		await offline();
		await outbox.createTicket(draft());
		detail.open(ID);
		await settle();
		await outbox.discard(outbox.actions[0]?.op ?? '');
		expect(detail.state).toBe('not_found');
	});
});

describe('the inbox with an entry "＋" put into it (OF-4a)', () => {
	it('shows it with the new ones, opens it without a request, and takes the one of the server in its place', async () => {
		const { outbox, inbox, getItem, offline, online } = setup();
		await inbox.load();
		await offline();
		await outbox.createItem({ title: 'Milch kaufen', project: null, tags: [], priority: null });
		expect(inbox.newItems.map((item) => item.id)).toEqual([ID]);
		expect(inbox.newCount).toBe(1);
		expect(inbox.isCreated(ID)).toBe(true);
		expect(await inbox.fetch(ID)).toMatchObject({ id: ID, title: 'Milch kaufen' });
		expect(getItem).not.toHaveBeenCalled();

		await online();
		expect(outbox.count).toBe(0);
		expect(inbox.isCreated(ID)).toBe(false);
		expect(inbox.newItems.map((item) => item.id)).toEqual([ID]);
		expect(inbox.newCount).toBe(1);
	});
});
