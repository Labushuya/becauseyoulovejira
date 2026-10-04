// Vitest globalSetup for the "integration" project: one disposable PocketBase
// instance per test run. Connection data reaches the tests only in memory via
// provide/inject (key "pocketbase").

import { randomBytes } from 'node:crypto';
import { startPocketBase } from './pocketbase-harness.mjs';
import { SERVER_READY_MS } from './timing.mjs';

/**
 * The first app account of the shared instance. Without an administrator the first account becomes
 * one (ADR-0056 §2); this account of its own takes that place, so the right lands on no account of
 * a test file, whatever file runs first. Tests that need an administrator give the right through
 * the superuser. Random credentials, in memory only and never used again.
 */
async function createFirstAccount(url, email, password) {
	const signIn = await fetch(`${url}/api/collections/_superusers/auth-with-password`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ identity: email, password }),
		signal: AbortSignal.timeout(SERVER_READY_MS)
	});
	if (signIn.status !== 200) throw new Error(`Superuser sign-in of the setup failed (${signIn.status}).`);
	const { token } = await signIn.json();
	const secret = randomBytes(24).toString('base64url');
	const created = await fetch(`${url}/api/collections/users/records`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json', Authorization: token },
		body: JSON.stringify({
			email: `first-${randomBytes(12).toString('hex')}@example.com`,
			password: secret,
			passwordConfirm: secret
		}),
		signal: AbortSignal.timeout(SERVER_READY_MS)
	});
	if (created.status !== 200) throw new Error(`First account of the setup failed (${created.status}).`);
}

/** @param {import('vitest/node').TestProject} project */
export default async function setup(project) {
	const instance = await startPocketBase();
	await createFirstAccount(instance.url, instance.email, instance.password);
	project.provide('pocketbase', {
		url: instance.url,
		superuserEmail: instance.email,
		superuserPassword: instance.password
	});
	return () => instance.stop();
}
