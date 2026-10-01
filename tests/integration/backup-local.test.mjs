// Local backups of the app (ADR-0046 §1) on a disposable instance of the harness: a backup a day
// through PocketBase (byl-<stamp>.zip in pb_data/backups), the generations kept (GFS) with a given
// clock, the state file next to pb_data, manual backups that stay, and the cron that does nothing
// in the test mode of the harness. Copies into a target folder need the control script of an app
// folder; they are tested against a copy in backup-control.test.mjs.

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { randomBytes } from 'node:crypto';
import PocketBase from 'pocketbase';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadHookLib } from '../support/hook-lib.mjs';
import { startPocketBase } from '../support/pocketbase-harness.mjs';
import { scaled } from '../support/timing.mjs';

const rules = loadHookLib('backup-rules.js');
const berlin = loadHookLib('berlin-time.js');
const DAY = 24 * 60 * 60 * 1000;
// Months before the run of the tests: the newest backup of this file counts as old.
const T0 = Date.UTC(2026, 5, 1, 8, 0, 0);

let instance;
let superuser;

function client(url) {
	const pb = new PocketBase(url);
	pb.autoCancellation(false);
	return pb;
}

beforeAll(async () => {
	instance = await startPocketBase();
	superuser = client(instance.url);
	await superuser.collection('_superusers').authWithPassword(instance.email, instance.password);
});

afterAll(async () => {
	await instance?.stop();
});

const run = (now, force = false) => superuser.send('/api/byl-test/backup/run', { method: 'POST', body: { now, force } });
const names = async () => (await superuser.backups.getFullList()).map((backup) => backup.key).sort();
const statusFile = () => JSON.parse(readFileSync(join(dirname(instance.dataDir), 'run', 'sicherung.json'), 'utf8'));

describe('local backups (ADR-0046)', () => {
	it('makes a backup when none exists and then one a day', async () => {
		const first = await run(T0);
		expect(first).toEqual({ backup: rules.backupName(T0), backupError: '', export: null });
		expect(await names()).toEqual([rules.backupName(T0)]);
		expect(statusFile().backup).toMatchObject({ at: T0, name: rules.backupName(T0), bytes: expect.any(Number) });
		expect(statusFile().backup.bytes).toBeGreaterThan(0);

		expect((await run(T0 + 60 * 60 * 1000)).backup).toBe('');
		expect((await run(T0 + DAY)).backup).toBe(rules.backupName(T0 + DAY));
		// "Jetzt sichern" always makes one.
		expect((await run(T0 + DAY + 1000, true)).backup).toBe(rules.backupName(T0 + DAY + 1000));
		// Without a target and without the control script nothing is copied or tried.
		expect(statusFile().exportAttempt ?? null).toBeNull();
	});

	it('keeps the generations by Berlin days and never removes other backups', async () => {
		await superuser.backups.create('handarbeit.zip');
		let now = T0 + 2 * DAY;
		for (let day = 0; day < 40; day += 1) {
			await run(now);
			now += DAY;
		}
		const all = await names();
		expect(all).toContain('handarbeit.zip');
		const ours = all.filter((name) => rules.isLocalName(name));
		const made = [T0, T0 + DAY, T0 + DAY + 1000, ...Array.from({ length: 40 }, (_, day) => T0 + (2 + day) * DAY)];
		const expected = rules
			.retention(
				made.map((time) => ({ name: rules.backupName(time), time, day: berlin.berlinToday(time) })),
				{ daily: 7, weekly: 4, monthly: 6 }
			)
			.keep.sort();
		expect(ours.sort()).toEqual(expected);
		expect(ours.length).toBeLessThan(made.length);
	}, scaled(120_000));

	it('does nothing in the cron of a test instance', async () => {
		expect(await superuser.send('/api/byl-test/backup/tick', { method: 'POST', body: { now: T0 + 100 * DAY } })).toEqual({ result: null });
		expect(existsSync(join(instance.dataDir, 'backups', rules.backupName(T0 + 100 * DAY)))).toBe(false);
	});

	it('keeps the routes of the page to the own instance of an app folder on Windows', async () => {
		const email = `backup-${randomBytes(6).toString('hex')}@example.com`;
		const password = randomBytes(18).toString('base64url');
		await superuser.collection('users').create({ email, password, passwordConfirm: password });
		const user = client(instance.url);
		await user.collection('users').authWithPassword(email, password);
		const expected = process.platform === 'win32' ? { status: 503, reason: 'unavailable' } : { status: 404, reason: 'platform' };
		for (const [method, path] of [
			['GET', '/api/byl/backup'],
			['POST', '/api/byl/backup/run'],
			['POST', '/api/byl/backup/settings'],
			['POST', '/api/byl/backup/passphrase']
		]) {
			const options = method === 'POST' ? { method, headers: { Origin: instance.url }, body: {} } : { method };
			const error = await user.send(path, options).catch((caught) => caught);
			expect(error.status, path).toBe(expected.status);
			expect(error.response.reason, path).toBe(expected.reason);
		}
		// The hint for the attention needs no control script: on Windows also in a test instance.
		if (process.platform === 'win32') {
			expect(await user.send('/api/byl/backup/notice', { method: 'GET' })).toEqual({ attention: true, warnings: ['stale'] });
		}
	});
});
