// Open setups outside the page "Kanäle" (KE-1, ADR-0076): the store of the (app) layout (what it
// loads, when it gives up, the household, at most one load a minute when the tab comes back, the
// hand-over of the page) and the quiet hint when the app opens: once per device and state, a new
// state shows it again, none after a failure (also 403), without a connection, without open setups,
// and never in place of another flag (the hints of the outbox, ADR-0074).

import { describe, expect, it, vi } from 'vitest';
import { DataError } from '$lib/data/errors';
import type { Connection, SecretStatus } from '$lib/domain/connections';
import type { InboxKey } from '$lib/domain/inbox-keys';
import { openSetupsOf, type OpenSetupEntry } from '$lib/domain/open-setups';
import { connectionOf } from '$lib/test/connections-fake';
import { FlagStore, MAX_FLAGS } from './flags.svelte';
import {
	OpenSetupsAttention,
	SEEN_KEY,
	type OpenSetupsAttentionDeps
} from './open-setups-attention';
import { OpenSetupsStore, REFRESH_GAP_MS, type OpenSetupsData } from './open-setups.svelte';

const OK = '2026-11-01 08:00:00.000Z';
const FRESH = connectionOf({ id: 'conn00000000031', label: 'Kalender' });
const DONE = connectionOf({
	id: 'conn00000000032',
	label: 'Familie',
	lastRunAt: OK,
	lastOkAt: OK,
	keywords: ['todo']
});
const FOLDER = connectionOf({
	id: 'conn00000000033',
	type: 'folder',
	label: 'Projekte',
	secretEnv: '',
	folders: { interval: 5, folders: [] }
});
const KEY: InboxKey = {
	id: 'key000000000001',
	name: 'Skript',
	tokenHint: 'byl_Ab12',
	created: OK,
	lastUsedAt: null
};

function fakeData(
	connections: Connection[] = [FRESH, DONE, FOLDER],
	keys: InboxKey[] | null = [KEY]
) {
	return {
		list: vi.fn<OpenSetupsData['list']>(async () => connections),
		secretStatus: vi.fn<OpenSetupsData['secretStatus']>(async (): Promise<SecretStatus> => ({
			secret: true,
			allowlist: null
		})),
		inboxKeys: vi.fn<OpenSetupsData['inboxKeys']>(async () => keys),
		extensionBuilt: vi.fn<OpenSetupsData['extensionBuilt']>(async () => false)
	} satisfies OpenSetupsData;
}

function storeOf(
	data: OpenSetupsData = fakeData(),
	options: { valid?: boolean; household?: boolean; now?: () => number } = {}
) {
	const session = { ensureValid: vi.fn(() => options.valid ?? true), logout: vi.fn() };
	const store = new OpenSetupsStore(
		data,
		session,
		() => options.household ?? false,
		options.now ?? (() => 0)
	);
	return { store, session };
}

describe('OpenSetupsStore', () => {
	it('loads the connections, their variables, the keys and the extension, and counts the open setups', async () => {
		const data = fakeData();
		const { store } = storeOf(data);
		const entries = await store.load();
		expect(entries?.map((entry) => [entry.key, entry.open.reason])).toEqual([
			[FRESH.id, 'first-run'],
			[FOLDER.id, 'folder'],
			['eigener-eingang', 'key-unused'],
			['whatsapp-web', 'extension']
		]);
		expect(store.state).toBe('ready');
		expect(store.count).toBe(4);
		// Folders have no variables to ask for (ADR-0051 §1).
		expect(data.secretStatus.mock.calls.map(([id]) => id).sort()).toEqual([FRESH.id, DONE.id]);
		expect(data.extensionBuilt).toHaveBeenCalledTimes(1);
	});

	it('asks for the extension only once a key exists', async () => {
		const data = fakeData([DONE], []);
		const { store } = storeOf(data);
		expect(await store.load()).toEqual([]);
		expect(data.extensionBuilt).not.toHaveBeenCalled();
		expect(store.count).toBe(0);
	});

	it.each([
		['a refusal of the list (403)', 'list', new DataError('forbidden', { status: 403 })],
		['a failed question for a variable', 'secretStatus', new DataError('server', { status: 500 })],
		['no connection to the server', 'inboxKeys', new DataError('network')]
	] as const)('gives up on %s: no entries, no number', async (_name, method, error) => {
		const data = fakeData();
		data[method].mockRejectedValue(error);
		const { store } = storeOf(data);
		expect(await store.load()).toBeNull();
		expect(store.state).toBe('error');
		expect(store.entries).toEqual([]);
		expect(store.count).toBe(0);
	});

	it('signs out on an ended session and asks nothing without one', async () => {
		const data = fakeData();
		data.list.mockRejectedValue(new DataError('session', { status: 401 }));
		const { store, session } = storeOf(data);
		expect(await store.load()).toBeNull();
		expect(session.logout).toHaveBeenCalled();
		const none = fakeData();
		const { store: idle } = storeOf(none, { valid: false });
		expect(await idle.load()).toBeNull();
		expect(none.list).not.toHaveBeenCalled();
	});

	it('shows nothing in the household, where connections and the own inbox are not offered', async () => {
		const data = fakeData();
		const { store } = storeOf(data, { household: true });
		expect(await store.load()).toEqual([]);
		expect(data.list).not.toHaveBeenCalled();
		expect(store.count).toBe(0);
	});

	it('loads again when the tab comes back, at most once a minute (no polling)', async () => {
		let now = 1_000_000;
		const data = fakeData();
		const { store } = storeOf(data, { now: () => now });
		await store.load();
		now += REFRESH_GAP_MS - 1;
		await store.refresh();
		expect(data.list).toHaveBeenCalledTimes(1);
		now += 1;
		await store.refresh();
		expect(data.list).toHaveBeenCalledTimes(2);
	});

	it('takes what the page "Kanäle" computed and loads again for another area', async () => {
		const data = fakeData();
		const { store } = storeOf(data);
		const entries = openSetupsOf({
			connections: [FRESH],
			status: () => ({ secret: true, allowlist: null }),
			keys: null,
			extensionBuilt: null
		});
		store.adopt(entries);
		expect(store.count).toBe(1);
		expect(data.list).not.toHaveBeenCalled();
		store.rescope();
		expect(store.count).toBe(0);
		await vi.waitFor(() => expect(store.count).toBe(4));
	});
});

