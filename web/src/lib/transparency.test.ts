// Switch "Transparenz" (ADR-0029 section 7): reading with validation, writing only "off", applying
// to the root element, following other tabs and reporting the system setting "reduce
// transparency". Mode and accent stay untouched.

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	applyTransparency,
	DEFAULT_TRANSPARENCY,
	parseTransparency,
	readTransparency,
	REDUCED_TRANSPARENCY_QUERY,
	TRANSPARENCY_OFF,
	TRANSPARENCY_STORAGE_KEY,
	TransparencyStore,
	writeTransparency
} from './transparency.svelte';

afterEach(() => {
	localStorage.clear();
	document.documentElement.removeAttribute('data-transparency');
	document.documentElement.removeAttribute('data-accent');
	document.documentElement.removeAttribute('data-theme');
	vi.unstubAllGlobals();
});

const throwing = {
	getItem: () => {
		throw new Error('blocked');
	},
	setItem: () => {
		throw new Error('blocked');
	},
	removeItem: () => {
		throw new Error('blocked');
	}
};

/** A media query list for the system setting whose state the test controls. */
function fakeQuery(matches: boolean) {
	const listeners = new Set<(event: MediaQueryListEvent) => void>();
	const list = {
		matches,
		media: REDUCED_TRANSPARENCY_QUERY,
		addEventListener: (_type: string, listener: (event: MediaQueryListEvent) => void) =>
			listeners.add(listener),
		removeEventListener: (_type: string, listener: (event: MediaQueryListEvent) => void) =>
			listeners.delete(listener)
	};
	return {
		list,
		listeners,
		change(next: boolean) {
			list.matches = next;
			for (const listener of listeners) listener({ matches: next } as MediaQueryListEvent);
		}
	};
}

/** The window of jsdom with a matchMedia that answers only the transparency query. */
function windowWith(query: ReturnType<typeof fakeQuery>): Window {
	const matchMedia = vi.fn((media: string) => {
		expect(media).toBe(REDUCED_TRANSPARENCY_QUERY);
		return query.list as unknown as MediaQueryList;
	});
	vi.stubGlobal('matchMedia', matchMedia);
	return window;
}

describe('transparency', () => {
	it('is on by default and stores only "off" under its own key', () => {
		expect(DEFAULT_TRANSPARENCY).toBe('on');
		expect(TRANSPARENCY_STORAGE_KEY).toBe('byl-transparency');
		expect(TRANSPARENCY_OFF).toBe('off');
		expect(REDUCED_TRANSPARENCY_QUERY).toBe('(prefers-reduced-transparency: reduce)');
	});

	it.each([
		['off', 'off'],
		['on', 'on'],
		[null, 'on'],
		[undefined, 'on'],
		['', 'on'],
		['OFF', 'on'],
		['false', 'on'],
		["off' onload='x", 'on']
	])('reads %j as %s', (value, expected) => {
		expect(parseTransparency(value)).toBe(expected);
	});

	it('reads the storage and falls back to "on" when it is missing or throws', () => {
		localStorage.setItem(TRANSPARENCY_STORAGE_KEY, 'off');
		expect(readTransparency(localStorage)).toBe('off');
		expect(readTransparency(null)).toBe('on');
		expect(readTransparency(throwing)).toBe('on');
	});

	it('stores "off" and removes the key for "on"', () => {
		expect(writeTransparency(localStorage, 'off')).toBe(true);
		expect(localStorage.getItem(TRANSPARENCY_STORAGE_KEY)).toBe('off');
		expect(writeTransparency(localStorage, 'on')).toBe(true);
		expect(localStorage.getItem(TRANSPARENCY_STORAGE_KEY)).toBeNull();
	});

	it('reports a storage that refuses the choice', () => {
		expect(writeTransparency(null, 'off')).toBe(false);
		expect(writeTransparency(throwing, 'off')).toBe(false);
	});

	it('sets data-transparency="off" only for "off"', () => {
		const root = document.documentElement;
		applyTransparency(root, 'off');
		expect(root.getAttribute('data-transparency')).toBe('off');
		applyTransparency(root, 'on');
		expect(root.hasAttribute('data-transparency')).toBe(false);
	});
});

describe('TransparencyStore', () => {
	it('starts with the stored choice and the system setting', () => {
		localStorage.setItem(TRANSPARENCY_STORAGE_KEY, 'off');
		const store = new TransparencyStore(windowWith(fakeQuery(true)));

		expect(store.transparency).toBe('off');
		expect(store.systemReduces).toBe(true);
	});

	it('assumes no system setting where matchMedia is missing', () => {
		vi.stubGlobal('matchMedia', undefined);
		const store = new TransparencyStore(window);

		expect(store.transparency).toBe('on');
		expect(store.systemReduces).toBe(false);
		expect(() => store.connect()()).not.toThrow();
	});

	it('applies and stores a choice at once and leaves mode and accent alone', () => {
		const root = document.documentElement;
		root.setAttribute('data-theme', 'dark');
		root.setAttribute('data-accent', 'kupfer');
		const store = new TransparencyStore(windowWith(fakeQuery(false)));

		store.choose('off');
		expect(store.transparency).toBe('off');
		expect(root.getAttribute('data-transparency')).toBe('off');
		expect(localStorage.getItem(TRANSPARENCY_STORAGE_KEY)).toBe('off');

		store.choose('on');
		expect(root.hasAttribute('data-transparency')).toBe(false);
		expect(localStorage.getItem(TRANSPARENCY_STORAGE_KEY)).toBeNull();
		expect(root.getAttribute('data-theme')).toBe('dark');
		expect(root.getAttribute('data-accent')).toBe('kupfer');
	});

	it('keeps the choice for this page when the storage is blocked', () => {
		const store = new TransparencyStore(windowWith(fakeQuery(false)));
		vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
			throw new Error('QuotaExceededError');
		});

		store.choose('off');
		expect(store.transparency).toBe('off');
		expect(document.documentElement.getAttribute('data-transparency')).toBe('off');
		vi.restoreAllMocks();
	});

	it('follows other tabs and ignores other keys', () => {
		const store = new TransparencyStore(windowWith(fakeQuery(false)));
		const disconnect = store.connect();

		window.dispatchEvent(new StorageEvent('storage', { key: 'byl-accent', newValue: 'rubin' }));
		expect(store.transparency).toBe('on');

		window.dispatchEvent(
			new StorageEvent('storage', { key: TRANSPARENCY_STORAGE_KEY, newValue: 'off' })
		);
		expect(store.transparency).toBe('off');
		expect(document.documentElement.getAttribute('data-transparency')).toBe('off');

		// localStorage.clear() in another tab: key null, back to the default.
		window.dispatchEvent(new StorageEvent('storage', { key: null }));
		expect(store.transparency).toBe('on');
		expect(document.documentElement.hasAttribute('data-transparency')).toBe(false);

		disconnect();
		window.dispatchEvent(
			new StorageEvent('storage', { key: TRANSPARENCY_STORAGE_KEY, newValue: 'off' })
		);
		expect(store.transparency).toBe('on');
	});

	it('follows the system setting while connected', () => {
		const query = fakeQuery(false);
		const store = new TransparencyStore(windowWith(query));
		const disconnect = store.connect();

		query.change(true);
		expect(store.systemReduces).toBe(true);
		query.change(false);
		expect(store.systemReduces).toBe(false);

		disconnect();
		expect(query.listeners.size).toBe(0);
		query.change(true);
		expect(store.systemReduces).toBe(false);
	});
});
