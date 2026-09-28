// Remembered way to open a ticket (plan "Bulk, Inline und Ansicht", BI-1; ADR-0036 §1): reading
// and writing the stored value, the width rule below 64rem, links and other tabs.

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	OPEN_MODE_STORAGE_KEY,
	effectiveOpenMode,
	parseOpenMode,
	serializeOpenMode
} from '$lib/domain/open-mode';
import { TicketOpenModeStore } from './open-mode.svelte';

const ID = 'abc123def456ghi';

interface FakeWindow {
	win: Window;
	/** Changes the width: true from 64rem. */
	resize(wide: boolean): void;
	/** Sends a storage event as another tab would. */
	storage(key: string | null, newValue: string | null): void;
	storageItems: Map<string, string>;
}

function fakeWindow({
	stored = null,
	wide = true,
	storage = 'memory'
}: {
	stored?: string | null;
	wide?: boolean;
	storage?: 'memory' | 'throwing' | 'none';
} = {}): FakeWindow {
	const items = new Map<string, string>();
	if (stored !== null) items.set(OPEN_MODE_STORAGE_KEY, stored);
	const mediaListeners = new Set<() => void>();
	const media = {
		matches: wide,
		addEventListener: (_: string, listener: () => void) => mediaListeners.add(listener),
		removeEventListener: (_: string, listener: () => void) => mediaListeners.delete(listener)
	};
	const storageListeners = new Set<(event: StorageEvent) => void>();
	const localStorage =
		storage === 'memory'
			? {
					getItem: (key: string) => items.get(key) ?? null,
					setItem: (key: string, value: string) => void items.set(key, value),
					removeItem: (key: string) => void items.delete(key)
				}
			: storage === 'throwing'
				? {
						getItem: () => {
							throw new Error('blocked');
						},
						setItem: () => {
							throw new Error('full');
						},
						removeItem: () => {
							throw new Error('blocked');
						}
					}
				: undefined;
	const win = {
		get localStorage() {
			if (localStorage === undefined) throw new Error('SecurityError');
			return localStorage;
		},
		matchMedia: () => media,
		addEventListener: (_: string, listener: (event: StorageEvent) => void) =>
			storageListeners.add(listener),
		removeEventListener: (_: string, listener: (event: StorageEvent) => void) =>
			storageListeners.delete(listener)
	} as unknown as Window;
	return {
		win,
		storageItems: items,
		resize(next) {
			media.matches = next;
			for (const listener of mediaListeners) listener();
		},
		storage(key, newValue) {
			for (const listener of storageListeners) {
				listener({ key, newValue } as StorageEvent);
			}
		}
	};
}

describe('open mode: stored value', () => {
	it('reads only "full" as the full view, anything else as the panel', () => {
		expect(parseOpenMode('full')).toBe('full');
		for (const raw of [null, undefined, '', 'panel', 'FULL', ' full', '{"mode":"full"}']) {
			expect(parseOpenMode(raw), String(raw)).toBe('panel');
		}
	});

	it('stores only "full" and removes the key for the default', () => {
		expect(serializeOpenMode('full')).toBe('full');
		expect(serializeOpenMode('panel')).toBeNull();
	});

	it('uses the full view only where the panel is embedded', () => {
		expect(effectiveOpenMode('full', true)).toBe('full');
		expect(effectiveOpenMode('full', false)).toBe('panel');
		expect(effectiveOpenMode('panel', true)).toBe('panel');
		expect(effectiveOpenMode('panel', false)).toBe('panel');
	});
});

describe('TicketOpenModeStore', () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('starts with the panel and the stored choice', () => {
		expect(new TicketOpenModeStore(fakeWindow().win).mode).toBe('panel');
		expect(new TicketOpenModeStore(fakeWindow({ stored: 'full' }).win).mode).toBe('full');
		expect(new TicketOpenModeStore(fakeWindow({ stored: 'kaputt' }).win).mode).toBe('panel');
		expect(new TicketOpenModeStore(null).mode).toBe('panel');
	});

	it('remembers a choice and removes the key for the panel', () => {
		const fake = fakeWindow();
		const store = new TicketOpenModeStore(fake.win);

		store.choose('full');
		expect(store.mode).toBe('full');
		expect(fake.storageItems.get(OPEN_MODE_STORAGE_KEY)).toBe('full');

		store.choose('panel');
		expect(store.mode).toBe('panel');
		expect(fake.storageItems.has(OPEN_MODE_STORAGE_KEY)).toBe(false);
	});

	it('links to the panel or the full view with the list state', () => {
		const store = new TicketOpenModeStore(fakeWindow().win);
		const url = new URL('http://localhost:3000/?erledigte=1');
		expect(store.href(ID, url)).toBe(`/tickets/${ID}?erledigte=1`);
		expect(store.path(ID)).toBe(`/tickets/${ID}`);

		store.choose('full');
		expect(store.href(ID, url)).toBe(`/tickets/${ID}/voll?erledigte=1`);
		expect(store.path(ID)).toBe(`/tickets/${ID}/voll`);
	});

	it('below 64rem opens the panel and does not overwrite the choice', () => {
		const fake = fakeWindow({ stored: 'full', wide: false });
		const store = new TicketOpenModeStore(fake.win);
		const url = new URL('http://localhost:3000/');

		expect(store.mode).toBe('full');
		expect(store.effective).toBe('panel');
		expect(store.href(ID, url)).toBe(`/tickets/${ID}`);

		store.choose('panel');
		expect(store.mode).toBe('full');
		expect(fake.storageItems.get(OPEN_MODE_STORAGE_KEY)).toBe('full');
	});

	it('follows the width of the window once connected', () => {
		const fake = fakeWindow({ stored: 'full', wide: false });
		const store = new TicketOpenModeStore(fake.win);
		const disconnect = store.connect();

		fake.resize(true);
		expect(store.effective).toBe('full');
		fake.resize(false);
		expect(store.effective).toBe('panel');

		disconnect();
		fake.resize(true);
		expect(store.wide).toBe(false);
	});

	it('follows other tabs', () => {
		const fake = fakeWindow();
		const store = new TicketOpenModeStore(fake.win);
		const disconnect = store.connect();

		fake.storage(OPEN_MODE_STORAGE_KEY, 'full');
		expect(store.mode).toBe('full');
		fake.storage('byl-theme', 'dark');
		expect(store.mode).toBe('full');
		fake.storage(null, null);
		expect(store.mode).toBe('panel');

		disconnect();
		fake.storage(OPEN_MODE_STORAGE_KEY, 'full');
		expect(store.mode).toBe('panel');
	});

	it('keeps working with blocked or missing storage', () => {
		for (const storage of ['throwing', 'none'] as const) {
			const store = new TicketOpenModeStore(fakeWindow({ storage }).win);
			expect(store.mode, storage).toBe('panel');
			store.choose('full');
			expect(store.mode, storage).toBe('full');
		}
	});
});