/** Entries for the hint: one open calendar. */
function entriesOf(connections: Connection[] = [FRESH]): OpenSetupEntry[] {
	return openSetupsOf({
		connections,
		status: () => ({ secret: true, allowlist: null }),
		keys: null,
		extensionBuilt: null
	});
}

function attentionOf(overrides: Partial<OpenSetupsAttentionDeps> = {}) {
	const flags = new FlagStore();
	const storage = new Map<string, string>();
	const open = vi.fn();
	const deps: OpenSetupsAttentionDeps = {
		load: vi.fn(async () => entriesOf()),
		account: () => 'u0000000000000a',
		flags,
		open,
		offline: () => false,
		room: () => flags.flags.length < MAX_FLAGS,
		storage: {
			getItem: (key) => storage.get(key) ?? null,
			setItem: (key, value) => void storage.set(key, value)
		},
		...overrides
	};
	return { attention: new OpenSetupsAttention(deps), flags, storage, open, deps };
}

describe('OpenSetupsAttention (hint when the app opens)', () => {
	it('shows a quiet flag with "Ansehen", once per device and state', async () => {
		const { attention, flags, storage, open } = attentionOf();
		await attention.announce();
		expect(flags.flags).toHaveLength(1);
		expect(flags.flags[0]).toMatchObject({
			tone: 'info',
			title: '1 Einrichtung ist offen.',
			description: '„Kalender“'
		});
		expect(storage.get(SEEN_KEY)).toBe(`u0000000000000a|${FRESH.id}:first-run`);
		flags.act(flags.flags[0]!.id);
		expect(open).toHaveBeenCalled();
		// Opened again, the same state: no second flag.
		await attention.announce();
		expect(flags.flags).toHaveLength(0);
	});

	it('shows it again for a new state', async () => {
		const load = vi.fn(async () => entriesOf());
		const { attention, flags } = attentionOf({ load });
		await attention.announce();
		flags.clear();
		load.mockResolvedValue(
			entriesOf([FRESH, { ...FRESH, id: 'conn00000000039', label: 'Arbeit' }])
		);
		await attention.announce();
		expect(flags.flags.map((flag) => flag.title)).toEqual(['2 Einrichtungen sind offen.']);
		expect(flags.flags[0]?.description).toBe('„Kalender“ und „Arbeit“');
	});

	it.each([
		['a failure or refusal (403)', { load: vi.fn(async () => null) }],
		['no open setup', { load: vi.fn(async () => []) }],
		['no connection to the server', { offline: () => true }],
		['no account', { account: () => null }]
	])('shows nothing on %s', async (_name, overrides) => {
		const { attention, flags, storage } = attentionOf(overrides);
		await attention.announce();
		expect(flags.flags).toEqual([]);
		expect(storage.has(SEEN_KEY)).toBe(false);
	});

	it('asks nothing without a connection', async () => {
		const load = vi.fn(async () => entriesOf());
		const { attention } = attentionOf({ load, offline: () => true });
		await attention.announce();
		expect(load).not.toHaveBeenCalled();
	});

	it('never pushes out another flag, e.g. a hint of the outbox, and comes at the next occasion', async () => {
		const { attention, flags, storage } = attentionOf();
		const outbox = [
			flags.show({ tone: 'info', title: 'Keine Verbindung – 2 Änderungen gemerkt.' }),
			flags.show({ tone: 'success', title: '1 Änderung übertragen.' }),
			flags.show({ tone: 'error', title: 'Abgelehnt.' })
		];
		await attention.announce();
		expect(flags.flags.map((flag) => flag.id).sort()).toEqual([...outbox].sort());
		expect(storage.has(SEEN_KEY)).toBe(false);
		flags.clear();
		await attention.announce();
		expect(flags.flags.map((flag) => flag.title)).toEqual(['1 Einrichtung ist offen.']);
	});
});
