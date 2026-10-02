// Data layer of the folder channel (web/src/lib/data/connections.ts, data/folders.ts and the field
// watch of data/inbox.ts; ADR-0051 §7, plan beobachtete-quellen OD-2) against a disposable
// PocketBase in the test mode and folders in a temp folder of the test (never a folder of the
// user): a user creates the connection with its first folder and no variable, adds one with its own
// target project, changes the interval, runs it, reads the details, takes files of before over in
// the shapes of the SPA, and opens the current file of an entry through "Ansehen"; refusals of the
// hook come as field errors with the texts of the interface, a gone file as a refusal with its
// text.

import { randomBytes } from 'node:crypto';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, unlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import PocketBase from 'pocketbase';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startPocketBase } from '../support/pocketbase-harness.mjs';
import {
	createConnection,
	getConnection,
	runConnection,
	saveFolderSettings
} from '../../web/src/lib/data/connections.ts';
import { DataError } from '../../web/src/lib/data/errors.ts';
import {
	adoptFiles,
	getFolderDetails,
	listExistingFiles,
	viewFolderFile
} from '../../web/src/lib/data/folders.ts';
import { listNewItems } from '../../web/src/lib/data/inbox.ts';
import { emptyConnectionDraft } from '../../web/src/lib/domain/connections.ts';
import {
	DEFAULT_EXCLUDE,
	FILE_REFUSAL_MESSAGES,
	FOLDER_MESSAGES,
	folderSettingsOf,
	parseFolderPath
} from '../../web/src/lib/domain/folders.ts';
import { TARGET_MESSAGES } from '../../web/src/lib/domain/target-project.ts';

const PLATFORM = process.platform === 'win32' ? 'windows' : 'posix';
const PDF = Buffer.from('%PDF-1.4\n% Angebot\n%%EOF\n', 'latin1');

let base;
let projekte;
let archiv;
let instance;
let superuser;
let pb;
let ownerId;
let connection;
// Times of change a month ago in whole seconds, so every file system keeps them exactly.
let clock = Math.floor((Date.now() - 30 * 24 * 3600 * 1000) / 1000) * 1000;

/** A folder of the test in the form the server stores (long names, a capital drive letter). */
function folderPath(name) {
	const path = join(base, name);
	mkdirSync(path, { recursive: true });
	const parsed = parseFolderPath(path, PLATFORM);
	if (!('path' in parsed)) throw new Error(`invalid test folder (${parsed.code})`);
	return parsed.path;
}

function put(dir, rel, content) {
	const path = join(dir, ...rel.split('/'));
	mkdirSync(join(path, '..'), { recursive: true });
	writeFileSync(path, content);
	clock += 61_000;
	utimesSync(path, new Date(clock), new Date(clock));
	return path;
}

function folder(path, overrides = {}) {
	return {
		path,
		subfolders: true,
		types: [],
		exclude: [...DEFAULT_EXCLUDE],
		target: null,
		reportChanges: true,
		...overrides
	};
}

async function refusal(promise) {
	return promise.then(
		() => null,
		(error) => error
	);
}

beforeAll(async () => {
	base = realpathSync.native(mkdtempSync(join(tmpdir(), 'byl-ordner-web-')));
	projekte = folderPath('Projekte');
	archiv = folderPath('Archiv');
	put(projekte, 'Bericht 2025.pdf', PDF);
	put(projekte, 'notizen/plan.md', '# Plan\n');
	put(projekte, 'alt.tmp', 'x');
	instance = await startPocketBase();
	superuser = new PocketBase(instance.url);
	superuser.autoCancellation(false);
	await superuser.collection('_superusers').authWithPassword(instance.email, instance.password);
	// The first user is the owner of the instance, who alone may view files (ADR-0043 §4).
	const email = `ordner-${randomBytes(12).toString('hex')}@example.com`;
	const password = randomBytes(24).toString('base64url');
	const user = await superuser.collection('users').create({ email, password, passwordConfirm: password });
	ownerId = user.id;
	pb = new PocketBase(instance.url);
	pb.autoCancellation(false);
	await pb.collection('users').authWithPassword(email, password);
});

