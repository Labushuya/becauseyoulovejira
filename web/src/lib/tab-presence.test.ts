// Second tab of the same browser (ADR-0035 section 6; plan start-fenster, SF-3): when a new tab
// asks at all (referrer, navigation type, "Hier weiterarbeiten", installed app), the protocol on
// the channel with fake channels of several tabs, the window of 300 ms and the handler order.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	DUPLICATE_PROBE_MS,
	TAB_KEEP_KEY,
	TabPresence,
	currentNavigation,
	keepTab,
	shouldCheckForDuplicate,
	type ChannelLike,
	type NavigationFacts,
	type TabMessage
} from './tab-presence';

const ORIGIN = 'http://127.0.0.1:8090';
const facts = (extra: Partial<NavigationFacts> = {}): NavigationFacts => ({
	referrer: '',
	origin: ORIGIN,
	navigationType: 'navigate',
	keep: false,
	standalone: false,
	...extra
});

describe('shouldCheckForDuplicate', () => {
	it.each([
		['no referrer (Windows, bookmark, typed address)', facts()],
		['a foreign referrer', facts({ referrer: 'https://example.com/page' })],
		['the landing page', facts({ referrer: 'file:///C:/byl/app/becauseyoulovejira.html' })],
		['an unreadable referrer', facts({ referrer: 'kein url' })]
	])('asks for %s', (_name, input) => {
		expect(shouldCheckForDuplicate(input)).toBe(true);
	});

	it.each([
		['a link of the app (middle click)', facts({ referrer: `${ORIGIN}/tickets/abc` })],
		['a reload', facts({ navigationType: 'reload' })],
		['back and forward', facts({ navigationType: 'back_forward' })],
		['an unknown navigation', facts({ navigationType: null })],
		['a kept tab', facts({ keep: true })],
		['the window of the installed app', facts({ standalone: true })]
	])('does not ask for %s', (_name, input) => {
		expect(shouldCheckForDuplicate(input)).toBe(false);
	});
});

describe('currentNavigation and keepTab', () => {
	function fakeWindow(options: { type?: string; keep?: string | null; standalone?: boolean }) {
		const storage = new Map<string, string>();
		if (options.keep) storage.set(TAB_KEEP_KEY, options.keep);
		return {
			location: { origin: ORIGIN },
			performance: {
				getEntriesByType: () => (options.type ? [{ type: options.type }] : [])
			},
			sessionStorage: {
				getItem: (key: string) => storage.get(key) ?? null,
				setItem: (key: string, value: string) => void storage.set(key, value)
			},
			matchMedia: (query: string) => ({
				matches: query === '(display-mode: standalone)' && options.standalone === true
			}),
			storage
		};
	}

	it('reads type, keep mark, display mode, referrer and origin', () => {
		const win = fakeWindow({ type: 'navigate', keep: '1', standalone: true });
		const result = currentNavigation(win as unknown as Window, document);
		expect(result).toEqual({
			referrer: document.referrer,
			origin: ORIGIN,
			navigationType: 'navigate',
			keep: true,
			standalone: true
		});
	});

	it('treats missing entries and a blocked storage as "no hint"', () => {
		const win = {
			...fakeWindow({}),
			sessionStorage: {
				getItem: () => {
					throw new Error('SecurityError');
				}
			},
			matchMedia: undefined
		};
		const result = currentNavigation(win as unknown as Window, document);
		expect(result.navigationType).toBeNull();
		expect(result.keep).toBe(false);
		expect(result.standalone).toBe(false);
	});

	it('keeps a tab for the session and survives a blocked storage', () => {
		const win = fakeWindow({});
		keepTab(win as unknown as Window);
		expect(win.storage.get(TAB_KEEP_KEY)).toBe('1');
		const blocked = {
			sessionStorage: {
				setItem: () => {
					throw new Error('QuotaExceededError');
				}
			}
		};
		expect(() => keepTab(blocked as unknown as Window)).not.toThrow();
	});
});

