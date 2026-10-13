// The sort of the day plan as a preference of this device (TP-5, S5): read and written in
// localStorage under byl-dayplan-sort, "Manuell" removes the key, other tabs follow, and storage that
// is blocked or full never breaks the plan.

import { describe, expect, it } from 'vitest';
import { DAY_PLAN_SORT_STORAGE_KEY, MANUAL_SORT } from '$lib/domain/day-plan-sort';
import { DayPlanSortStore } from './day-plan-sort.svelte';

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

describe('DayPlanSortStore (S5)', () => {
	it('starts with "Manuell" and reads a stored sort of this device', () => {
		expect(new DayPlanSortStore(fakeWindow().win).sort).toEqual(MANUAL_SORT);
		expect(new DayPlanSortStore().sort).toEqual(MANUAL_SORT);
		const stored = fakeWindow(memory({ [DAY_PLAN_SORT_STORAGE_KEY]: 'due:descending' }));
		expect(new DayPlanSortStore(stored.win).sort).toEqual({ key: 'due', direction: 'descending' });
		const broken = fakeWindow(memory({ [DAY_PLAN_SORT_STORAGE_KEY]: '{"key":"due"}' }));
		expect(new DayPlanSortStore(broken.win).sort).toEqual(MANUAL_SORT);
	});

	it('stores criterion and direction, and removes the key for "Manuell"', () => {
		const local = memory();
		const store = new DayPlanSortStore(fakeWindow(local).win);
		store.choose({ key: 'priority', direction: 'descending' });
		expect(store.sort).toEqual({ key: 'priority', direction: 'descending' });
		expect(local.items.get(DAY_PLAN_SORT_STORAGE_KEY)).toBe('priority:descending');
		store.choose({ key: 'priority', direction: 'ascending' });
		expect(local.items.get(DAY_PLAN_SORT_STORAGE_KEY)).toBe('priority:ascending');
		store.choose(MANUAL_SORT);
		expect(store.sort).toEqual(MANUAL_SORT);
		expect(local.items.has(DAY_PLAN_SORT_STORAGE_KEY)).toBe(false);
	});

	it('follows other tabs and stops after the cleanup', () => {
		const { win, storage, listeners } = fakeWindow();
		const store = new DayPlanSortStore(win);
		const stop = store.connect();
		storage(DAY_PLAN_SORT_STORAGE_KEY, 'title:ascending');
		expect(store.sort).toEqual({ key: 'title', direction: 'ascending' });
		storage('byl-theme', 'dark');
		expect(store.sort).toEqual({ key: 'title', direction: 'ascending' });
		storage(null, null);
		expect(store.sort).toEqual(MANUAL_SORT);
		stop();
		expect(listeners.size).toBe(0);
		expect(new DayPlanSortStore().connect()).toBeTypeOf('function');
	});

	it('keeps a choice for this page when the storage is blocked or full', () => {
		const store = new DayPlanSortStore(fakeWindow(throwing).win);
		expect(store.sort).toEqual(MANUAL_SORT);
		store.choose({ key: 'status', direction: 'ascending' });
		expect(store.sort).toEqual({ key: 'status', direction: 'ascending' });
		store.choose(MANUAL_SORT);
		expect(store.sort).toEqual(MANUAL_SORT);
	});
});
