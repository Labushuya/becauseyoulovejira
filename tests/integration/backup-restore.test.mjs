// Manual restore under Windows (ADR-0003, README "Backup und Wiederherstellung"): restoring via
// the Admin UI is not supported on Windows, so the README unpacks the backup ZIP with
// Expand-Archive into a new pb_data. This test follows exactly that path:
// instance A (user + ticket + inbox item with its original file, backup by the superuser) -> stop A
// -> Expand-Archive into the new data folder of instance B -> ticket, key, the original file
// (ADR-0046 §6: the backup holds the storage) and the user's old password work on B.

import { copyFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import PocketBase from 'pocketbase';
import { afterAll, describe, expect, it } from 'vitest';
import { spawnSyncClean } from '../support/clean-env.mjs';
import { startPocketBase } from '../support/pocketbase-harness.mjs';
import { POWERSHELL_EXE } from '../support/powershell.mjs';
import { createTempFolder } from '../support/temp-folders.mjs';
import { scaled } from '../support/timing.mjs';

const BACKUP_NAME = 'restore-test.zip';

const cleanup = [];

afterAll(async () => {
	const errors = [];
	for (const task of cleanup.reverse()) {
		try {
			await task();
		} catch (error) {
			errors.push(error);
		}
	}
	if (errors.length > 0) throw new AggregateError(errors, 'backup-restore cleanup failed');
});

function client(url) {
	const pb = new PocketBase(url);
	pb.autoCancellation(false);
	return pb;
}

/** The README command: Expand-Archive in Windows PowerShell with -NoProfile. */
function expandArchive(zipPath, destination) {
	const result = spawnSyncClean(
		POWERSHELL_EXE,
		[
			'-NoProfile',
			'-NonInteractive',
			'-ExecutionPolicy',
			'Bypass',
			'-Command',
			'$ErrorActionPreference = "Stop"; Expand-Archive -LiteralPath $env:BYL_ZIP -DestinationPath $env:BYL_DEST'
		],
		{
			encoding: 'utf8',
			windowsHide: true,
			timeout: scaled(60_000),
			env: { BYL_ZIP: zipPath, BYL_DEST: destination }
		}
	);
	if (result.error) throw result.error;
	if (result.status !== 0) {
		throw new Error(`Expand-Archive failed (exit code ${result.status}):\n${result.stderr}`);
	}
}

describe('backup and manual restore', () => {
	it('restores tickets, keys, original files and logins from a backup ZIP', { timeout: scaled(120_000) }, async () => {
		// Folder for the ZIP between the two instances, a temp folder of the harness: a hard end of this
		// process leaves it to the next run (temp-folders.mjs).
		const scratchDir = await createTempFolder();
		cleanup.push(() => rm(scratchDir, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 }));
		const zipPath = join(scratchDir, BACKUP_NAME);

		// Instance A: app user with a ticket, then a backup created by the superuser.
		const a = await startPocketBase();
		let aStopped = false;
		cleanup.push(() => (aStopped ? undefined : a.stop()));

		const superuserA = client(a.url);
		await superuserA.collection('_superusers').authWithPassword(a.email, a.password);
		const email = `restore-${randomBytes(8).toString('hex')}@example.com`;
		const password = randomBytes(24).toString('base64url');
		const user = await superuserA.collection('users').create({ email, password, passwordConfirm: password });

		const userA = client(a.url);
		await userA.collection('users').authWithPassword(email, password);
		const ticket = await userA
			.collection('tickets')
			.create({ title: 'Vor dem Backup angelegt', owner: user.id });
		expect(ticket.key).toBe('TASK-1');
		const mail = `Message-ID: <${randomBytes(8).toString('hex')}@example.com>\r\nSubject: Original\r\n\r\nHallo`;
		const form = new FormData();
		form.append('owner', user.id);
		form.append('channel', 'eml');
		form.append('kind', 'mail');
		form.append('title', 'Mit Original');
		form.append('original', new Blob([mail], { type: 'message/rfc822' }), 'mail.eml');
		const item = await userA.collection('inbox_items').create(form);
		expect(item.original).toMatch(/^mail_\w+\.eml$/);

		await superuserA.backups.create(BACKUP_NAME);
		expect((await superuserA.backups.getFullList()).map((backup) => backup.key)).toContain(BACKUP_NAME);
		await copyFile(join(a.dataDir, 'backups', BACKUP_NAME), zipPath);

		await a.stop();
		aStopped = true;

		// Instance B: new data folder filled exactly like the README describes.
		const b = await startPocketBase({ prepareDataDir: async (dataDir) => expandArchive(zipPath, dataDir) });
		cleanup.push(() => b.stop());

		const userB = client(b.url);
		await userB.collection('users').authWithPassword(email, password);
		const restored = await userB.collection('tickets').getFullList();
		expect(restored.map(({ id, key, title }) => ({ id, key, title }))).toEqual([
			{ id: ticket.id, key: 'TASK-1', title: 'Vor dem Backup angelegt' }
		]);

		// The original file came back with the storage of the backup.
		const restoredItem = await userB.collection('inbox_items').getOne(item.id);
		expect(restoredItem.original).toBe(item.original);
		const fileToken = await userB.files.getToken();
		const file = await fetch(`${b.url}/api/files/inbox_items/${item.id}/${item.original}?token=${encodeURIComponent(fileToken)}`);
		expect(file.status).toBe(200);
		expect(await file.text()).toBe(mail);

		// The restored counter continues the numbering instead of starting over.
		const next = await userB.collection('tickets').create({ title: 'Nach der Wiederherstellung', owner: user.id });
		expect(next.key).toBe('TASK-2');
	});
});
