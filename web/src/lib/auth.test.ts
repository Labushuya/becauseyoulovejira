// Unit tests for the session state (E1 plan, package 7). A real SDK client runs against a
// stubbed fetch, so the SDK's own error mapping (status 0 without a response) is covered too.

import PocketBase, {
	BaseAuthStore,
	LocalAuthStore,
	isTokenExpired,
	type AuthRecord
} from 'pocketbase';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Auth, KEEP_ALIVE_INTERVAL_MS } from './auth.svelte';

const ORIGIN = 'http://pb.test';
const USER = {
	id: 'user0000000001',
	collectionId: '_pb_users_auth_',
	collectionName: 'users',
	email: 'anna@example.com'
} satisfies AuthRecord;
const AUTH_OK = { token: 'fresh-token', record: USER };

type Reply = { status: number; body?: unknown } | Error;

/** Replaces fetch; every request takes the next reply, an Error means "no response". */
function stubFetch(...replies: Reply[]) {
	const fetchMock = vi.fn<typeof fetch>(async () => {
		const reply = replies.shift();
		if (reply === undefined) throw new Error('No reply left for this request');
		if (reply instanceof Error) throw reply;
		return new Response(JSON.stringify(reply.body ?? {}), {
			status: reply.status,
			headers: { 'Content-Type': 'application/json' }
		});
	});
	vi.stubGlobal('fetch', fetchMock);
	return fetchMock;
}

function requestOf(fetchMock: ReturnType<typeof stubFetch>, index = 0) {
	const call = fetchMock.mock.calls[index];
	if (!call) throw new Error(`No request #${index}`);
	const [url, init] = call;
	return {
		url: String(url),
		method: init?.method,
		authorization: (init?.headers as Record<string, string> | undefined)?.Authorization,
		body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined
	};
}

function clientWithSession(token = 'stored-token') {
	const client = new PocketBase(ORIGIN, new BaseAuthStore());
	client.authStore.save(token, USER);
	return client;
}

function error(status: number) {
	return { status, body: { status, message: `Error ${status}`, data: {} } };
}

const NETWORK_DOWN = new TypeError('fetch failed');

