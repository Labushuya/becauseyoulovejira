import { randomBytes } from 'node:crypto';
import PocketBase from 'pocketbase';
import { describe, expect, it } from 'vitest';
import {
	createAppUser,
	pocketBaseUrl,
	superuserClient,
	userClient
} from '../support/api.mjs';
import { credentialNames, visibleNames } from '../support/clean-env.mjs';
import { createCredentials, startPocketBase } from '../support/pocketbase-harness.mjs';

describe('disposable PocketBase instance', () => {
	it('creates superuser passwords the CLI cannot mistake for a flag', () => {
		for (let run = 0; run < 2000; run += 1) {
			const { password } = createCredentials();
			expect(password.startsWith('-'), password).toBe(false);
			expect(password.length).toBeGreaterThanOrEqual(40);
		}
	});

	it('answers /api/health with 200 on a non-production port', async () => {
		const url = new URL(pocketBaseUrl());
		expect(url.hostname).toBe('127.0.0.1');
		expect(['8090', '8099']).not.toContain(url.port);

		const response = await fetch(new URL('/api/health', url));
		expect(response.status).toBe(200);
	});

	it('authenticates as superuser with the injected credentials', async () => {
		const client = await superuserClient();
		expect(client.authStore.isValid).toBe(true);
		expect(client.authStore.isSuperuser).toBe(true);
	});

	it('creates an isolated app user that can log in', async () => {
		const superuser = await superuserClient();
		const user = await createAppUser(superuser);
		const client = await userClient(user);
		expect(client.authStore.record?.id).toBe(user.record.id);
		expect(client.authStore.isSuperuser).toBe(false);
	});

	// Clean environment (tests/support/clean-env.mjs): a BYL_* variable of the test process (here a
	// canary, on a developer machine also the real ones from the shell) never reaches the server.
	it('starts the server without the BYL_* variables of this process, only with the explicit values', async () => {
		const canary = `BYL_TEST_CANARY_${randomBytes(4).toString('hex').toUpperCase()}`;
		const explicit = `BYL_TEST_EXPLICIT_${randomBytes(4).toString('hex').toUpperCase()}`;
		process.env[canary] = 'nie-an-kindprozesse';
		let instance;
		try {
			instance = await startPocketBase({ env: { [explicit]: 'erfunden' } });
			const pb = new PocketBase(instance.url);
			pb.autoCancellation(false);
			await pb.collection('_superusers').authWithPassword(instance.email, instance.password);
			const names = [...credentialNames(), explicit, 'BYL_TELEGRAM_API_BASE', 'BYL_TEST_NOTION_PORT'];
			expect(names).toContain(canary);
			expect(await visibleNames(pb, names)).toEqual([explicit, 'BYL_TELEGRAM_API_BASE', 'BYL_TEST_NOTION_PORT'].sort());
		} finally {
			delete process.env[canary];
			await instance?.stop();
		}
	});
});
