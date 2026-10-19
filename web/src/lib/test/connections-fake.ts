// Fake data layer of the page "Kanäle" for the tests of the setup assistant around restarts and the
// return to a step (BW-1): every call answers from fixed values unless a test replaces it. Creating
// answers with a connection of the draft; the variables answer `status`.

import { vi } from 'vitest';
import type { RecordChange } from '$lib/data/realtime';
import type { Connection, SecretStatus } from '$lib/domain/connections';
import { ConnectionsStore, type ConnectionsData } from '$lib/stores/connections.svelte';
import { FlagStore } from '$lib/stores/flags.svelte';

/** A connection with the fields of the list; `type` and the rest from `overrides`. */
export function connectionOf(overrides: Partial<Connection> = {}): Connection {
	return {
		id: 'conn00000000001',
		type: 'calendar',
		label: 'Kalender',
		enabled: true,
		secretEnv: 'BYL_GOOGLE_CALENDAR_URL',
		allowlistEnv: '',
		lastRunAt: null,
		lastOkAt: null,
		lastError: '',
		lastHint: '',
		keywords: [],
		replySaved: true,
		replyNoMatch: true,
		mailProvider: '',
		mailUser: '',
		matchBody: false,
		runningSince: null,
		created: '2026-10-19 08:00:00.000Z',
		updated: '2026-10-19 08:00:00.000Z',
		...overrides
	};
}

/** The data layer with spies for `items`; the variables answer `status`. */
export function fakeConnectionsData(
	items: Connection[],
	status: SecretStatus = { secret: false, allowlist: null }
) {
	const listeners: ((change: RecordChange<Connection>) => void)[] = [];
	const data = {
		list: vi.fn<ConnectionsData['list']>(async () => items),
		create: vi.fn<ConnectionsData['create']>(async (draft) =>
			connectionOf({
				id: 'conn00000000009',
				type: draft.type,
				label: draft.label,
				secretEnv: draft.secretEnv,
				allowlistEnv: draft.allowlistEnv,
				mailProvider: draft.type === 'mail' ? draft.mailProvider : '',
				mailUser: draft.mailUser
			})
		),
		setEnabled: vi.fn<ConnectionsData['setEnabled']>(),
		rename: vi.fn<ConnectionsData['rename']>(),
		setTarget: vi.fn<ConnectionsData['setTarget']>(),
		saveSettings: vi.fn<ConnectionsData['saveSettings']>(async (current, settings) => ({
			...current,
			keywords: settings.keywords
		})),
		saveGitHub: vi.fn<ConnectionsData['saveGitHub']>(),
		saveFolders: vi.fn<ConnectionsData['saveFolders']>(),
		remove: vi.fn<ConnectionsData['remove']>(),
		secretStatus: vi.fn<ConnectionsData['secretStatus']>(async () => status),
		run: vi.fn<ConnectionsData['run']>(async () => ({
			status: 'ok',
			created: 0,
			duplicates: 0,
			updated: 0,
			skipped: 0,
			failed: 0,
			unmatched: 0,
			error: '',
			missing: []
		})),
		get: vi.fn<ConnectionsData['get']>(
			async (id) => items.find((item) => item.id === id) ?? connectionOf()
		),
		listMailbox: vi.fn<ConnectionsData['listMailbox']>(async () => ({
			kind: 'unavailable' as const,
			message: 'Der Mail-Hilfsprozess läuft nicht.',
			hint: ''
		})),
		importMailbox: vi.fn<ConnectionsData['importMailbox']>(),
		subscribe: vi.fn<ConnectionsData['subscribe']>(async (_id, onChange) => {
			listeners.push(onChange);
			return async () => undefined;
		}),
		helperStatus: vi.fn<ConnectionsData['helperStatus']>(async () => ({
			state: 'running' as const,
			version: '0.9.0',
			message: ''
		})),
		scan: vi.fn<ConnectionsData['scan']>(async () => ({ status: 'started' as const, message: '' }))
	} satisfies ConnectionsData;
	return { data, listeners };
}

export type FakeConnectionsData = ReturnType<typeof fakeConnectionsData>['data'];

/** The store on the fake data, loaded, with a valid session. */
export async function connectionsStoreOf(data: ConnectionsData): Promise<ConnectionsStore> {
	const store = new ConnectionsStore(
		data,
		{ ensureValid: () => true, logout: vi.fn() },
		new FlagStore()
	);
	await store.load();
	return store;
}
