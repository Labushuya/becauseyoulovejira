// byl-mail.exe as process (ADR-0016 sections 4 and 5; E4 plan package 11): the executable built by
// scripts/build-mail-helper.ps1 (on Linux helpers/mail/build.mjs, then without ".exe"; ADR-0028,
// plan plattformen S0) runs without Node (PATH only with the system folders), answers
// --version and --self-test without network, and fetches through a disposable PocketBase from the
// fake IMAP server. It survives an unreachable PocketBase and an outage of the mailbox, and after a
// hard stop and a new start it continues at the saved cursor without duplicates. Its log holds
// neither access data nor contents of mails.

import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { createServer as createNetServer } from 'node:net';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import PocketBase from 'pocketbase';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { spawnClean, spawnSyncClean } from '../support/clean-env.mjs';
import { startPocketBase } from '../support/pocketbase-harness.mjs';
import { scaled } from '../support/timing.mjs';
import { FakeImapServer, fakeMail } from '../../helpers/mail/test/fake-imap.ts';
import { executableName } from '../../scripts/platform.mjs';

const ROOT_DIR = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const HELPER = join(ROOT_DIR, 'helpers', 'mail', 'dist', executableName('byl-mail'));
const SYSTEM_ROOT = process.env.SystemRoot ?? 'C:\\Windows';

const TOKEN = randomBytes(24).toString('base64');
const PASSWORD = `pw-${randomBytes(8).toString('hex')}`;
const SUBJECT_SECRET = `Vertraulich ${randomBytes(4).toString('hex')}`;

let instance;
let superuser;
let owner;
let imap;
let helperPort;
const running = new Set();

async function freePort() {
	const probe = createNetServer();
	await new Promise((resolvePromise) => probe.listen(0, '127.0.0.1', resolvePromise));
	const { port } = probe.address();
	await new Promise((resolvePromise) => probe.close(resolvePromise));
	return port;
}

/** The base environment of the helper, without Node: only the system folders in PATH. */
function withoutNode() {
	if (process.platform !== 'win32') {
		return { PATH: '/usr/bin:/bin', TMPDIR: process.env.TMPDIR ?? '/tmp' };
	}
	return {
		SystemRoot: SYSTEM_ROOT,
		PATH: `${SYSTEM_ROOT}\\System32;${SYSTEM_ROOT}`,
		TEMP: process.env.TEMP ?? '',
		TMP: process.env.TMP ?? ''
	};
}

function runOnce(args) {
	const result = spawnSyncClean(HELPER, args, {
		baseEnv: withoutNode(),
		encoding: 'utf8',
		timeout: scaled(60_000),
		windowsHide: true
	});
	return { status: result.status, output: `${result.stdout}${result.stderr}` };
}

/** Starts the helper with "run"; `output()` is its console output so far. */
function startHelper(url = instance.url) {
	const child = spawnClean(HELPER, ['run', `--url=${url}`], {
		baseEnv: withoutNode(),
		env: {
			BYL_INGEST_TOKEN: TOKEN,
			BYL_TEST_MAIL_PASSWORD: PASSWORD,
			BYL_MAIL_INTERVAL_SECONDS: '1',
			BYL_MAIL_TEST_IMAP_PORT: String(imap.port),
			// Never the default 8091: a helper of the app on this machine may use it.
			BYL_MAIL_HELPER_PORT: String(helperPort)
		},
		windowsHide: true,
		stdio: ['ignore', 'pipe', 'pipe']
	});
	let output = '';
	child.stdout.on('data', (chunk) => (output += chunk));
	child.stderr.on('data', (chunk) => (output += chunk));
	running.add(child);
	child.once('exit', () => running.delete(child));
	return { child, output: () => output };
}

async function stopHelper(helper) {
	if (helper.child.exitCode !== null) return;
	const exited = new Promise((resolvePromise) => helper.child.once('exit', resolvePromise));
	helper.child.kill();
	await exited;
}

async function waitFor(check, timeoutMs = scaled(20_000)) {
	const deadline = Date.now() + timeoutMs;
	for (;;) {
		const value = await check();
		if (value) return value;
		if (Date.now() > deadline) throw new Error('Timed out waiting for the mail helper.');
		await delay(200);
	}
}

let counter = 0;
function mail(subject) {
	counter += 1;
	return imap.add(fakeMail({ subject, body: 'Inhalt der Mail', messageId: `<proc-${counter}-${randomBytes(4).toString('hex')}@example.com>` }));
}

const items = (box) => owner.pb.collection('inbox_items').getFullList({ filter: `connection = "${box.id}"`, sort: 'created' });
const connection = (box) => owner.pb.collection('connections').getOne(box.id);

beforeAll(async () => {
	if (!existsSync(HELPER)) {
		throw new Error(
			`${HELPER} is missing. Run scripts\\build-mail-helper.ps1 (scripts\\build.ps1 does it before the tests), on Linux "node helpers/mail/build.mjs".`
		);
	}
	instance = await startPocketBase({ env: { BYL_INGEST_TOKEN: TOKEN, BYL_TEST_MAIL_PASSWORD: PASSWORD } });
	superuser = new PocketBase(instance.url);
	superuser.autoCancellation(false);
	await superuser.collection('_superusers').authWithPassword(instance.email, instance.password);
	const email = `user-${randomBytes(12).toString('hex')}@example.com`;
	const password = randomBytes(24).toString('base64url');
	const record = await superuser.collection('users').create({ email, password, passwordConfirm: password });
	const pb = new PocketBase(instance.url);
	pb.autoCancellation(false);
	await pb.collection('users').authWithPassword(email, password);
	owner = { id: record.id, pb };
	imap = new FakeImapServer();
	imap.password = PASSWORD;
	await imap.start();
	helperPort = await freePort();
});

