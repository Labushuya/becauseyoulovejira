// Tests for the column preferences (ADR-0030): widths and visibility per table in localStorage
// under byl-columns-*, a storage that throws, "Standard wiederherstellen" with its flag, and the
// sync with other tabs through the storage event.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { REM, TICKET_TABLE } from '$lib/domain/columns';
import {
	COLUMNS_RESET_FLAG,
	ColumnPrefsRegistry,
	ColumnPrefsStore,
	type ColumnStorage
} from './column-prefs.svelte';

/** Defaults of the ticket table: nothing chosen, "Quelle" off. */
const DEFAULTS = { widths: {}, hidden: ['source'] };

type MemoryStorage = ColumnStorage & { data: Map<string, string> };

function memoryStorage(initial: Record<string, string> = {}): MemoryStorage {
	const data = new Map(Object.entries(initial));
	return {
		data,
		getItem: (key) => data.get(key) ?? null,
		setItem: (key, value) => void data.set(key, value),
		removeItem: (key) => void data.delete(key)
	};
}

const throwing: ColumnStorage = {
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

afterEach(() => {
	localStorage.clear();
});

describe('ColumnPrefsStore', () => {
	it('starts with the defaults and stores a chosen width under byl-columns-tickets', () => {
		const storage = memoryStorage();
		const store = new ColumnPrefsStore(TICKET_TABLE, storage);
		expect(store.widthOf('tags')).toBe(8 * REM);

		expect(store.setWidth('tags', 200)).toBe(200);

		expect(store.widthOf('tags')).toBe(200);
		expect(JSON.parse(storage.data.get('byl-columns-tickets') ?? '')).toEqual({
			v: 1,
			widths: { tags: 200 },
			hidden: ['source']
		});
	});

	it('clamps widths and ignores the title, the actions and unknown columns', () => {
		const storage = memoryStorage();
		const store = new ColumnPrefsStore(TICKET_TABLE, storage);
		expect(store.setWidth('tags', 5000)).toBe(20 * REM);
		expect(store.setWidth('title', 400)).toBe(0);
		expect(store.setWidth('actions', 100)).toBe(0);
		expect(store.setWidth('nope', 100)).toBe(0);
		expect(store.prefs.widths).toEqual({ tags: 20 * REM });
	});

	it('hides and shows optional columns in the order of the table, never required ones', () => {
		const storage = memoryStorage();
		const store = new ColumnPrefsStore(TICKET_TABLE, storage);
		store.setVisible('created', false);
		store.setVisible('priority', false);
		store.setVisible('key', false);
		expect(store.prefs.hidden).toEqual(['priority', 'source', 'created']);
		expect(store.isHidden('created')).toBe(true);

		store.setVisible('created', true);
		expect(store.prefs.hidden).toEqual(['priority', 'source']);
		store.setVisible('priority', true);
		// Back at the defaults the key goes away.
		expect(storage.data.has('byl-columns-tickets')).toBe(false);
	});

	it('reads what is stored and falls back to the defaults for a broken value', () => {
		const stored = new ColumnPrefsStore(
			TICKET_TABLE,
			memoryStorage({ 'byl-columns-tickets': '{"v":1,"widths":{"project":160},"hidden":["due"]}' })
		);
		expect(stored.widthOf('project')).toBe(160);
		expect(stored.isHidden('due')).toBe(true);

		const broken = new ColumnPrefsStore(
			TICKET_TABLE,
			memoryStorage({ 'byl-columns-tickets': '{oops' })
		);
		expect(broken.prefs).toEqual(DEFAULTS);
	});

	it('keeps the choice for the page when the storage throws', () => {
		const store = new ColumnPrefsStore(TICKET_TABLE, throwing);
		expect(store.prefs).toEqual(DEFAULTS);
		expect(() => store.setWidth('tags', 200)).not.toThrow();
		expect(store.widthOf('tags')).toBe(200);
		expect(() => store.reset()).not.toThrow();
		expect(new ColumnPrefsStore(TICKET_TABLE, null).setWidth('due', 150)).toBe(150);
	});

	it('resets widths and visibility of its table only, with the info flag "Spalten zurückgesetzt"', () => {
		const storage = memoryStorage({
			'byl-columns-inbox': '{"v":1,"widths":{"kind":120},"hidden":[]}'
		});
		const flags = { show: vi.fn(() => 'flag'), dismiss: vi.fn() };
		const store = new ColumnPrefsStore(TICKET_TABLE, storage, flags);
		store.setWidth('tags', 200);
		store.setVisible('created', false);

		store.reset();

		expect(store.prefs).toEqual(DEFAULTS);
		expect(storage.data.has('byl-columns-tickets')).toBe(false);
		expect(storage.data.has('byl-columns-inbox')).toBe(true);
		expect(flags.show).toHaveBeenCalledExactlyOnceWith({ tone: 'info', title: COLUMNS_RESET_FLAG });
	});
});

describe('ColumnPrefsRegistry', () => {
	it('gives one store per table on the localStorage of the window', () => {
		const registry = new ColumnPrefsRegistry(window);
		const tickets = registry.get('tickets');
		expect(registry.get('tickets')).toBe(tickets);
		expect(registry.get('inbox')).not.toBe(tickets);
		tickets.setWidth('due', 150);
		expect(localStorage.getItem('byl-columns-tickets')).toContain('"due":150');
	});

	it('follows other tabs through the storage event and stops after disconnecting', () => {
		const registry = new ColumnPrefsRegistry(window);
		const tickets = registry.get('tickets');
		const inbox = registry.get('inbox');
		const disconnect = registry.connect();

		window.dispatchEvent(
			new StorageEvent('storage', {
				key: 'byl-columns-tickets',
				newValue: '{"v":1,"widths":{"tags":240},"hidden":["created"]}'
			})
		);
		expect(tickets.widthOf('tags')).toBe(240);
		expect(tickets.isHidden('created')).toBe(true);
		expect(inbox.prefs.widths).toEqual({});

		window.dispatchEvent(new StorageEvent('storage', { key: 'byl-theme', newValue: 'dark' }));
		expect(tickets.widthOf('tags')).toBe(240);

		// The other tab cleared the storage.
		window.dispatchEvent(new StorageEvent('storage', { key: null }));
		expect(tickets.prefs).toEqual(DEFAULTS);

		disconnect();
		window.dispatchEvent(
			new StorageEvent('storage', {
				key: 'byl-columns-tickets',
				newValue: '{"v":1,"widths":{"tags":300}}'
			})
		);
		expect(tickets.widthOf('tags')).toBe(8 * REM);
	});
});