/** Channels of several tabs on one bus; like BroadcastChannel, a tab does not hear itself. */
function bus() {
	const channels = new Set<FakeChannel>();
	class FakeChannel implements ChannelLike {
		readonly #listeners = new Set<(event: MessageEvent) => void>();
		closed = false;
		constructor() {
			channels.add(this);
		}
		postMessage(message: TabMessage) {
			for (const other of channels) {
				if (other === this || other.closed) continue;
				queueMicrotask(() => {
					for (const listener of other.#listeners) listener({ data: message } as MessageEvent);
				});
			}
		}
		addEventListener(_type: 'message', listener: (event: MessageEvent) => void) {
			this.#listeners.add(listener);
		}
		removeEventListener(_type: 'message', listener: (event: MessageEvent) => void) {
			this.#listeners.delete(listener);
		}
		close() {
			this.closed = true;
			channels.delete(this);
		}
	}
	return { create: () => new FakeChannel(), channels };
}

describe('TabPresence', () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it('finds an open tab within 300 ms', async () => {
		const { create } = bus();
		const open = new TabPresence(create());
		open.answer();
		const fresh = new TabPresence(create());

		const found = fresh.probe();
		await vi.advanceTimersByTimeAsync(0);
		await expect(found).resolves.toBe(true);
		expect(DUPLICATE_PROBE_MS).toBe(300);
	});

	it('finds nothing when no tab answers in time', async () => {
		const { create } = bus();
		const fresh = new TabPresence(create());
		const found = fresh.probe();
		await vi.advanceTimersByTimeAsync(299);
		let settled = false;
		void found.then(() => (settled = true));
		await vi.advanceTimersByTimeAsync(0);
		expect(settled).toBe(false);
		await vi.advanceTimersByTimeAsync(1);
		await expect(found).resolves.toBe(false);
	});

	it('does not answer while it checks itself, and does once it stays', async () => {
		const { create } = bus();
		const checking = new TabPresence(create());
		const other = new TabPresence(create());

		const first = other.probe();
		await vi.advanceTimersByTimeAsync(300);
		await expect(first).resolves.toBe(false);

		checking.answer();
		const second = other.probe();
		await vi.advanceTimersByTimeAsync(0);
		await expect(second).resolves.toBe(true);
	});

	it('passes "attention" to the last handler only, and to the fallback once it is removed', async () => {
		const { create } = bus();
		const open = new TabPresence(create());
		const fallback = vi.fn();
		const app = vi.fn();
		open.onAttention(fallback);
		const removeApp = open.onAttention(app);
		const fresh = new TabPresence(create());

		fresh.notifyOthers();
		await vi.advanceTimersByTimeAsync(0);
		expect(app).toHaveBeenCalledOnce();
		expect(fallback).not.toHaveBeenCalled();

		removeApp();
		fresh.notifyOthers();
		await vi.advanceTimersByTimeAsync(0);
		expect(fallback).toHaveBeenCalledOnce();
		expect(app).toHaveBeenCalledOnce();
	});

	it('ignores foreign messages and stops listening once closed', async () => {
		const { create, channels } = bus();
		const openChannel = create();
		const open = new TabPresence(openChannel);
		open.answer();
		const handler = vi.fn();
		open.onAttention(handler);
		const sender = create();
		sender.postMessage({ type: 'other' } as unknown as TabMessage);
		await vi.advanceTimersByTimeAsync(0);
		expect(handler).not.toHaveBeenCalled();

		open.close();
		expect(channels.has(openChannel)).toBe(false);
		const fresh = new TabPresence(create());
		const found = fresh.probe();
		await vi.advanceTimersByTimeAsync(300);
		await expect(found).resolves.toBe(false);
	});

	it('does nothing without BroadcastChannel', async () => {
		const presence = new TabPresence(null);
		presence.answer();
		presence.notifyOthers();
		await expect(presence.probe()).resolves.toBe(false);
		expect(() => presence.close()).not.toThrow();
	});
});
