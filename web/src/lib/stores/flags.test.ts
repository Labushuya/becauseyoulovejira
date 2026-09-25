// Flag store (ADR-0025 section 8; plan UI-Konsistenz, package UI-5): duration, errors stay, at
// most three with the newest first, the pause reasons, the action and `onclose`, the messages of
// the live regions. Fake timers stand in for the clock.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FLAG_DURATION_MS, FlagStore, MAX_FLAGS, SILENT_FLAGS } from './flags.svelte';

beforeEach(() => {
	vi.useFakeTimers();
});

afterEach(() => {
	vi.useRealTimers();
});

const titles = (store: FlagStore) => store.flags.map((flag) => flag.title);

describe('flag store: duration', () => {
	it('lets success and info leave after 8 s and keeps errors until closed', () => {
		const store = new FlagStore();
		expect(FLAG_DURATION_MS).toBe(8000);
		store.show({ tone: 'success', title: 'Gespeichert.' });
		store.show({ tone: 'info', title: 'Hinweis.' });
		store.show({ tone: 'error', title: 'Fehlgeschlagen.' });

		vi.advanceTimersByTime(FLAG_DURATION_MS - 1);
		expect(titles(store)).toEqual(['Fehlgeschlagen.', 'Hinweis.', 'Gespeichert.']);
		vi.advanceTimersByTime(1);
		expect(titles(store)).toEqual(['Fehlgeschlagen.']);
		vi.advanceTimersByTime(60_000);
		expect(titles(store)).toEqual(['Fehlgeschlagen.']);
	});

	it('takes an own duration, and null keeps a success flag', () => {
		const store = new FlagStore();
		store.show({ tone: 'success', title: 'Kurz', duration: 1000 });
		store.show({ tone: 'success', title: 'Bleibt', duration: null });
		vi.advanceTimersByTime(1000);
		expect(titles(store)).toEqual(['Bleibt']);
		vi.advanceTimersByTime(60_000);
		expect(titles(store)).toEqual(['Bleibt']);
	});
});

describe('flag store: stack', () => {
	it('shows at most three, the newest first, and pushes out the oldest', () => {
		const store = new FlagStore();
		const closed: string[] = [];
		for (const title of ['A', 'B', 'C', 'D']) {
			store.show({ tone: 'success', title, onclose: () => closed.push(title) });
		}
		expect(MAX_FLAGS).toBe(3);
		expect(titles(store)).toEqual(['D', 'C', 'B']);
		expect(closed).toEqual(['A']);
	});

	it('closes with dismiss and calls onclose exactly once', () => {
		const store = new FlagStore();
		const onclose = vi.fn();
		const id = store.show({ tone: 'error', title: 'X', onclose });
		store.dismiss(id);
		store.dismiss(id);
		store.dismiss('flag-unknown');
		expect(store.flags).toEqual([]);
		expect(onclose).toHaveBeenCalledOnce();
	});

	it('runs the action before onclose and closes the flag', () => {
		const store = new FlagStore();
		const calls: string[] = [];
		const id = store.show({
			tone: 'success',
			title: 'TASK-3 erledigt.',
			action: { label: 'Rückgängig', run: () => calls.push('run') },
			onclose: () => calls.push('close')
		});
		expect(store.flags[0]?.action?.label).toBe('Rückgängig');
		store.act(id);
		expect(calls).toEqual(['run', 'close']);
		expect(store.flags).toEqual([]);
	});

	it('clears every flag and the messages', () => {
		const store = new FlagStore();
		const onclose = vi.fn();
		store.show({ tone: 'success', title: 'A', onclose });
		store.show({ tone: 'error', title: 'B', onclose });
		store.clear();
		expect(store.flags).toEqual([]);
		expect(onclose).toHaveBeenCalledTimes(2);
		expect(store.statusMessage).toBeNull();
		expect(store.alertMessage).toBeNull();
	});
});

describe('flag store: pause', () => {
	it('stops the clock while paused and goes on with the time that was left', () => {
		const store = new FlagStore();
		store.show({ tone: 'success', title: 'A' });
		vi.advanceTimersByTime(3000);
		store.pause('hover');
		expect(store.paused).toBe(true);
		vi.advanceTimersByTime(60_000);
		expect(titles(store)).toEqual(['A']);
		store.resume('hover');
		expect(store.paused).toBe(false);
		vi.advanceTimersByTime(4999);
		expect(titles(store)).toEqual(['A']);
		vi.advanceTimersByTime(1);
		expect(store.flags).toEqual([]);
	});

	it('goes on only when every reason is gone', () => {
		const store = new FlagStore();
		store.pause('modal');
		store.show({ tone: 'info', title: 'Unter dem Modal' });
		store.pause('hidden');
		store.pause('hidden');
		store.resume('modal');
		vi.advanceTimersByTime(60_000);
		expect(titles(store)).toEqual(['Unter dem Modal']);
		store.resume('focus');
		expect(store.paused).toBe(true);
		store.resume('hidden');
		vi.advanceTimersByTime(FLAG_DURATION_MS);
		expect(store.flags).toEqual([]);
	});
});

describe('flag store: live regions', () => {
	it('gives success and info to the polite region and errors to the assertive one', () => {
		const store = new FlagStore();
		expect(store.statusMessage).toBeNull();
		expect(store.alertMessage).toBeNull();
		store.show({ tone: 'success', title: 'Projekt angelegt.', description: 'Code HAUS.' });
		expect(store.statusMessage?.text).toBe('Projekt angelegt. Code HAUS.');
		store.show({ tone: 'error', title: 'Nicht gespeichert.' });
		expect(store.alertMessage?.text).toBe('Nicht gespeichert.');
		expect(store.statusMessage?.text).toBe('Projekt angelegt. Code HAUS.');
	});

	it('counts the same text again as a new message', () => {
		const store = new FlagStore();
		store.show({ tone: 'success', title: 'Gespeichert.' });
		const first = store.statusMessage?.id;
		store.show({ tone: 'success', title: 'Gespeichert.' });
		expect(store.statusMessage?.id).not.toBe(first);
	});

	it('has a silent sink for views and tests without flags', () => {
		expect(SILENT_FLAGS.show({ tone: 'success', title: 'x' })).toBe('');
		expect(() => SILENT_FLAGS.dismiss('')).not.toThrow();
	});
});