afterAll(async () => {
	await instance?.stop();
	if (base) rmSync(base, { recursive: true, force: true });
});

describe('data layer of the folder channel', () => {
	it('creates the connection with its first folder, without a variable, and the default interval', async () => {
		connection = await createConnection(pb, {
			...emptyConnectionDraft('folder'),
			label: 'Projekte',
			folder: folder(projekte)
		});
		expect(connection).toMatchObject({
			type: 'folder',
			label: 'Projekte',
			secretEnv: '',
			keywords: [],
			enabled: true,
			folders: { interval: 5, folders: [folder(projekte)] }
		});
		const stored = await pb.collection('connections').getOne(connection.id);
		expect(stored.secret_env).toBe('');
		expect(folderSettingsOf(stored.settings)).toEqual(connection.folders);
	});

	it('says refusals of the hook with the texts of the interface', async () => {
		const missing = await refusal(
			saveFolderSettings(pb, connection.id, {
				interval: 5,
				folders: [folder(projekte), folder(join(base, 'gibt-es-nicht'))]
			})
		);
		expect(missing).toBeInstanceOf(DataError);
		expect(missing.fields.settings).toMatchObject({
			code: 'validation_folder_missing',
			message: FOLDER_MESSAGES.validation_folder_missing
		});
		const interval = await refusal(saveFolderSettings(pb, connection.id, { interval: 90, folders: [] }));
		expect(interval.fields.settings.message).toBe(FOLDER_MESSAGES.validation_folder_interval);
		const archived = await pb.collection('projects').create({ owner: ownerId, name: 'Alt', code: 'ALT' });
		await pb.collection('projects').update(archived.id, { archived: true });
		const target = await refusal(
			saveFolderSettings(pb, connection.id, {
				interval: 5,
				folders: [folder(projekte, { target: archived.id })]
			})
		);
		expect(target.fields.settings).toMatchObject({
			code: 'validation_target_project_archived',
			message: TARGET_MESSAGES.validation_target_project_archived
		});
		// A new connection with a folder that is not there is not created at all.
		const created = await refusal(
			createConnection(pb, {
				...emptyConnectionDraft('folder'),
				label: 'Fehlt',
				folder: folder(join(base, 'fehlt'))
			})
		);
		expect(created.fields.settings.code).toBe('validation_folder_missing');
	});

	it('adds a folder with its own target project and another interval', async () => {
		const project = await pb.collection('projects').create({ owner: ownerId, name: 'Haus', code: 'HAUS' });
		const settings = {
			interval: 10,
			folders: [folder(projekte), folder(archiv, { types: ['pdf'], reportChanges: false, target: project.id })]
		};
		const saved = await saveFolderSettings(pb, connection.id, settings);
		expect(saved.folders).toEqual(settings);
		expect((await getConnection(pb, connection.id)).folders).toEqual(settings);
	});

	it('runs once for the base, then reads the details and the files of before', async () => {
		const result = await runConnection(pb, connection.id);
		expect(result).toMatchObject({ status: 'ok', created: 0, error: '' });
		const details = await getFolderDetails(pb, connection.id);
		expect(details).toMatchObject({ interval: 10, platform: PLATFORM, limit: 2000 });
		expect(details.folders.map((entry) => [entry.path, entry.name, entry.files])).toEqual([
			[projekte, 'Projekte', 2],
			[archiv, 'Archiv', 0]
		]);
		const [first] = details.folders;
		expect(first.id).toMatch(/^[0-9a-f]{16}$/);
		expect(first.baseAt).not.toBe('');
		expect(first.error).toBe('');

		const existing = await listExistingFiles(pb, connection.id, first.id);
		expect(existing).toMatchObject({ folder: projekte, name: 'Projekte', base: true });
		expect(existing.files.map((file) => [file.path, file.state])).toEqual([
			['Bericht 2025.pdf', ''],
			['notizen/plan.md', '']
		]);
		expect(existing.files[0]).toMatchObject({ name: 'Bericht 2025.pdf', size: PDF.length });

		expect(await adoptFiles(pb, connection.id, first.id, ['Bericht 2025.pdf', 'fehlt.pdf'])).toEqual({
			created: 1,
			duplicates: 0,
			skipped: 1,
			failed: 0
		});
		expect(await adoptFiles(pb, connection.id, first.id, ['Bericht 2025.pdf'])).toMatchObject({
			created: 0,
			duplicates: 1
		});
		const again = await listExistingFiles(pb, connection.id, first.id);
		expect(again.files.find((file) => file.path === 'Bericht 2025.pdf')?.state).toBe('new');
		const unknown = await refusal(listExistingFiles(pb, connection.id, '0000000000000000'));
		expect(unknown).toBeInstanceOf(DataError);
	});

	it('brings a new file into the inbox and opens its current version through "Ansehen"', async () => {
		const path = put(projekte, '2026/Angebot.pdf', PDF);
		expect(await runConnection(pb, connection.id)).toMatchObject({ status: 'ok', created: 1 });
		const items = (await listNewItems(pb)).filter((item) => item.connectionId === connection.id);
		const entry = items.find((item) => item.title === 'Neue Datei: Angebot.pdf');
		expect(entry).toMatchObject({
			channel: 'folder',
			kind: 'file',
			sourceRef: path,
			original: '',
			watch: { kind: 'file', state: 'current', since: null }
		});
		expect(entry.sourceMeta.folder).toMatchObject({ folder: 'Projekte', path: '2026/Angebot.pdf', size: PDF.length });

		const outcome = await viewFolderFile(pb, entry.id);
		expect(outcome.kind).toBe('ok');
		expect(outcome.view).toMatchObject({ name: 'Angebot.pdf', path: '2026/Angebot.pdf', folder: 'Projekte', inline: true });
		expect(outcome.view.url.startsWith(`${instance.url}/api/byl/folders/items/${entry.id}/file?token=`)).toBe(true);
		// The address works as a link of the browser: without the session, with its short token.
		const inline = await fetch(outcome.view.url);
		expect(inline.status).toBe(200);
		expect(inline.headers.get('content-type')).toBe('application/pdf');
		expect(Buffer.from(await inline.arrayBuffer()).equals(PDF)).toBe(true);
		const download = await fetch(`${outcome.view.url}&download=1`);
		expect(download.headers.get('content-disposition')).toMatch(/^attachment;/);
		await download.arrayBuffer();
	});

	it('says that a gone file is gone, and its entry shows it after the next run', async () => {
		const items = (await listNewItems(pb)).filter((item) => item.connectionId === connection.id);
		const entry = items.find((item) => item.title === 'Neue Datei: Angebot.pdf');
		unlinkSync(join(projekte, '2026', 'Angebot.pdf'));
		expect(await viewFolderFile(pb, entry.id)).toEqual({
			kind: 'refused',
			reason: 'missing',
			message: FILE_REFUSAL_MESSAGES.missing
		});
		await runConnection(pb, connection.id);
		const after = (await listNewItems(pb)).find((item) => item.id === entry.id);
		expect(after?.watch).toMatchObject({ kind: 'file', state: 'gone' });
	});

	it('opens no file for another user, with the text of the server', async () => {
		const items = (await listNewItems(pb)).filter((item) => item.connectionId === connection.id);
		const email = `fremd-${randomBytes(8).toString('hex')}@example.com`;
		const password = randomBytes(24).toString('base64url');
		await superuser.collection('users').create({ email, password, passwordConfirm: password });
		const other = new PocketBase(instance.url);
		other.autoCancellation(false);
		await other.collection('users').authWithPassword(email, password);
		const outcome = await viewFolderFile(other, items[0].id);
		expect(outcome).toMatchObject({ kind: 'refused', reason: 'owner' });
		expect(outcome.message).toMatch(/^Nur für das Konto/);
	});
});
