// The outbox of the app without the capability (OF-2b, ADR-0074 addendum OF-2b, G1): it creates
// nothing in the browser, neither the identifier of the tab in sessionStorage nor a
// BroadcastChannel (they come with its first watch); the question about `offline_ops` goes again
// at most every 5 minutes while the server does not report it, at once after a sign-out.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TAB_KEY, forgetOfflineSupport, getOutbox, offlineSupport } from './app-outbox';

const mocks = vi.hoisted(() => ({ fetchSupport: vi.fn() }));

vi.mock('$lib/data/ticket-create', async (importOriginal) => ({
	...(await importOriginal<object>()),
	fetchCreateSupport: mocks.fetchSupport
}));

const NOW = Date.UTC(2026, 9, 20, 12, 30, 0);
const USER = 'user00000000001';

describe('the outbox of the app without the capability (G1)', () => {
	it('creates neither the identifier of the tab nor a BroadcastChannel', async () => {
		sessionStorage.clear();
		const opened = vi.fn();
		vi.stubGlobal(
			'BroadcastChannel',
			class {
				constructor(name: string) {
					opened(name);
				}
				postMessage() {}
				addEventListener() {}
				removeEventListener() {}
			}
		);
		const outbox = getOutbox();
		outbox.attach(USER);
		outbox.setSupport(null);
		// Since the package "Einschalten" with the answer "yes", so only the missing capability decides.
		outbox.setConsent(true);
		outbox.setFrame(true);
		const flags = { show: vi.fn(() => ''), dismiss: vi.fn() };
		const stop = outbox.connect({ upsert: vi.fn(), flags, sessionEnded: vi.fn() });
		await Promise.resolve();
		expect(outbox.watching).toBe(false);
		expect(sessionStorage.getItem(TAB_KEY)).toBeNull();
		expect(opened).not.toHaveBeenCalled();
		stop();
		outbox.attach(null);
	});
});

describe('the question about the capability (G1)', () => {
	beforeEach(() => {
		vi.useFakeTimers({ toFake: ['Date'] });
		vi.setSystemTime(NOW);
		forgetOfflineSupport();
		mocks.fetchSupport.mockReset();
	});

	afterEach(() => {
		forgetOfflineSupport();
		vi.useRealTimers();
	});

	// Changed in round 2 of "Einschalten" (E-2): the answer says whether the server answered, so
	// "Darstellung" tells "the server cannot" from "unknown"; the timing stays.
	it('goes again at most every 5 minutes while the server does not report the outbox', async () => {
		mocks.fetchSupport.mockResolvedValue(null);
		expect(await offlineSupport()).toEqual({ ops: null, answered: true });
		for (const minutes of [1, 2, 4]) {
			vi.setSystemTime(NOW + minutes * 60_000);
			expect(await offlineSupport()).toEqual({ ops: null, answered: true });
		}
		expect(mocks.fetchSupport).toHaveBeenCalledTimes(1);
		vi.setSystemTime(NOW + 5 * 60_000);
		await offlineSupport();
		expect(mocks.fetchSupport).toHaveBeenCalledTimes(2);
	});

	it('goes at once after a sign-out, and not again once the server reported the outbox', async () => {
		mocks.fetchSupport.mockResolvedValue(null);
		await offlineSupport();
		forgetOfflineSupport();
		const ops = { version: 1, kinds: ['ticket.update'] };
		mocks.fetchSupport.mockResolvedValue({ offlineOps: ops });
		expect(await offlineSupport()).toEqual({ ops, answered: true });
		vi.setSystemTime(NOW + 60 * 60_000);
		expect(await offlineSupport()).toEqual({ ops, answered: true });
		expect(mocks.fetchSupport).toHaveBeenCalledTimes(2);
	});

	// Changed in round 2 of "Einschalten" (E-2): still without the outbox and asked again as late, but
	// marked as not answered, so "Darstellung" says "Gerade nicht prüfbar" instead of the restart.
	it('takes a failed question like an answer without the outbox, marked as not answered', async () => {
		mocks.fetchSupport.mockRejectedValue(new Error('offline'));
		expect(await offlineSupport()).toEqual({ ops: null, answered: false });
		vi.setSystemTime(NOW + 60_000);
		expect(await offlineSupport()).toEqual({ ops: null, answered: false });
		expect(mocks.fetchSupport).toHaveBeenCalledTimes(1);
	});
});
