// Context store of the tab (KOB-1, ADR-0057): loads after the sign-in and every refresh of the
// session, starts over for another account, goes back to the most restrictive view on sign-out and
// at the end, keeps what it had when a request fails, asks again after a refusal of the context, and
// gives its capabilities to the texts outside components.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { currentCapabilities, reportRefusal, type ContextAnswer } from '$lib/data/context';
import type { AppContext } from '$lib/domain/context';
import { APP_STOPPED, RESTART_NEEDED, serverUnreachable } from '$lib/guidance/texts';
import { ContextStore, appContext, type ContextSession } from './context.svelte';

const ADMIN: AppContext = {
	admin: true,
	local: true,
	platform: 'windows',
	scripts: true,
	localUrl: 'http://127.0.0.1:8090'
};
const MEMBER: AppContext = { ...ADMIN, admin: false, scripts: false, localUrl: null };
const REMOTE: AppContext = { ...ADMIN, local: false, scripts: false };

/** A session like the auth store of the SDK; `change` signs in, refreshes or signs out. */
function session(token = '', id: string | null = null) {
	const callbacks = new Set<() => void>();
	const value: ContextSession & { change(token: string, id: string | null): void } = {
		token,
		record: id === null ? null : { id },
		onChange(callback) {
			callbacks.add(callback);
			return () => callbacks.delete(callback);
		},
		change(nextToken, nextId) {
			Object.assign(value, { token: nextToken, record: nextId === null ? null : { id: nextId } });
			for (const callback of callbacks) callback();
		}
	};
	return value;
}

/** A source whose answers the test releases one by one. */
function source() {
	const pending: ((answer: ContextAnswer) => void)[] = [];
	const load = vi.fn(
		(signal: AbortSignal) =>
			new Promise<ContextAnswer>((resolve) => {
				pending.push(resolve);
				signal.addEventListener('abort', () => resolve({ kind: 'failed' }));
			})
	);
	return {
		load,
		answer: async (answer: ContextAnswer) => {
			pending.shift()?.(answer);
			await Promise.resolve();
			await Promise.resolve();
		}
	};
}

/** Reconnections of the realtime connection; `back` reports one (the server runs again). */
function connection() {
	const callbacks = new Set<() => void>();
	const stopped = vi.fn();
	return {
		reconnected: vi.fn(async (callback: () => void) => {
			callbacks.add(callback);
			return async () => {
				callbacks.delete(callback);
				stopped();
			};
		}),
		stopped,
		back: () => {
			for (const callback of [...callbacks]) callback();
		}
	};
}

let stops: (() => void)[] = [];

afterEach(() => {
	for (const stop of stops) stop();
	stops = [];
});

