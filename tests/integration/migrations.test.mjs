// Schema after all migrations, verified through the Superuser API of the disposable instance
// (E1 plan, package 3; ADR-0004).

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { pocketBaseUrl, superuserClient } from '../support/api.mjs';
import { APP_MIGRATIONS_DIR } from '../support/pocketbase-harness.mjs';
import { EXPECTED_BACKUPS, EXPECTED_COLLECTIONS, assertSchema } from '../support/schema.mjs';

describe('schema migrations', () => {
	it('creates every E1 collection with fields, relations, indexes and null rules', async () => {
		const superuser = await superuserClient();
		const collections = await superuser.collections.getFullList();
		assertSchema(collections);

		const appCollections = collections.filter((collection) => !collection.system);
		expect(appCollections.map((collection) => collection.name).sort()).toEqual(
			[...Object.keys(EXPECTED_COLLECTIONS), 'users'].sort()
		);
	});

	it('enables automatic backups every four hours, keeping 12 (ADR-0003)', async () => {
		const superuser = await superuserClient();
		const settings = await superuser.settings.getAll();
		expect(settings.backups).toMatchObject(EXPECTED_BACKUPS);
	});

	it('rejects user self-registration', async () => {
		const response = await fetch(new URL('/api/collections/users/records', pocketBaseUrl()), {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({
				email: 'self-registration@example.com',
				password: 'self-registration-1',
				passwordConfirm: 'self-registration-1'
			})
		});
		expect(response.status).toBe(403);
	});

	it('contains no users or credentials in migration files', () => {
		const files = readdirSync(APP_MIGRATIONS_DIR).filter((name) => name.endsWith('.js'));
		expect(files.length).toBeGreaterThan(0);
		for (const name of files) {
			const source = readFileSync(join(APP_MIGRATIONS_DIR, name), 'utf8');
			expect(source, name).not.toMatch(/[\w.+-]+@[\w-]+\.[a-z]{2,}/i);
			expect(source, name).not.toMatch(/password\s*[:=]/i);
			expect(source, name).not.toMatch(/\b_superusers\b|new Record\(/);
		}
	});
});
