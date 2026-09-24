// Unit tests for the session state (E1 plan, package 7). A real SDK client runs against a
// stubbed fetch, so the SDK's own error mapping (status 0 without a response) is covered too.

import PocketBase, { BaseAuthStore, LocalAuthStore, type AuthRecord } from 'pocketbase';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Auth } from './auth.svelte';

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
	});

	it.each([400, 429, 500])('reports every refusal (%i) as "rejected"', async (status) => {
		stubFetch(error(status));
		const auth = new Auth(new PocketBase(ORIGIN, new BaseAuthStore()));

		expect(await auth.login(USER.email, 'wrong')).toEqual({ ok: false, failure: 'rejected' });
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
	it('clears the session', () => {
		const client = clientWithSession();
		const auth = new Auth(client);
		expect(auth.isLoggedIn).toBe(true);

		auth.logout();

		expect(client.authStore.token).toBe('');
		expect(auth.isLoggedIn).toBe(false);
		expect(auth.email).toBe('');
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