describe('ContextStore', () => {
	it('stays most restrictive without a session and asks nothing', () => {
		const store = new ContextStore();
		const fake = source();
		stops.push(store.start(fake.load, session()));
		expect(store.state).toEqual({ kind: 'pending' });
		expect(store.capabilities.adminPages).toBe('hidden');
		expect(fake.load).not.toHaveBeenCalled();
	});

	it('loads with a session and keeps the state while it loads again after a refresh', async () => {
		const store = new ContextStore();
		const fake = source();
		const auth = session('t1', 'u1');
		stops.push(store.start(fake.load, auth));
		expect(store.capabilities.mode).toBe('pending');
		await fake.answer({ kind: 'ready', context: ADMIN });
		expect(store.capabilities.mode).toBe('pc');

		auth.change('t2', 'u1');
		expect(fake.load).toHaveBeenCalledTimes(2);
		// The pages of the administrator do not go while the refresh loads.
		expect(store.capabilities.mode).toBe('pc');
		await fake.answer({ kind: 'ready', context: REMOTE });
		expect(store.capabilities.mode).toBe('remote');
	});

	it('starts over for another account and goes back on sign-out', async () => {
		const store = new ContextStore();
		const fake = source();
		const auth = session('t1', 'u1');
		stops.push(store.start(fake.load, auth));
		await fake.answer({ kind: 'ready', context: ADMIN });

		auth.change('t3', 'u2');
		expect(store.capabilities.mode).toBe('pending');
		await fake.answer({ kind: 'ready', context: MEMBER });
		expect(store.capabilities.mode).toBe('member');

		auth.change('', null);
		expect(store.state).toEqual({ kind: 'pending' });
	});

	it('names a server before the restart and keeps what it had when a request fails', async () => {
		const store = new ContextStore();
		const fake = source();
		const auth = session('t1', 'u1');
		stops.push(store.start(fake.load, auth));
		await fake.answer({ kind: 'outdated' });
		expect(store.capabilities.mode).toBe('outdated');

		void store.refresh();
		await fake.answer({ kind: 'ready', context: ADMIN });
		void store.refresh();
		await fake.answer({ kind: 'failed' });
		expect(store.capabilities.mode).toBe('pc');
	});

	it.each([
		['the server before the restart (404)', { kind: 'outdated' } as const, 'outdated'],
		['a failed request', { kind: 'failed' } as const, 'pending']
	])(
		'asks again once the server is back after a restart, with the session from the storage: %s',
		async (_case, first, before) => {
			// The tab opened with the stored session (no sign-in, no refresh of the session) while the
			// server still ran the build before the update; neu-starten.bat brings it back.
			const store = new ContextStore();
			const fake = source();
			const live = connection();
			stops.push(store.start(fake.load, session('t1', 'u1'), live));
			await fake.answer(first);
			expect(store.capabilities.mode).toBe(before);
			expect(store.capabilities.adminPages).toBe('hidden');

			live.back();
			expect(fake.load).toHaveBeenCalledTimes(2);
			await fake.answer({ kind: 'ready', context: ADMIN });
			expect(store.capabilities.mode).toBe('pc');
			expect(store.capabilities.adminPages).toBe('full');
		}
	);

	it('asks nothing after a reconnection without a session and stops listening at the end', async () => {
		const store = new ContextStore();
		const fake = source();
		const live = connection();
		const auth = session();
		const stop = store.start(fake.load, auth, live);
		live.back();
		expect(fake.load).not.toHaveBeenCalled();

		auth.change('t1', 'u1');
		await fake.answer({ kind: 'ready', context: ADMIN });
		stop();
		await vi.waitFor(() => expect(live.stopped).toHaveBeenCalledOnce());
		live.back();
		expect(fake.load).toHaveBeenCalledTimes(1);
		expect(store.state).toEqual({ kind: 'pending' });
	});

	it('asks again after a refusal of the context, not after others', async () => {
		const store = new ContextStore();
		const fake = source();
		stops.push(store.start(fake.load, session('t1', 'u1')));
		await fake.answer({ kind: 'ready', context: ADMIN });
		reportRefusal('rate');
		expect(fake.load).toHaveBeenCalledTimes(1);
		reportRefusal('loopback');
		expect(fake.load).toHaveBeenCalledTimes(2);
		await fake.answer({ kind: 'ready', context: REMOTE });
		expect(store.capabilities.adminPages).toBe('pc-only');
	});

	it('goes back to the most restrictive view at the end and listens no more', async () => {
		const store = new ContextStore();
		const fake = source();
		const auth = session('t1', 'u1');
		const stop = store.start(fake.load, auth);
		await fake.answer({ kind: 'ready', context: ADMIN });
		stop();
		expect(store.state).toEqual({ kind: 'pending' });
		auth.change('t2', 'u1');
		reportRefusal('owner');
		expect(fake.load).toHaveBeenCalledTimes(1);
	});
});

describe('texts outside components follow the context of the tab', () => {
	it('name scripts only for the administrator on the machine of the app', async () => {
		const fake = source();
		stops.push(appContext.start(fake.load, session('t1', 'u1')));
		expect(currentCapabilities().mode).toBe('pending');
		expect(RESTART_NEEDED.text).not.toMatch(/\.bat/);
		expect(APP_STOPPED.description).not.toMatch(/\.bat/);
		expect(serverUnreachable()).not.toMatch(/\.bat/);

		await fake.answer({ kind: 'ready', context: ADMIN });
		expect(RESTART_NEEDED.text).toBe(
			'Die App hat ein Update bekommen, das erst nach einem Neustart wirkt: neu-starten.bat im Ordner app doppelklicken.'
		);
		expect(APP_STOPPED.description).toMatch(/^Zum Weiterarbeiten start\.bat ausführen\./);
		expect(serverUnreachable()).toMatch(/\(start\.bat\)/);

		void appContext.refresh();
		await fake.answer({ kind: 'ready', context: MEMBER });
		expect(RESTART_NEEDED.text).toBe(
			'Die App hat ein Update bekommen, das erst nach einem Neustart wirkt. Bitte den Verwalter fragen.'
		);
		expect(APP_STOPPED.description).not.toMatch(/\.bat/);
		expect(serverUnreachable()).toMatch(/Verwalter/);

		void appContext.refresh();
		await fake.answer({ kind: 'ready', context: REMOTE });
		expect(RESTART_NEEDED.text).toMatch(
			/Nur direkt am PC verfügbar, auf dem becauseyoulovejira läuft \(dort über http:\/\/127\.0\.0\.1:8090 öffnen\)\.$/
		);
		expect(serverUnreachable()).not.toMatch(/\.bat/);
	});
});
