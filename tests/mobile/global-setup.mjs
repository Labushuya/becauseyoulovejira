// Global setup of the smoke test of the phone frame (MO-1a, ADR-0073): an own disposable instance of
// the harness (CLAUDE.md §11.2 and §11.3: temp data folder, random superuser, free port, never 8090)
// with the web build of app/pb_public in its public folder, like tests/integration/web-app.test.mjs,
// and one invented account made through the API of the superuser. The first account of an instance
// is its administrator (ADR-0056). Address and account go to the tests through the environment of
// the runner (tests/mobile/instance.mjs), never to disk or the output; the returned teardown stops
// the instance and removes its data folder.

import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startPocketBase } from '../support/pocketbase-harness.mjs';
import { SERVER_READY_MS } from '../support/timing.mjs';
import { MOBILE_ENV } from './instance.mjs';

const WEB_BUILD = resolve(fileURLToPath(new URL('../../app/pb_public', import.meta.url)));

/** A request with JSON to the instance; a refusal names only method, path and status. */
async function send(url, method, body, token) {
	const response = await fetch(url, {
		method,
		headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: token } : {}) },
		body: JSON.stringify(body),
		signal: AbortSignal.timeout(SERVER_READY_MS)
	});
	if (!response.ok) {
		throw new Error(`${method} ${new URL(url).pathname} of the smoke test answered ${response.status}.`);
	}
	return response.json();
}

export default async function globalSetup() {
	if (!existsSync(join(WEB_BUILD, 'index.html'))) {
		throw new Error('app/pb_public/index.html is missing. Run npm run build first.');
	}
	const instance = await startPocketBase({ publicFiles: WEB_BUILD });
	try {
		const { token } = await send(`${instance.url}/api/collections/_superusers/auth-with-password`, 'POST', {
			identity: instance.email,
			password: instance.password
		});
		const email = `mobil-${randomBytes(8).toString('hex')}@example.com`;
		const password = randomBytes(24).toString('base64url');
		await send(`${instance.url}/api/collections/users/records`, 'POST', { email, password, passwordConfirm: password }, token);
		process.env[MOBILE_ENV.url] = instance.url;
		process.env[MOBILE_ENV.email] = email;
		process.env[MOBILE_ENV.password] = password;
	} catch (error) {
		await instance.stop();
		throw error;
	}
	return async () => {
		for (const name of Object.values(MOBILE_ENV)) delete process.env[name];
		await instance.stop();
	};
}
