// Helpers for integration tests against the disposable PocketBase instance.

import { randomBytes } from 'node:crypto';
import PocketBase from 'pocketbase';
import { inject } from 'vitest';

export function pocketBaseUrl() {
	return inject('pocketbase').url;
}

export function createClient() {
	const client = new PocketBase(pocketBaseUrl());
	client.autoCancellation(false);
	return client;
}

export async function superuserClient() {
	const { superuserEmail, superuserPassword } = inject('pocketbase');
	const client = createClient();
	await client.collection('_superusers').authWithPassword(superuserEmail, superuserPassword);
	return client;
}

/**
 * Creates an app user with random credentials, so every test file works on its own data.
 * @param {PocketBase} superuser authenticated superuser client
 */
export async function createAppUser(superuser) {
	const email = `user-${randomBytes(12).toString('hex')}@example.com`;
	const password = randomBytes(24).toString('base64url');
	const record = await superuser
		.collection('users')
		.create({ email, password, passwordConfirm: password });
	return { record, email, password };
}

/** @param {{ email: string, password: string }} user */
export async function userClient(user) {
	const client = createClient();
	await client.collection('users').authWithPassword(user.email, user.password);
	return client;
}
