// Catch-up at the start (E5 plan, package 3; ADR-0022 section 4, T-10) against an own disposable
// PocketBase that is restarted like the app of the user: first with the schema of E4, then with
// all migrations. When onBootstrap sees the migrated schema is noted by the probe in
// tests/fixtures/pb_hooks/recurrence-clock.pb.js (the JSVM of PocketBase 0.40.4 has no onServe).

import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import PocketBase from 'pocketbase';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadHookLib } from '../support/hook-lib.mjs';
import { startPocketBase } from '../support/pocketbase-harness.mjs';
import { FAIL_TICKET_INSERT } from '../support/scenario.mjs';
import { addDays, berlinToday } from '../../web/src/lib/domain/berlin-date.ts';
import { after, latestOnOrBefore } from '../../web/src/lib/domain/recurrence.ts';

const E5_FIRST_MIGRATION = '1790201600_recurrence_rule_params.js';
const DAY_MS = 24 * 60 * 60 * 1000;
const cleanup = loadHookLib('inbox-cleanup.js');

let instance;
let user;

const unique = () => randomBytes(6).toString('hex');
const dateOf = (value) => (value ? value.slice(0, 10) : '');
const today = () => berlinToday(Date.now());

function client() {
	const pb = new PocketBase(instance.url);
	pb.autoCancellation(false);
	return pb;
}

async function superuser() {
	const pb = client();
	await pb.collection('_superusers').authWithPassword(instance.email, instance.password);
	return pb;
}

// The URL changes with every restart, so clients are made anew.
async function owner() {
	const pb = client();
	await pb.collection('users').authWithPassword(user.email, user.password);
	return pb;
}

async function probes() {
	const response = await fetch(`${instance.url}/api/byl-test/startup`, {
		headers: { Authorization: (await superuser()).authStore.token }
	});
	return response.json();
}

function writeRows(table, id, values) {
	const db = new DatabaseSync(join(instance.dataDir, 'data.db'), { timeout: 10_000 });
	try {
		const columns = Object.keys(values);
		db.prepare(`UPDATE ${table} SET ${columns.map((column) => `${column} = ?`).join(', ')} WHERE id = ?`).run(
			...columns.map((column) => values[column]),
			id
		);
	} finally {
		db.close();
	}
}

const daysAgo = (days) => new Date(Date.now() - days * DAY_MS).toISOString().replace('T', ' ');

beforeAll(async () => {
	instance = await startPocketBase({ migrationFilter: (name) => name < E5_FIRST_MIGRATION });
	const email = `user-${unique()}@example.com`;
	const password = randomBytes(24).toString('base64url');
	const record = await (await superuser())
		.collection('users')
		.create({ email, password, passwordConfirm: password });
	user = { id: record.id, email, password };
}, 60_000);

afterAll(async () => {
	await instance?.stop();
});

describe('start of the app (ADR-0022 section 4)', () => {
	it('runs pending app migrations only after onBootstrap (T-10)', async () => {
		// First start with the schema of E4.
		expect(await probes()).toEqual({ bootstrap: false, serve: true, request: false });
		// The update: the E5 migrations are pending at this start. onBootstrap does not see them yet,
		// the first request does (`serve` runs them after the bootstrap).
		await instance.restart();
		expect(await probes()).toEqual({ bootstrap: false, serve: true, request: true });
		// Every later start sees the schema already in onBootstrap.
		await instance.restart();
		expect(await probes()).toEqual({ bootstrap: true, serve: true, request: true });
	}, 60_000);

	it('creates a missed ticket at the start, exactly once', async () => {
		const pb = await owner();
		const params = { mode: 'calendar', freq: 'weekly', weekdays: ['MO'], anchor: '2026-01-05' };
		const rule = await pb.collection('recurrence_rules').create({
			owner: user.id,
			title: 'Nach dem Urlaub',
			...params,
			anchor: '2040-01-02',
			lead_days: 0
		});
		// As if the PC had been off for two weeks: the pending date lies in the past.
		const pending = latestOnOrBefore(params, addDays(today(), -14));
		await (await superuser()).collection('recurrence_rules').update(rule.id, { anchor: params.anchor, next_due: pending });

		await instance.restart();
		const su = await superuser();
		const created = await su
			.collection('tickets')
			.getFullList({ filter: su.filter('recurrence = {:rule}', { rule: rule.id }) });
		expect(created).toHaveLength(1);
		const latest = latestOnOrBefore(params, today());
		expect(dateOf(created[0].due)).toBe(latest);
		expect(dateOf((await su.collection('recurrence_rules').getOne(rule.id)).next_due)).toBe(after(params, latest));

		await instance.restart();
		const again = await superuser();
		expect(
			await again.collection('tickets').getFullList({ filter: again.filter('recurrence = {:rule}', { rule: rule.id }) })
		).toHaveLength(1);
	}, 60_000);

	it('cleans discarded inbox items at the start', async () => {
		const pb = await owner();
		const item = await pb
			.collection('inbox_items')
			.create({ owner: user.id, channel: 'manual', kind: 'todo', title: 'Verworfen beim Start', body: 'Inhalt' });
		await pb.collection('inbox_items').update(item.id, { state: 'discarded' });
		writeRows('inbox_items', item.id, { handled_at: daysAgo(45) });

		await instance.restart();
		const cleaned = await (await owner()).collection('inbox_items').getOne(item.id);
		expect(cleaned.body).toBe(cleanup.PURGED_BODY);
	}, 60_000);

	it('starts even when a rule and the cleanup fail', async () => {
		const pb = await owner();
		const rule = await pb.collection('recurrence_rules').create({
			owner: user.id,
			title: FAIL_TICKET_INSERT,
			mode: 'calendar',
			freq: 'daily',
			anchor: '2040-01-02',
			lead_days: 0
		});
		await (await superuser()).collection('recurrence_rules').update(rule.id, { anchor: '2026-01-01', next_due: today() });
		const broken = await pb
			.collection('inbox_items')
			.create({ owner: user.id, channel: 'manual', kind: 'todo', title: 'Kaputt', body: 'Inhalt' });
		await pb.collection('inbox_items').update(broken.id, { state: 'discarded' });
		writeRows('inbox_items', broken.id, { handled_at: daysAgo(45), kind: 'unbekannt' });

		await instance.restart();
		const health = await fetch(`${instance.url}/api/health`);
		expect(health.status).toBe(200);
		const su = await superuser();
		const stored = await su.collection('recurrence_rules').getOne(rule.id);
		expect(stored.active).toBe(true);
		expect(stored.last_hint).toMatch(/^Ticket nicht erzeugt: /);
		expect(dateOf(stored.next_due)).toBe(today());
		expect((await su.collection('inbox_items').getOne(broken.id)).body).toBe('Inhalt');
	}, 60_000);
});
