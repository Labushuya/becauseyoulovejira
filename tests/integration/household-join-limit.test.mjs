// Joining a household is limited like a sign-in at the level "Streng" (ADR-0058 §3, ADR-0055
// addendum E7-2, migration 1790203810): 5 requests per 300 s and address, also for signed-in
// accounts, the valid code included; the other routes of the household are not limited, and another
// device in the home network has its own count. Against an own disposable instance with the rate
// limiter of the migrations switched on (the harness switches it off for every other test).

import { randomBytes } from 'node:crypto';
import PocketBase from 'pocketbase';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadHookLib } from '../support/hook-lib.mjs';
import { startPocketBase } from '../support/pocketbase-harness.mjs';

const security = loadHookLib('security-rules.js');
const ROUTE = '/api/byl/household';
// A device in the home network for the fixture remote-address.pb.js of the harness.
const REMOTE = 'X-Byl-Test-Remote-Address';

let instance;
let superuser;

function client() {
	const pb = new PocketBase(instance.url);
	pb.autoCancellation(false);
	return pb;
}

async function newUser() {
	const email = `user-${randomBytes(12).toString('hex')}@example.com`;
	const password = randomBytes(24).toString('base64url');
	await superuser.collection('users').create({ email, password, passwordConfirm: password });
	const pb = client();
	await pb.collection('users').authWithPassword(email, password);
	return pb;
}

/** Status and body of a route, also for refusals; `address` sends it from another device. */
async function call(pb, path, body, address = '') {
	const response = await fetch(`${instance.url}${path}`, {
		method: body === undefined ? 'GET' : 'POST',
		headers: {
			Authorization: pb.authStore.token,
			'Content-Type': 'application/json',
			...(address ? { [REMOTE]: address } : {})
		},
		body: body === undefined ? undefined : JSON.stringify(body)
	});
	const text = await response.text();
	return { status: response.status, body: text === '' ? null : JSON.parse(text) };
}

beforeAll(async () => {
	instance = await startPocketBase({ rateLimits: true });
	superuser = client();
	await superuser.collection('_superusers').authWithPassword(instance.email, instance.password);
});

afterAll(async () => {
	await instance?.stop();
});

describe('rate limit of joining a household', () => {
	it('has the rule of the strict level in the settings of both levels', async () => {
		const settings = await superuser.settings.getAll();
		expect(settings.rateLimits.enabled).toBe(true);
		expect(settings.rateLimits.rules).toEqual(security.rateLimitRules('normal'));
		for (const level of security.LEVELS) {
			expect(security.rateLimitRules(level)).toContainEqual(security.JOIN_RULE);
		}
		expect(security.JOIN_RULE).toEqual({ label: 'POST /api/byl/household/join', audience: '', duration: 300, maxRequests: 5 });
	});

	it('stops guessing after 5 attempts, the valid code included, and counts per device', async () => {
		const owner = await newUser();
		const guesser = await newUser();
		expect((await call(owner, ROUTE, { name: 'Haus' })).status).toBe(201);
		const { code } = (await call(owner, `${ROUTE}/invites`, {})).body;

		const statuses = [];
		for (const guess of ['AAAA-AAAA', 'BBBB-BBBB', 'CCCC-CCCC', 'DDDD-DDDD', 'EEEE-EEEE']) {
			statuses.push((await call(guesser, `${ROUTE}/join`, { code: guess })).status);
		}
		expect(statuses).toEqual([400, 400, 400, 400, 400]);
		expect((await call(guesser, `${ROUTE}/join`, { code })).status).toBe(429);

		// The other routes of the household stay free for signed-in accounts.
		expect((await call(guesser, ROUTE)).status).toBe(200);
		for (let i = 0; i < 6; i++) expect((await call(owner, `${ROUTE}/invites`, {})).status).toBe(201);

		// Another device has its own count; the code is still open.
		const joined = await call(guesser, `${ROUTE}/join`, { code }, '192.168.178.41');
		expect(joined.status).toBe(200);
		expect(joined.body.household.name).toBe('Haus');
	});
});