afterEach(async () => {
	for (const child of running) child.kill();
});

afterAll(async () => {
	await imap?.stop();
	await instance?.stop();
});

describe('byl-mail.exe without Node', () => {
	it('knows its version and passes the self-test without network', () => {
		const version = runOnce(['--version']);
		expect(version).toEqual({ status: 0, output: expect.stringMatching(/^byl-mail \d+\.\d+\.\d+\n$/) });
		const selfTest = runOnce(['--self-test']);
		expect(selfTest.status).toBe(0);
		expect(JSON.parse(selfTest.output)).toMatchObject({ ok: true, node: expect.stringMatching(/^v24\./) });
	});

	it('refuses unknown commands and a start without token', () => {
		expect(runOnce(['serve']).status).toBe(2);
		expect(runOnce(['run', '--url=http://example.com'])).toMatchObject({ status: 2 });
		const noToken = runOnce(['run']);
		expect(noToken.status).toBe(1);
		expect(noToken.output).toMatch(/BYL_INGEST_TOKEN fehlt/);
	});
});

describe('byl-mail.exe as process', () => {
	it('waits while PocketBase is not reachable', async () => {
		const helper = startHelper('http://127.0.0.1:9');
		await waitFor(() => /nicht erreichbar/.test(helper.output()));
		await delay(1500);
		expect(helper.child.exitCode).toBeNull();
		await stopHelper(helper);
	});

	it('fetches, survives an outage of the mailbox and continues after a hard stop', async () => {
		const box = await superuser.collection('connections').create({
			owner: owner.id,
			type: 'mail',
			label: 'Web.de',
			enabled: true,
			secret_env: 'BYL_TEST_MAIL_PASSWORD',
			settings: { provider: 'webde', user: imap.user, keywords: ['todo'] }
		});
		mail('Todo: alt, vor der Einrichtung');
		let helper = startHelper();
		await waitFor(async () => (await connection(box)).cursor !== '');
		// The first run searches the whole inbox (user decision 2026-09-27): the old mail comes too.
		await waitFor(async () => (await connection(box)).scan?.state === 'done');
		expect((await items(box)).map((item) => item.title)).toEqual(['Todo: alt, vor der Einrichtung']);
		mail('Todo: Eins');
		mail(`${SUBJECT_SECRET} ohne Stichwort`);
		await waitFor(async () => (await items(box)).length === 2);

		// Hard stop (like stop.bat), new mails and an outage of the mailbox before the restart.
		await stopHelper(helper);
		mail('Todo: Zwei');
		await imap.stop();
		helper = startHelper();
		await waitFor(async () => (await connection(box)).last_error !== '');
		expect(helper.child.exitCode).toBeNull();
		await imap.start();
		await waitFor(async () => (await items(box)).length === 3);
		await waitFor(async () => (await connection(box)).last_error === '');
		await delay(2500);
		expect((await items(box)).map((item) => item.title)).toEqual([
			'Todo: alt, vor der Einrichtung',
			'Todo: Eins',
			'Todo: Zwei'
		]);
		expect((await connection(box)).cursor).toBe(`1700000000:${imap.mails.at(-1).uid}`);
		await stopHelper(helper);

		expect(imap.writes()).toEqual([]);
		expect(imap.flagsUnchanged()).toBe(true);
		const log = helper.output();
		expect(log).toMatch(/Postfach "Web.de"/);
		for (const value of [TOKEN, PASSWORD, SUBJECT_SECRET, 'Inhalt der Mail', 'bert@example.com']) {
			expect(log).not.toContain(value);
		}
	}, scaled(90_000));

	it('offers the mailbox selection on 127.0.0.1 with the token only (package 23)', async () => {
		const box = await superuser.collection('connections').create({
			owner: owner.id,
			type: 'mail',
			label: 'Auswahl',
			enabled: true,
			secret_env: 'BYL_TEST_MAIL_PASSWORD',
			settings: { provider: 'webde', user: imap.user, keywords: ['todo'] }
		});
		const helper = startHelper();
		await waitFor(() => /Postfach-Auswahl auf http:\/\/127\.0\.0\.1:\d+ bereit/.test(helper.output()));
		const ask = (token) =>
			fetch(`http://127.0.0.1:${helperPort}/mailbox/list`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
				body: JSON.stringify({ connection: box.id, limit: 5 })
			});
		expect((await ask(null)).status).toBe(401);
		expect((await ask('falsch')).status).toBe(401);
		const answer = await ask(TOKEN);
		expect(answer.status).toBe(200);
		expect((await answer.json()).items.length).toBeGreaterThan(0);
		await stopHelper(helper);
		await superuser.collection('connections').delete(box.id);
	});
});
