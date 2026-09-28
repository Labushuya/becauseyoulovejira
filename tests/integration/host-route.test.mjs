// GET /api/byl/host (ADR-0028, plan plattformen S0-2): the operating system of the server for the
// guides of the SPA, only for signed-in app users. The shared instance runs the binary of this
// machine (pocketbase.exe on Windows, pocketbase on Linux); an own instance sets BYL_HOST_PLATFORM
// like the container image of stage S3 will.

import { randomBytes } from 'node:crypto';
import PocketBase from 'pocketbase';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createAppUser, createClient, statusOf, superuserClient, userClient } from '../support/api.mjs';
import { startPocketBase } from '../support/pocketbase-harness.mjs';

const ROUTE = '/api/byl/host';
const THIS_MACHINE = process.platform === 'win32' ? 'windows' : 'linux';

describe('GET /api/byl/host', () => {
	let superuser;
	let user;

	beforeAll(async () => {
		superuser = await superuserClient();
		user = await userClient(await createAppUser(superuser));
	});

	it('names the platform of the running binary for a signed-in user', async () => {
		expect(await user.send(ROUTE, { method: 'GET' })).toEqual({ platform: THIS_MACHINE });
	});

	it('refuses guests and superusers', async () => {
		expect(await statusOf(createClient().send(ROUTE, { method: 'GET' }))).toBe(401);
		expect(await statusOf(superuser.send(ROUTE, { method: 'GET' }))).toBe(403);
	});
});

describe('GET /api/byl/host with BYL_HOST_PLATFORM', () => {
	let instance;

	beforeAll(async () => {
		instance = await startPocketBase({ env: { BYL_HOST_PLATFORM: 'container' } });
	}, 30_000);

	afterAll(async () => {
		await instance?.stop();
	});

	it('takes the value of the variable', async () => {
		const client = new PocketBase(instance.url);
		client.autoCancellation(false);
		await client.collection('_superusers').authWithPassword(instance.email, instance.password);
		const email = `user-${randomBytes(12).toString('hex')}@example.com`;
		const password = randomBytes(24).toString('base64url');
		await client.collection('users').create({ email, password, passwordConfirm: password });
		const app = new PocketBase(instance.url);
		app.autoCancellation(false);
		await app.collection('users').authWithPassword(email, password);
		expect(await app.send(ROUTE, { method: 'GET' })).toEqual({ platform: 'container' });
	});
});
