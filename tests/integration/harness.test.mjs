import { describe, expect, it } from 'vitest';
import {
	createAppUser,
	pocketBaseUrl,
	superuserClient,
	userClient
} from '../support/api.mjs';

describe('disposable PocketBase instance', () => {
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
});
