// Mail-based account flows are rejected while no mailer is configured (E1.1): known and unknown
// addresses get byte-identical answers, and password login keeps working. Also checks that the
// "new login" alert mails are switched off (migration 1790201100).

import { randomBytes } from 'node:crypto';
import { beforeAll, describe, expect, inject, it } from 'vitest';
import { createClient, pocketBaseUrl, superuserClient } from '../support/api.mjs';
import { createOwner } from '../support/scenario.mjs';

const MESSAGE =
	'E-Mail-Versand ist nicht eingerichtet. Passwort zurücksetzen: siehe README, ' +
	'Abschnitt ‚Konten verwalten‘ bzw. app\\admin-zuruecksetzen.bat.';
const ENDPOINTS = [
	'request-password-reset',
	'request-verification',
	'request-email-change',
	'request-otp'
];

let superuser;
let owner;

beforeAll(async () => {
	superuser = await superuserClient();
	owner = await createOwner(superuser);
});

function unknownEmail() {
	return `unknown-${randomBytes(8).toString('hex')}@example.com`;
}

/** Raw answer of a POST: status, content type and body bytes. */
async function post(path, body, token) {
	const headers = { 'content-type': 'application/json' };
	if (token) headers.authorization = token;
	const response = await fetch(new URL(path, pocketBaseUrl()), {
		method: 'POST',
		headers,
		body: JSON.stringify(body)
	});
	return {
		status: response.status,
		contentType: response.headers.get('content-type'),
		body: Buffer.from(await response.arrayBuffer()).toString('base64')
	};
}

describe('mail-based account flows', () => {
	it.each(
		['users', '_superusers'].flatMap((collection) =>
			ENDPOINTS.map((endpoint) => [collection, endpoint])
		)
	)('%s/%s answers known and unknown addresses byte-identically with 400', async (collection, endpoint) => {
		const known = collection === 'users' ? owner.email : inject('pocketbase').superuserEmail;
		const path = `/api/collections/${collection}/${endpoint}`;

		const forKnown = await post(path, { email: known, newEmail: unknownEmail() });
		const forUnknown = await post(path, { email: unknownEmail(), newEmail: unknownEmail() });

		expect(forKnown.status).toBe(400);
		expect(forKnown.contentType).toMatch(/^application\/json/);
		expect(JSON.parse(Buffer.from(forKnown.body, 'base64').toString('utf8'))).toEqual({
			status: 400,
			message: MESSAGE,
			data: {}
		});
		expect(forUnknown).toEqual(forKnown);
	});

	it('also rejects an authenticated e-mail change and requests by collection id', async () => {
		const expected = await post('/api/collections/users/request-password-reset', {
			email: unknownEmail()
		});

		const change = await post(
			'/api/collections/users/request-email-change',
			{ newEmail: unknownEmail() },
			owner.client.authStore.token
		);
		const byId = await post('/api/collections/_pb_users_auth_/request-password-reset', {
			email: owner.email
		});

		expect(change).toEqual(expected);
		expect(byId).toEqual(expected);
	});

	it('keeps password login and session refresh working', async () => {
		const client = createClient();
		const auth = await client.collection('users').authWithPassword(owner.email, owner.password);
		expect(auth.record.id).toBe(owner.id);

		const refreshed = await client.collection('users').authRefresh();
		expect(refreshed.record.id).toBe(owner.id);

		const admin = await superuserClient();
		expect(admin.authStore.isValid).toBe(true);
		const adminRefreshed = await admin.collection('_superusers').authRefresh();
		expect(adminRefreshed.token).toBeTruthy();
	});
});

describe('login alert mails', () => {
	it('are disabled for every auth collection', async () => {
		const authCollections = await superuser.collections.getFullList({ filter: 'type = "auth"' });

		expect(authCollections.map((collection) => collection.name).sort()).toEqual([
			'_superusers',
			'users'
		]);
		for (const collection of authCollections) {
			expect(collection.authAlert.enabled, collection.name).toBe(false);
		}
	});
});
