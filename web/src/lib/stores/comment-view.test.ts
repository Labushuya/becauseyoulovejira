// How the comments are shown (ADR-0044 sections 1 and 3): the order per device with other tabs,
// the unfolded comments per tab, and storage that is blocked.

import { describe, expect, it } from 'vitest';
import { COMMENT_ORDER_STORAGE_KEY, EXPANDED_COMMENTS_STORAGE_KEY } from '$lib/domain/comments';
import { CommentViewStore } from './comment-view.svelte';

const A = 'comment00000001';
const B = 'comment00000002';

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

function fakeWindow(
	local: ReturnType<typeof memory> | typeof throwing = memory(),
	session: ReturnType<typeof memory> | typeof throwing = memory()
) {
	const listeners = new Set<(event: StorageEvent) => void>();
	const win = {
		localStorage: local,
		sessionStorage: session,
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

describe('CommentViewStore: order (ADR-0044 section 1)', () => {
	it('starts with "Neueste zuerst" and reads a stored "Älteste zuerst"', () => {
		expect(new CommentViewStore(fakeWindow().win).order).toBe('newest');
		const stored = fakeWindow(memory({ [COMMENT_ORDER_STORAGE_KEY]: 'oldest' }));
		expect(new CommentViewStore(stored.win).order).toBe('oldest');
		expect(new CommentViewStore(null).order).toBe('newest');
	});

	it('stores only "oldest" and removes the key for the default', () => {
		const local = memory();
		const store = new CommentViewStore(fakeWindow(local).win);
		store.setOrder('oldest');
		expect(store.order).toBe('oldest');
		expect(local.items.get(COMMENT_ORDER_STORAGE_KEY)).toBe('oldest');
		store.setOrder('newest');
		expect(local.items.has(COMMENT_ORDER_STORAGE_KEY)).toBe(false);
	});

	it('follows other tabs and stops after the cleanup', () => {
		const { win, storage, listeners } = fakeWindow();
		const store = new CommentViewStore(win);
		const stop = store.connect();
		storage(COMMENT_ORDER_STORAGE_KEY, 'oldest');
		expect(store.order).toBe('oldest');
		storage('byl-theme', 'dark');
		expect(store.order).toBe('oldest');
		storage(null, null);
		expect(store.order).toBe('newest');
		stop();
		expect(listeners.size).toBe(0);
	});

	it('works with blocked storage; the choice lasts for the page', () => {
		const store = new CommentViewStore(fakeWindow(throwing, throwing).win);
		expect(store.order).toBe('newest');
		store.setOrder('oldest');
		expect(store.order).toBe('oldest');
		store.setExpanded(A, true);
		expect(store.isExpanded(A)).toBe(true);
	});
});

describe('CommentViewStore: unfolded comments (ADR-0044 section 3)', () => {
	it('remembers unfolded comments in the tab and forgets folded ones', () => {
		const session = memory();
		const store = new CommentViewStore(fakeWindow(memory(), session).win);
		store.setExpanded(A, true);
		store.setExpanded(B, true);
		expect(JSON.parse(session.items.get(EXPANDED_COMMENTS_STORAGE_KEY) ?? '[]')).toEqual([A, B]);
		store.setExpanded(A, false);
		expect(store.isExpanded(A)).toBe(false);
		expect(store.isExpanded(B)).toBe(true);
		expect(JSON.parse(session.items.get(EXPANDED_COMMENTS_STORAGE_KEY) ?? '[]')).toEqual([B]);
	});

	it('reads the comments unfolded earlier in the tab (after a reload)', () => {
		const session = memory({ [EXPANDED_COMMENTS_STORAGE_KEY]: JSON.stringify([B]) });
		const store = new CommentViewStore(fakeWindow(memory(), session).win);
		expect(store.isExpanded(B)).toBe(true);
		expect(store.isExpanded(A)).toBe(false);
	});
});
