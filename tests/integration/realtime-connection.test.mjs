// Realtime on one connection (plan EH-5 §3.8): the setup assistant subscribes to exactly one
// connection (topic connections/<id>) while it waits for the first run, without polling. The
// server checks such a topic against the viewRule of connections (owner, or a member of its
// household), for every event again; changes the server makes itself (last run, hint, as the cron
// job and the ingest route save them through the app) are broadcast like those of the owner. Node
// 24 provides EventSource only with --experimental-eventsource, which vitest.config.mjs passes to
// the integration workers.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createScenario } from '../support/scenario.mjs';

const EVENT_TIMEOUT_MS = 5_000;
const QUIET_PERIOD_MS = 500;

/** Collects the events of one record topic with the fields the assistant asks for. */
async function subscribeOne(client, id) {
	const events = [];
	await client.collection('connections').subscribe(
		id,
		(event) =>
			events.push({ action: event.action, id: event.record.id, hint: event.record.last_hint }),
		{ fields: 'id,label,last_run_at,last_hint' }
	);
	return events;
}

async function until(check) {
	const start = Date.now();
	while (!check()) {
		if (Date.now() - start > EVENT_TIMEOUT_MS) throw new Error('No realtime event in time');
		await new Promise((resolve) => setTimeout(resolve, 50));
	}
}

const quiet = () => new Promise((resolve) => setTimeout(resolve, QUIET_PERIOD_MS));

describe('realtime subscription on one connection (plan EH-5)', () => {
	let s;

	beforeAll(async () => {
		s = await createScenario();
	});

	afterAll(async () => {
		for (const client of [s?.a, s?.b, s?.c]) {
			await client?.realtime.unsubscribe();
		}
	});

	it('delivers the changes of a private connection only to its owner, also those of the server', async () => {
		const connection = await s.a.collection('connections').create({
			owner: s.ids.a,
			type: 'calendar',
			label: 'Kalender',
			enabled: true,
			secret_env: 'BYL_TEST_CALENDAR'
		});
		const a = await subscribeOne(s.a, connection.id);
		const b = await subscribeOne(s.b, connection.id);
		const c = await subscribeOne(s.c, connection.id);

		await s.a.collection('connections').update(connection.id, { label: 'Kalender privat' });
		await s.superuser.collection('connections').update(connection.id, {
			last_run_at: '2026-09-26 10:00:00.000Z',
			last_hint: 'Erster Abruf'
		});

		await until(() => a.some((event) => event.hint === 'Erster Abruf'));
		expect(a.length).toBeGreaterThanOrEqual(2);
		expect(a.every((event) => event.action === 'update' && event.id === connection.id)).toBe(true);
		await quiet();
		expect(b).toEqual([]);
		expect(c).toEqual([]);
	});

	it('delivers a household connection to the members of the household only', async () => {
		const connection = await s.a.collection('connections').create({
			owner: s.ids.a,
			household: s.h1.id,
			type: 'calendar',
			label: 'Kalender Haushalt',
			enabled: true,
			secret_env: 'BYL_TEST_CALENDAR'
		});
		const b = await subscribeOne(s.b, connection.id);
		const c = await subscribeOne(s.c, connection.id);

		await s.superuser.collection('connections').update(connection.id, { last_hint: 'Erster Abruf' });

		await until(() => b.some((event) => event.hint === 'Erster Abruf'));
		await quiet();
		expect(c).toEqual([]);
	});

	it('sends the deletion of the connection to its owner', async () => {
		const connection = await s.a.collection('connections').create({
			owner: s.ids.a,
			type: 'calendar',
			label: 'Kalender weg',
			enabled: true,
			secret_env: 'BYL_TEST_CALENDAR'
		});
		const a = await subscribeOne(s.a, connection.id);

		await s.a.collection('connections').delete(connection.id);

		await until(() => a.some((event) => event.action === 'delete'));
		expect(a.map((event) => [event.action, event.id])).toEqual([['delete', connection.id]]);
	});
});
