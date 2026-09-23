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

/** HTTP status of an SDK call: 200 on success, otherwise the status of the error. */
export async function statusOf(promise) {
	try {
		await promise;
		return 200;
	} catch (error) {
		if (typeof error?.status !== 'number' || error.status === 0) throw error;
		return error.status;
	}
}

/**
 * Rejection of an SDK call: HTTP status and the validation codes per field
 * (`data` of the PocketBase error response). Fails if the call succeeds.
 */
export async function rejectionOf(promise) {
	try {
		await promise;
	} catch (error) {
		if (typeof error?.status !== 'number' || error.status === 0) throw error;
		const data = error.response?.data ?? {};
		const codes = Object.fromEntries(Object.entries(data).map(([field, value]) => [field, value.code]));
		return { status: error.status, codes };
	}
	throw new Error('Expected the request to be rejected, but it succeeded.');
}