describe('Auth.restore', () => {
	it('settles without a request when no token is stored', async () => {
		const fetchMock = stubFetch();
		const auth = new Auth(new PocketBase(ORIGIN, new BaseAuthStore()));
		expect(auth.status).toBe('checking');

		const restoring = auth.restore();
		expect(auth.status).toBe('ready');
		await restoring;

		expect(auth.isLoggedIn).toBe(false);
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('refreshes a stored token and keeps the session', async () => {
		const fetchMock = stubFetch({ status: 200, body: AUTH_OK });
		const client = clientWithSession();
		const auth = new Auth(client);

		await auth.restore();

		expect(requestOf(fetchMock)).toMatchObject({
			url: `${ORIGIN}/api/collections/users/auth-refresh`,
			method: 'POST',
			authorization: 'stored-token'
		});
		expect(client.authStore.token).toBe('fresh-token');
		expect(auth.status).toBe('ready');
		expect(auth.failure).toBeNull();
		expect(auth.isLoggedIn).toBe(true);
		expect(auth.email).toBe(USER.email);
	});

	it.each([401, 403])('ends the session on %i', async (status) => {
		stubFetch(error(status));
		const client = clientWithSession();
		const auth = new Auth(client);

		await auth.restore();

		expect(client.authStore.token).toBe('');
		expect(client.authStore.record).toBeNull();
		expect(auth.status).toBe('ready');
		expect(auth.isLoggedIn).toBe(false);
	});

	it('keeps the session and reports "network" when the server is unreachable', async () => {
		stubFetch(NETWORK_DOWN);
		const client = clientWithSession();
		const auth = new Auth(client);

		await auth.restore();

		expect(client.authStore.token).toBe('stored-token');
		expect(auth.status).toBe('unreachable');
		expect(auth.failure).toBe('network');
		expect(auth.isLoggedIn).toBe(true);
	});

	it('keeps the session and reports "server" on an unexpected error response', async () => {
		stubFetch(error(500));
		const client = clientWithSession();
		const auth = new Auth(client);

		await auth.restore();

		expect(client.authStore.token).toBe('stored-token');
		expect(auth.status).toBe('unreachable');
		expect(auth.failure).toBe('server');
	});

	it('retries from "unreachable" and stays there while the retry runs', async () => {
		stubFetch(NETWORK_DOWN, { status: 200, body: AUTH_OK });
		const auth = new Auth(clientWithSession());
		await auth.restore();

		const retry = auth.restore();
		expect(auth.status).toBe('unreachable');
		expect(auth.busy).toBe(true);
		await retry;

		expect(auth.status).toBe('ready');
		expect(auth.failure).toBeNull();
		expect(auth.busy).toBe(false);
		expect(auth.isLoggedIn).toBe(true);
	});

	it('shares one request between concurrent calls', async () => {
		const fetchMock = stubFetch({ status: 200, body: AUTH_OK });
		const auth = new Auth(clientWithSession());

		await Promise.all([auth.restore(), auth.restore()]);

		expect(fetchMock).toHaveBeenCalledTimes(1);
	});
});

describe('Auth.login', () => {
	it('signs in with e-mail and password', async () => {
		const fetchMock = stubFetch({ status: 200, body: AUTH_OK });
		const client = new PocketBase(ORIGIN, new BaseAuthStore());
		const auth = new Auth(client);
		await auth.restore();

		const result = await auth.login(USER.email, 'correct horse');

		expect(result).toEqual({ ok: true });
		expect(requestOf(fetchMock)).toMatchObject({
			url: `${ORIGIN}/api/collections/users/auth-with-password`,
			method: 'POST',
			body: { identity: USER.email, password: 'correct horse' }
		});
		expect(client.authStore.token).toBe('fresh-token');
		expect(auth.isLoggedIn).toBe(true);
		expect(auth.email).toBe(USER.email);
		expect(auth.userId).toBe(USER.id);
	});

	it.each([400, 401, 404])('reports every refusal (%i) as "rejected"', async (status) => {
		stubFetch(error(status));
		const auth = new Auth(new PocketBase(ORIGIN, new BaseAuthStore()));

		expect(await auth.login(USER.email, 'wrong')).toEqual({ ok: false, failure: 'rejected' });
		expect(auth.isLoggedIn).toBe(false);
	});

	it('reports a disabled account (403 after the right password, ADR-0056 §3) as "disabled"', async () => {
		stubFetch(error(403));
		const auth = new Auth(new PocketBase(ORIGIN, new BaseAuthStore()));

		expect(await auth.login(USER.email, 'right')).toEqual({ ok: false, failure: 'disabled' });
		expect(auth.isLoggedIn).toBe(false);
	});

	it('reports too many attempts (429) as "rate_limited"', async () => {
		stubFetch(error(429));
		const auth = new Auth(new PocketBase(ORIGIN, new BaseAuthStore()));

		expect(await auth.login(USER.email, 'wrong')).toEqual({ ok: false, failure: 'rate_limited' });
		expect(auth.isLoggedIn).toBe(false);
	});

	it.each([500, 502, 503])('reports a server error (%i) as "server"', async (status) => {
		stubFetch(error(status));
		const auth = new Auth(new PocketBase(ORIGIN, new BaseAuthStore()));

		expect(await auth.login(USER.email, 'secret')).toEqual({ ok: false, failure: 'server' });
		expect(auth.isLoggedIn).toBe(false);
	});

	it('reports a missing response as "network"', async () => {
		stubFetch(NETWORK_DOWN);
		const auth = new Auth(new PocketBase(ORIGIN, new BaseAuthStore()));

		expect(await auth.login(USER.email, 'secret')).toEqual({ ok: false, failure: 'network' });
		expect(auth.isLoggedIn).toBe(false);
	});
});

describe('Auth.logout', () => {
	it('stops all realtime subscriptions before it clears the store', () => {
		const client = clientWithSession();
		const auth = new Auth(client);
		const calls: string[] = [];
		vi.spyOn(client.realtime, 'unsubscribe').mockImplementation(async (topic) => {
			calls.push(`unsubscribe(${topic ?? ''})`);
		});
		vi.spyOn(client.authStore, 'clear').mockImplementation(() => {
			calls.push('clear');
		});

		auth.logout();

		expect(calls).toEqual(['unsubscribe()', 'clear']);
	});

	it('also stops the subscriptions when the session ends elsewhere', () => {
		const client = clientWithSession();
		new Auth(client);
		const unsubscribe = vi.spyOn(client.realtime, 'unsubscribe').mockResolvedValue();

		client.authStore.clear();

		expect(unsubscribe).toHaveBeenCalledWith();
	});

	it('clears the session', () => {
		const client = clientWithSession();
		const auth = new Auth(client);
		expect(auth.isLoggedIn).toBe(true);

		auth.logout();

		expect(client.authStore.token).toBe('');
		expect(auth.isLoggedIn).toBe(false);
		expect(auth.email).toBe('');
		expect(auth.userId).toBeNull();
	});
});

describe('session persistence (LocalAuthStore)', () => {
	const storageKey = `byl-test-auth-${crypto.randomUUID()}`;

	afterEach(() => {
		localStorage.removeItem(storageKey);
	});

	it('restores the session after a reload', async () => {
		const fetchMock = stubFetch(
			{ status: 200, body: AUTH_OK },
			{ status: 200, body: { ...AUTH_OK, token: 'refreshed-token' } }
		);
		await new Auth(new PocketBase(ORIGIN, new LocalAuthStore(storageKey))).login(
			USER.email,
			'secret'
		);

		const reloaded = new PocketBase(ORIGIN, new LocalAuthStore(storageKey));
		const auth = new Auth(reloaded);
		expect(auth.isLoggedIn).toBe(true);
		await auth.restore();

		expect(requestOf(fetchMock, 1).authorization).toBe('fresh-token');
		expect(reloaded.authStore.token).toBe('refreshed-token');
		expect(auth.status).toBe('ready');
	});

	it('follows a logout in another tab', () => {
		const client = new PocketBase(ORIGIN, new LocalAuthStore(storageKey));
		client.authStore.save('stored-token', USER);
		const auth = new Auth(client);
		expect(auth.isLoggedIn).toBe(true);

		localStorage.removeItem(storageKey);
		window.dispatchEvent(new StorageEvent('storage', { key: storageKey }));

		expect(auth.isLoggedIn).toBe(false);
	});
});

/** JWT with an `exp` claim relative to the (possibly faked) current time. */
function jwt(expiresInSeconds: number): string {
	const payload = btoa(
		JSON.stringify({ type: 'auth', exp: Math.floor(Date.now() / 1000) + expiresInSeconds })
	);
	return `eyJhbGciOiJIUzI1NiJ9.${payload}.signature`;
}

const HOUR = 60 * 60;
const DAY = 24 * HOUR;

function refreshed() {
	return { status: 200, body: { token: jwt(5 * DAY), record: USER } };
}

/** Real timeout: gives a request that must not happen the chance to start. */
function pause(ms = 20) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('Auth.ensureValid', () => {
	it('accepts a token that has not expired, without a request', () => {
		const fetchMock = stubFetch();
		const auth = new Auth(clientWithSession(jwt(HOUR)));

		expect(auth.ensureValid()).toBe(true);
		expect(fetchMock).not.toHaveBeenCalled();
		expect(auth.isLoggedIn).toBe(true);
	});

	it('ends the session for an expired token, without a request', () => {
		const fetchMock = stubFetch();
		const client = clientWithSession(jwt(-1));
		const auth = new Auth(client);
		const unsubscribe = vi.spyOn(client.realtime, 'unsubscribe');

		expect(auth.ensureValid()).toBe(false);
		expect(fetchMock).not.toHaveBeenCalled();
		expect(unsubscribe).toHaveBeenCalled();
		expect(client.authStore.token).toBe('');
		expect(auth.isLoggedIn).toBe(false);
	});

	it('reports a missing session', () => {
		const auth = new Auth(new PocketBase(ORIGIN, new BaseAuthStore()));

		expect(auth.ensureValid()).toBe(false);
	});
});

describe('Auth.keepAlive', () => {
	let stop: (() => void) | undefined;

	beforeEach(() => {
		// Only the interval and the clock are fake; the SDK's request handling keeps real timers.
		vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });
		vi.setSystemTime(new Date('2026-09-24T10:00:00Z'));
	});

	afterEach(() => {
		stop?.();
		stop = undefined;
		vi.useRealTimers();
		Reflect.deleteProperty(document, 'visibilityState');
	});

	function setVisibility(state: DocumentVisibilityState) {
		Object.defineProperty(document, 'visibilityState', { configurable: true, value: state });
		document.dispatchEvent(new Event('visibilitychange'));
	}

	it('renews a token that expires within 24 hours right away, without a status change', async () => {
		const fetchMock = stubFetch(refreshed());
		const client = clientWithSession(jwt(23 * HOUR));
		const auth = new Auth(client);

		stop = auth.keepAlive();

		await vi.waitFor(() => expect(isTokenExpired(client.authStore.token, 4 * DAY)).toBe(false));
		expect(fetchMock).toHaveBeenCalledOnce();
		expect(requestOf(fetchMock).url).toBe(`${ORIGIN}/api/collections/users/auth-refresh`);
		expect(auth.status).toBe('checking');
		expect(auth.busy).toBe(false);
	});

	it('leaves a token alone that is valid for more than 24 hours', async () => {
		const fetchMock = stubFetch();
		const auth = new Auth(clientWithSession(jwt(25 * HOUR)));

		stop = auth.keepAlive();
		await pause();

		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('checks again every 30 minutes', async () => {
		const fetchMock = stubFetch(refreshed());
		const auth = new Auth(clientWithSession(jwt(DAY + 20 * 60)));
		stop = auth.keepAlive();
		await pause();
		expect(fetchMock).not.toHaveBeenCalled();

		vi.advanceTimersByTime(KEEP_ALIVE_INTERVAL_MS);

		await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
	});

	it('checks when the tab becomes visible again, not when it is hidden', async () => {
		const fetchMock = stubFetch(refreshed());
		const auth = new Auth(clientWithSession(jwt(25 * HOUR)));
		stop = auth.keepAlive();
		await pause();
		vi.setSystemTime(Date.now() + 2 * HOUR * 1000);

		setVisibility('hidden');
		await pause();
		expect(fetchMock).not.toHaveBeenCalled();

		setVisibility('visible');
		await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
	});

	it('checks when the browser goes online', async () => {
		const fetchMock = stubFetch(refreshed());
		const auth = new Auth(clientWithSession(jwt(25 * HOUR)));
		stop = auth.keepAlive();
		await pause();
		vi.setSystemTime(Date.now() + 2 * HOUR * 1000);

		window.dispatchEvent(new Event('online'));

		await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
	});

	it('ends an expired session without a request', async () => {
		const fetchMock = stubFetch();
		const client = clientWithSession(jwt(-60));
		const auth = new Auth(client);

		stop = auth.keepAlive();
		await pause();

		expect(fetchMock).not.toHaveBeenCalled();
		expect(client.authStore.token).toBe('');
		expect(auth.isLoggedIn).toBe(false);
	});

	it.each([401, 403])('ends the session when the renewal answers %i', async (status) => {
		stubFetch(error(status));
		const client = clientWithSession(jwt(HOUR));
		const auth = new Auth(client);
		const unsubscribe = vi.spyOn(client.realtime, 'unsubscribe');

		await auth.renew();

		expect(client.authStore.token).toBe('');
		expect(unsubscribe).toHaveBeenCalled();
		expect(auth.isLoggedIn).toBe(false);
	});

	it.each([
		['a network error', NETWORK_DOWN],
		['a server error', error(500)]
	])('keeps the session after %s and tries again on the next occasion', async (_name, reply) => {
		const token = jwt(HOUR);
		const fetchMock = stubFetch(reply, refreshed());
		const client = clientWithSession(token);
		const auth = new Auth(client);

		await auth.renew();
		expect(client.authStore.token).toBe(token);
		expect(auth.isLoggedIn).toBe(true);

		await auth.renew();
		expect(fetchMock).toHaveBeenCalledTimes(2);
		expect(client.authStore.token).not.toBe(token);
	});

	it('shares one request between concurrent occasions', async () => {
		const fetchMock = stubFetch(refreshed());
		const auth = new Auth(clientWithSession(jwt(HOUR)));

		await Promise.all([auth.renew(), auth.renew()]);

		expect(fetchMock).toHaveBeenCalledOnce();
	});

	it('removes its timer and listeners on cleanup', async () => {
		const fetchMock = stubFetch();
		const auth = new Auth(clientWithSession(jwt(25 * HOUR)));
		auth.keepAlive()();
		vi.setSystemTime(Date.now() + 2 * HOUR * 1000);

		vi.advanceTimersByTime(KEEP_ALIVE_INTERVAL_MS);
		setVisibility('visible');
		window.dispatchEvent(new Event('online'));
		await pause();

		expect(fetchMock).not.toHaveBeenCalled();
		expect(vi.getTimerCount()).toBe(0);
	});
});

describe('accounts and the administrator (ADR-0056)', () => {
	it('takes name and right from the record; a record from before the restart keeps the pages', () => {
		const client = clientWithSession();
		const auth = new Auth(client);
		expect([auth.name, auth.isAdmin]).toEqual(['', true]);

		client.authStore.save('stored-token', {
			...USER,
			name: 'Anna Beispiel',
			instance_admin: false
		});
		expect([auth.name, auth.isAdmin]).toEqual(['Anna Beispiel', false]);
		client.authStore.save('stored-token', { ...USER, instance_admin: true });
		expect(auth.isAdmin).toBe(true);

		auth.logout();
		expect(auth.isAdmin).toBe(false);
	});

	it('binds the realtime connection again to a new token of the same account', async () => {
		const client = clientWithSession('old-token');
		const unsubscribe = vi.fn(async () => undefined);
		const subscribe = vi.spyOn(client.realtime, 'subscribe').mockResolvedValue(unsubscribe);
		vi.spyOn(client.realtime, 'isConnected', 'get').mockReturnValue(true);
		new Auth(client);

		client.authStore.save('new-token', USER);
		await vi.waitFor(() => expect(unsubscribe).toHaveBeenCalledOnce());
		expect(subscribe).toHaveBeenCalledWith('byl/session', expect.any(Function));

		// Another account (a new sign-in) or the same token sends nothing again.
		client.authStore.save('new-token', USER);
		client.authStore.save('third-token', { ...USER, id: 'user0000000009' });
		await pause();
		expect(subscribe).toHaveBeenCalledOnce();
	});
});
