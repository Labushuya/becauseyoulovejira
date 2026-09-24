// Login flow of the web app against the disposable instance (E1 plan, package 7): the same SDK
// calls as web/src/lib/auth.svelte.ts (authWithPassword, authRefresh).

import { randomBytes } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { createClient, statusOf, superuserClient } from '../support/api.mjs';
import { createOwner } from '../support/scenario.mjs';

let superuser;
let owner;

beforeAll(async () => {
	superuser = await superuserClient();
	owner = await createOwner(superuser);
});

/** Status and body of a rejected SDK call; fails if the call succeeds or gets no response. */
async function errorResponseOf(promise) {
	try {
		await promise;
	} catch (error) {
		if (typeof error?.status !== 'number' || error.status === 0) throw error;
		return { status: error.status, body: error.response };
	}
	throw new Error('Expected the request to be rejected, but it succeeded.');
}

/** Same token with a later expiry claim and the original signature. */
function tamperedToken(token) {
	const [header, payload, signature] = token.split('.');
	const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
	claims.exp += 365 * 24 * 60 * 60;
	return [header, Buffer.from(JSON.stringify(claims)).toString('base64url'), signature].join('.');
}

function randomHex() {
	return randomBytes(8).toString('hex');
}

describe('login with e-mail and password', () => {
	it('signs in a user created by the superuser', async () => {
		const client = createClient();

		const auth = await client.collection('users').authWithPassword(owner.email, owner.password);

		expect(auth.record.id).toBe(owner.id);
		expect(auth.record.email).toBe(owner.email);
		expect(client.authStore.isValid).toBe(true);
	});

	it('answers a wrong password and an unknown e-mail identically', async () => {
		const users = () => createClient().collection('users');

		const wrongPassword = await errorResponseOf(
			users().authWithPassword(owner.email, `wrong-${randomHex()}`)
		);
		const unknownEmail = await errorResponseOf(
			users().authWithPassword(`unknown-${randomHex()}@example.com`, owner.password)
		);

		expect(wrongPassword).toEqual({
			status: 400,
			body: { status: 400, message: 'Failed to authenticate.', data: {} }
		});
		expect(unknownEmail).toEqual(wrongPassword);
	});
});

describe('session refresh', () => {
	it('refreshes a valid token', async () => {
		const client = createClient();
		await client.collection('users').authWithPassword(owner.email, owner.password);

		const refreshed = await client.collection('users').authRefresh();

		expect(refreshed.record.id).toBe(owner.id);
		expect(client.authStore.token).toBe(refreshed.token);
		expect(client.authStore.isValid).toBe(true);
	});

	it('rejects a manipulated token with 401', async () => {
		const client = createClient();
		const { token, record } = await client
			.collection('users')
			.authWithPassword(owner.email, owner.password);
		client.authStore.save(tamperedToken(token), record);

		expect(await statusOf(client.collection('users').authRefresh())).toBe(401);
	});

	it('rejects the token of another auth collection with 403', async () => {
		expect(await statusOf(superuser.collection('users').authRefresh())).toBe(403);
	});
});
