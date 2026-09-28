// GET /api/byl/whatsapp-web/extension (ADR-0038 §4): the folder of the built browser extension
// next to pb_hooks and whether a build is there, for signed-in app users only. An own disposable
// instance, whose app folder is a temporary one; the test puts a build there.

import { mkdir, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { dirname, join } from 'node:path';
import PocketBase from 'pocketbase';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startPocketBase } from '../support/pocketbase-harness.mjs';
import { fetchExtensionInfo } from '../../web/src/lib/data/extension.ts';

const ROUTE = '/api/byl/whatsapp-web/extension';

let instance;
let who;
let superuser;

beforeAll(async () => {
	instance = await startPocketBase();
	superuser = new PocketBase(instance.url);
	superuser.autoCancellation(false);
	await superuser.collection('_superusers').authWithPassword(instance.email, instance.password);
	const email = `user-${randomBytes(12).toString('hex')}@example.com`;
	const password = randomBytes(24).toString('base64url');
	await superuser.collection('users').create({ email, password, passwordConfirm: password });
	who = new PocketBase(instance.url);
	who.autoCancellation(false);
	await who.collection('users').authWithPassword(email, password);
}, 60_000);

afterAll(async () => {
	await instance?.stop();
});

describe('GET /api/byl/whatsapp-web/extension', () => {
	it('needs a signed-in app user', async () => {
		expect((await fetch(`${instance.url}${ROUTE}`)).status).toBe(401);
		await expect(superuser.send(ROUTE, { method: 'GET' })).rejects.toMatchObject({ status: 403 });
	});

	it('names the folder next to pb_hooks and whether the build is there', async () => {
		const folder = join(dirname(instance.dataDir), 'erweiterung-whatsapp-web');
		expect(await fetchExtensionInfo(who)).toEqual({ folder, built: false, version: '' });

		await mkdir(folder);
		await writeFile(join(folder, 'manifest.json'), JSON.stringify({ manifest_version: 3, version: '0.1.0' }));
		expect(await fetchExtensionInfo(who)).toEqual({ folder, built: true, version: '0.1.0' });
	});
});
