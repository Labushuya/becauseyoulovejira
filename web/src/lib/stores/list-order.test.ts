// The order of a list by time per device (QS-1, ADR-0031 addendum M; the same store keeps the order
// of the comments, ADR-0044 §1): reading and storing under its own key, other tabs, blocked storage.

import { describe, expect, it } from 'vitest';
import { COMMENT_ORDER_STORAGE_KEY } from '$lib/domain/comments';
import { SOURCE_ORDER_STORAGE_KEY } from '$lib/domain/sources';
import { ListOrderStore, sourceOrderStore } from './list-order.svelte';

function memory(initial: Record<string, string> = {}) {
	const items = new Map(Object.entries(initial));
	return {
		items,
		getItem: (key: string) => items.get(key) ?? null,
		setItem: (key: string, value: string) => void items.set(key, value),
		removeItem: (key: string) => void items.delete(key)
	};
}

const throwing = {
	getItem: (): string | null => {
		throw new Error('blocked');
	},
	setItem: () => {
		throw new Error('full');
	},
	removeItem: () => {
		throw new Error('blocked');
	}
};

function fakeWindow(local: ReturnType<typeof memory> | typeof throwing = memory()) {
	const listeners = new Set<(event: StorageEvent) => void>();
	const win = {
		localStorage: local,
		addEventListener: (_: string, listener: (event: StorageEvent) => void) =>
			listeners.add(listener),
		removeEventListener: (_: string, listener: (event: StorageEvent) => void) =>
			listeners.delete(listener)
	} as unknown as Window;
	const storage = (key: string | null, newValue: string | null) => {
		for (const listener of listeners) listener({ key, newValue } as StorageEvent);
	};
	return { win, storage, listeners };
}

describe('ListOrderStore (QS-1)', () => {
	it('keeps the sources under "byl-sources-order", newest first unless "oldest" is stored', () => {
		expect(SOURCE_ORDER_STORAGE_KEY).toBe('byl-sources-order');
		expect(sourceOrderStore(fakeWindow().win).order).toBe('newest');
		expect(sourceOrderStore(null).order).toBe('newest');
		const stored = memory({ [SOURCE_ORDER_STORAGE_KEY]: 'oldest' });
		expect(sourceOrderStore(fakeWindow(stored).win).order).toBe('oldest');
		// The order of the comments is a choice of its own.
		const comments = memory({ [COMMENT_ORDER_STORAGE_KEY]: 'oldest' });
		expect(sourceOrderStore(fakeWindow(comments).win).order).toBe('newest');
	});

	it('stores only "oldest" and removes the key for the default', () => {
		const local = memory();
		const store = sourceOrderStore(fakeWindow(local).win);
		store.setOrder('oldest');
		expect(store.order).toBe('oldest');
		expect([...local.items]).toEqual([[SOURCE_ORDER_STORAGE_KEY, 'oldest']]);
		store.setOrder('newest');
		expect(local.items.size).toBe(0);
	});

	it('follows other tabs for its own key only and stops after the cleanup', () => {
		const { win, storage, listeners } = fakeWindow();
		const store = new ListOrderStore(win, SOURCE_ORDER_STORAGE_KEY);
		const stop = store.connect();
		storage(SOURCE_ORDER_STORAGE_KEY, 'oldest');
		expect(store.order).toBe('oldest');
		storage(COMMENT_ORDER_STORAGE_KEY, null);
		expect(store.order).toBe('oldest');
		storage(null, null);
		expect(store.order).toBe('newest');
		stop();
		expect(listeners.size).toBe(0);
		expect(sourceOrderStore(null).connect()).toBeTypeOf('function');
	});

	it('works with blocked storage; the choice lasts for the page', () => {
		const store = sourceOrderStore(fakeWindow(throwing).win);
		expect(store.order).toBe('newest');
		store.setOrder('oldest');
		expect(store.order).toBe('oldest');
	});
});
