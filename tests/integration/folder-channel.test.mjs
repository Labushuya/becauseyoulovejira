// Folder channel (ADR-0051, plan beobachtete-quellen OD-1) against folders in temp folders of the
// test (never a folder of the user). The disposable instance runs in the test mode of the harness:
// the cron rests (tests/fixtures/pb_hooks/folder-cron.pb.js runs it with a given clock) and the
// limits are smaller (BYL_TEST_FOLDER_LIMITS), so a file of a few kilobytes counts as large. Checked:
// the first run as base without a flood, new files as references with metadata (no copy), changes
// with "Änderungen melden" and without, deduplication per path and hash, touching without change,
// the status of earlier entries (current, changed, gone, moved), renames and moves, exclusions,
// types and subfolders, hashes in the server and by the streaming helper, files above the limit by
// size and time, the limits of files and new entries, an unreachable folder without a flood of
// "gone", target projects of folder and connection, the checks of the settings on the disk, the
// cron, that nothing in the folders changes and that no path reaches the log.

import { createHash, randomBytes } from 'node:crypto';
import {
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	realpathSync,
	renameSync,
	rmSync,
	statSync,
	symlinkSync,
	unlinkSync,
	utimesSync,
	writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import PocketBase from 'pocketbase';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { writtenLogs } from '../support/logs.mjs';
import { startPocketBase } from '../support/pocketbase-harness.mjs';

const WINDOWS = process.platform === 'win32';
// Smaller limits of this instance: above 4 KB the streaming helper hashes, above 64 KB only size
// and time count; at most 20 files per folder and 12 new entries per run.
const LIMITS = { memoryHashBytes: 4096, hashBytes: 65536, files: 20, newPerRun: 12 };

let base;
let instance;
let superuser;
let owner;
let other;
// Times of change of the files: a month ago, a minute apart, so "now" of a run is always later.
let clock = Date.now() - 30 * 24 * 3600 * 1000;

const sha256 = (content) => createHash('sha256').update(content).digest('hex');

/** A project code of capital letters only. */
const code = () => [...randomBytes(5)].map((byte) => 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'[byte % 26]).join('');

/** The neutral hint of the last run of a connection. */
const hintOf = async (conn) => (await superuser.collection('connections').getOne(conn.id)).last_hint;

/** A folder of the test with long names (realpath), so it compares with what the server lists. */
function folder(name) {
	const path = join(base, name);
	mkdirSync(path, { recursive: true });
	return path;
}

/** Writes a file with its own time of change (whole seconds apart, so every change is seen). */
function put(dir, rel, content) {
	const path = join(dir, ...rel.split('/'));
	mkdirSync(join(path, '..'), { recursive: true });
	writeFileSync(path, content);
	clock += 61_000;
	utimesSync(path, new Date(clock), new Date(clock));
	return path;
}

function client() {
	const pb = new PocketBase(instance.url);
	pb.autoCancellation(false);
	return pb;
}

async function user() {
	const email = `ordner-${randomBytes(8).toString('hex')}@example.com`;
	const password = randomBytes(24).toString('base64url');
	const record = await superuser.collection('users').create({ email, password, passwordConfirm: password });
	const pb = client();
	await pb.collection('users').authWithPassword(email, password);
	return { id: record.id, pb };
}

/** A folder connection of `who`, created by the superuser (OD-1: users create it with OD-2). */
function connection(who, folders, data = {}) {
	return superuser.collection('connections').create({
		owner: who.id,
		type: 'folder',
		label: 'Ordner',
		enabled: true,
		secret_env: '',
		settings: { folders },
		...data
	});
}

async function call(who, method, path, body) {
	const response = await fetch(`${instance.url}/api/byl/${path}`, {
		method,
		headers: { Authorization: who.pb.authStore.token, 'Content-Type': 'application/json' },
		body: body === undefined ? undefined : JSON.stringify(body)
	});
	const text = await response.text();
	return { status: response.status, body: text === '' ? null : JSON.parse(text) };
}

const run = async (who, conn) => (await call(who, 'POST', `connections/${conn.id}/run`)).body;
const details = async (who, conn) => (await call(who, 'GET', `connections/${conn.id}/folders`)).body;

function itemsOf(who, conn) {
	return who.pb.collection('inbox_items').getFullList({ sort: 'created,id', filter: who.pb.filter('connection = {:id}', { id: conn.id }) });
}

async function itemByRef(who, ref) {
	const items = await who.pb.collection('inbox_items').getFullList({ sort: 'created,id', filter: who.pb.filter('source_ref = {:ref}', { ref }) });
	return items;
}

/** Names, sizes, times and hashes of every file below `dir`: the folders must stay as they are. */
function snapshot(dir) {
	const out = {};
	for (const entry of readdirSync(dir, { withFileTypes: true, recursive: true })) {
		const path = join(entry.parentPath, entry.name);
		if (entry.isFile()) {
			const stat = statSync(path);
			out[relative(dir, path)] = [stat.size, stat.mtimeMs, sha256(readFileSync(path))];
		}
	}
	return out;
}

beforeAll(async () => {
	base = realpathSync.native(mkdtempSync(join(tmpdir(), 'byl-ordner-test-')));
	instance = await startPocketBase({ env: { BYL_TEST_FOLDER_LIMITS: JSON.stringify(LIMITS) } });
	superuser = client();
	await superuser.collection('_superusers').authWithPassword(instance.email, instance.password);
	owner = await user();
	other = await user();
});

afterAll(async () => {
	await instance?.stop();
	if (base) rmSync(base, { recursive: true, force: true });
});

describe('first run, new files and changes', () => {
	let dir;
	let conn;

	it('takes the files as base on the first run: no entry, excluded files not watched', async () => {
		dir = folder('projekte');
		put(dir, 'plan.md', '# Plan\n');
		put(dir, 'sub/notiz.txt', 'Notiz\n');
		for (const excluded of ['alt.tmp', '~$angebot.docx', '.git/config', 'node_modules/m/index.js', 'Thumbs.db', 'sub/desktop.ini']) {
			put(dir, excluded, 'x');
		}
		conn = await connection(owner, [{ path: dir }]);
		const result = await run(owner, conn);
		expect(result).toMatchObject({ status: 'ok', created: 0, error: '' });
		expect(await itemsOf(owner, conn)).toEqual([]);
		const card = await details(owner, conn);
		expect(card.folders).toHaveLength(1);
		expect(card.folders[0]).toMatchObject({ path: dir, name: 'projekte', files: 2, matching: 2, more: false, error: '', subfolders: true, reportChanges: true });
		expect(card.folders[0].baseAt).not.toBe('');
		expect(card.folders[0].exclude).toEqual(['*.tmp', '~$*', '.git/**', 'node_modules/**', 'Thumbs.db', 'desktop.ini']);
		// A second run without a change writes nothing and brings nothing.
		expect(await run(owner, conn)).toMatchObject({ created: 0, updated: 0 });
	});

	it('makes an entry of a new file with name, path, size, time and type, as a reference without copy', async () => {
		const content = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x00, 0xff, 0xc3, 0x28, 0x0a]);
		const path = put(dir, 'sub/angebot.pdf', content);
		const result = await run(owner, conn);
		expect(result).toMatchObject({ status: 'ok', created: 1 });
		const [item] = await itemByRef(owner, path);
		expect(item).toMatchObject({
			channel: 'folder',
			kind: 'file',
			title: 'Neue Datei: angebot.pdf',
			source_ref: path,
			source_url: '',
			original: '',
			state: 'new',
			watch: { kind: 'file', state: 'current' }
		});
		expect(item.source_meta.folder).toMatchObject({
			root: dir,
			folder: 'projekte',
			path: 'sub/angebot.pdf',
			name: 'angebot.pdf',
			size: content.length,
			type: 'pdf',
			action: 'added',
			// Binary content, hashed in the server: the hash of the bytes.
			version: `sha256:${sha256(content)}`
		});
		expect(item.body).toContain('- Pfad im Ordner: sub/angebot.pdf');
		expect(item.body).toContain('- Typ: PDF-Dokument \\(.pdf\\)');
		expect(item.body).toContain('Verweis, keine Kopie');
		const card = await details(owner, conn);
		expect(card.folders[0]).toMatchObject({ files: 3, lastChange: { path: 'sub/angebot.pdf', action: 'added' } });
	});

	it('makes an entry "Datei geändert" of a change; the earlier entry shows changed since; a touch brings nothing', async () => {
		const path = join(dir, 'sub', 'angebot.pdf');
		put(dir, 'sub/angebot.pdf', 'Fassung 2');
		expect(await run(owner, conn)).toMatchObject({ created: 1, updated: 1 });
		const [first, second] = await itemByRef(owner, path);
		expect(second).toMatchObject({ kind: 'change', title: 'Datei geändert: angebot.pdf', watch: { kind: 'file', state: 'current' } });
		expect(second.source_meta.folder).toMatchObject({ action: 'changed', version: `sha256:${sha256('Fassung 2')}` });
		expect(first.watch).toMatchObject({ kind: 'file', state: 'changed' });
		expect(first.watch.since).toBe(new Date(statSync(path).mtimeMs).toISOString());

		// Only the time changes: same content, no entry, no status change.
		clock += 61_000;
		utimesSync(path, new Date(clock), new Date(clock));
		expect(await run(owner, conn)).toMatchObject({ created: 0, duplicates: 0, updated: 0 });
		expect(await itemByRef(owner, path)).toHaveLength(2);
	});

	it('takes a version that comes back as the earlier entry (one entry per path and hash)', async () => {
		const path = join(dir, 'sub', 'angebot.pdf');
		put(dir, 'sub/angebot.pdf', Buffer.from([0x25, 0x50, 0x44, 0x46, 0x00, 0xff, 0xc3, 0x28, 0x0a]));
		expect(await run(owner, conn)).toMatchObject({ created: 0, duplicates: 1, updated: 2 });
		const [first, second] = await itemByRef(owner, path);
		expect(first.watch).toEqual({ kind: 'file', state: 'current' });
		expect(second.watch).toMatchObject({ kind: 'file', state: 'changed' });
	});

	it('shows "nicht mehr vorhanden" at the entries of a removed file and makes no entry', async () => {
		const path = join(dir, 'sub', 'angebot.pdf');
		unlinkSync(path);
		expect(await run(owner, conn)).toMatchObject({ created: 0, updated: 2 });
		for (const item of await itemByRef(owner, path)) {
			expect(item.watch).toMatchObject({ kind: 'file', state: 'gone' });
			expect(item.watch.since).not.toBe('');
		}
		expect((await details(owner, conn)).folders[0]).toMatchObject({ files: 2, lastChange: { path: 'sub/angebot.pdf', action: 'removed' } });
	});
});

describe('moves, renames and the status of the source', () => {
	let dir;
	let conn;

	it('lets the entries follow a renamed or moved file: status "moved", no new entry', async () => {
		dir = folder('umzug');
		put(dir, 'start.txt', 'bleibt');
		conn = await connection(owner, [{ path: dir }]);
		await run(owner, conn);
		const from = put(dir, 'bericht.txt', 'Bericht 2026');
		expect(await run(owner, conn)).toMatchObject({ created: 1 });
		const to = join(dir, 'archiv', 'bericht-final.txt');
		mkdirSync(join(dir, 'archiv'));
		renameSync(from, to);
		expect(await run(owner, conn)).toMatchObject({ created: 0, updated: 1 });
		expect(await itemByRef(owner, from)).toEqual([]);
		const [item] = await itemByRef(owner, to);
		expect(item.title).toBe('Neue Datei: bericht.txt');
		expect(item.watch).toMatchObject({ kind: 'file', state: 'moved', to: 'archiv/bericht-final.txt', folder: 'umzug', changed: false });
		// A later change of the moved file reaches the entry at its new place.
		put(dir, 'archiv/bericht-final.txt', 'Bericht 2026, ergänzt');
		await run(owner, conn);
		const [moved] = await itemByRef(owner, to);
		expect(moved.watch).toMatchObject({ kind: 'file', state: 'changed' });
	});

	it('takes a renamed file of the base (no hash yet) by size and time, without a new entry', async () => {
		const before = (await itemsOf(owner, conn)).length;
		renameSync(join(dir, 'start.txt'), join(dir, 'umbenannt.txt'));
		expect(await run(owner, conn)).toMatchObject({ created: 0 });
		expect(await itemsOf(owner, conn)).toHaveLength(before);
		expect((await details(owner, conn)).folders[0].lastChange).toMatchObject({ path: 'umbenannt.txt', action: 'moved', from: 'start.txt' });
	});

	it('takes a rename of the case only, also of a folder, as a move', async () => {
		const path = put(dir, 'gross-klein/Notiz.txt', 'Groß und klein');
		expect(await run(owner, conn)).toMatchObject({ created: 1 });
		renameSync(join(dir, 'gross-klein'), join(dir, 'Gross-Klein'));
		expect(await run(owner, conn)).toMatchObject({ created: 0, updated: 1 });
		const moved = join(dir, 'Gross-Klein', 'Notiz.txt');
		const [item] = await itemByRef(owner, moved);
		expect(item.watch).toMatchObject({ state: 'moved', to: 'Gross-Klein/Notiz.txt' });
		expect(await itemByRef(owner, path)).toEqual([]);
	});

	it('keeps two equal files apart: an ambiguous pair is removed and new', async () => {
		put(dir, 'kopie-a.txt', 'gleich');
		put(dir, 'kopie-b.txt', 'gleich');
		await run(owner, conn);
		unlinkSync(join(dir, 'kopie-a.txt'));
		unlinkSync(join(dir, 'kopie-b.txt'));
		put(dir, 'kopie-c.txt', 'gleich');
		put(dir, 'kopie-d.txt', 'gleich');
		const result = await run(owner, conn);
		// Two removed and two new files of the same content: no move, so the new ones are entries of
		// their own (the duplicate key holds the path) and the old ones are gone.
		expect(result.created).toBe(2);
		for (const name of ['kopie-a.txt', 'kopie-b.txt']) {
			for (const item of await itemByRef(owner, join(dir, name))) {
				expect(item.watch.state, name).toBe('gone');
			}
		}
	});

	it('changes no ticket when the status of its source changes', async () => {
		const path = put(dir, 'vertrag.txt', 'Vertrag 1');
		await run(owner, conn);
		const [item] = await itemByRef(owner, path);
		const ticket = await owner.pb.collection('tickets').create({ owner: owner.id, title: 'Vertrag prüfen', status: 'open', priority: 'medium', source_item: item.id });
		const before = await owner.pb.collection('tickets').getOne(ticket.id);
		const history = await owner.pb.collection('ticket_history').getFullList({ filter: owner.pb.filter('ticket = {:id}', { id: ticket.id }) });
		put(dir, 'vertrag.txt', 'Vertrag 2');
		await run(owner, conn);
		unlinkSync(path);
		await run(owner, conn);
		const [after] = await itemByRef(owner, path);
		expect(after.watch.state).toBe('gone');
		expect(after.state).toBe('converted');
		expect(await owner.pb.collection('tickets').getOne(ticket.id)).toEqual(before);
		expect(await owner.pb.collection('ticket_history').getFullList({ filter: owner.pb.filter('ticket = {:id}', { id: ticket.id }) })).toEqual(history);
	});
});

describe('filters, switches and hashes', () => {
	it('watches only the chosen types, no subfolders when switched off, and own exclusions', async () => {
		const dir = folder('filter');
		put(dir, 'a.md', 'a');
		const conn = await connection(owner, [{ path: dir, types: ['md', 'txt'], subfolders: false, exclude: ['entwurf-*'] }]);
		await run(owner, conn);
		put(dir, 'b.md', 'b');
		put(dir, 'c.pdf', 'c');
		put(dir, 'entwurf-d.md', 'd');
		put(dir, 'unter/e.md', 'e');
		const result = await run(owner, conn);
		expect(result.created).toBe(1);
		expect((await itemsOf(owner, conn)).map((item) => item.title)).toEqual(['Neue Datei: b.md']);
		expect((await details(owner, conn)).folders[0]).toMatchObject({ files: 2, subfolders: false, types: ['md', 'txt'], exclude: ['entwurf-*'] });
	});

	it('reports no change with "Änderungen melden" off, but the status of earlier entries follows', async () => {
		const dir = folder('ohne-meldung');
		const conn = await connection(owner, [{ path: dir, report_changes: false }]);
		await run(owner, conn);
		const path = put(dir, 'liste.txt', 'eins');
		expect(await run(owner, conn)).toMatchObject({ created: 1 });
		put(dir, 'liste.txt', 'zwei');
		expect(await run(owner, conn)).toMatchObject({ created: 0, updated: 1 });
		const items = await itemByRef(owner, path);
		expect(items).toHaveLength(1);
		expect(items[0].watch).toMatchObject({ state: 'changed' });
	});

	it('hashes a large file with the streaming helper and compares a file above the limit by size and time', async () => {
		const dir = folder('gross');
		const conn = await connection(owner, [{ path: dir }]);
		await run(owner, conn);
		const medium = randomBytes(10 * 1024);
		const mediumPath = put(dir, 'mittel.bin', medium);
		const large = randomBytes(100 * 1024);
		const largePath = put(dir, 'gross.bin', large);
		expect(await run(owner, conn)).toMatchObject({ created: 2 });
		const [mediumItem] = await itemByRef(owner, mediumPath);
		expect(mediumItem.source_meta.folder.version).toBe(`sha256:${sha256(medium)}`);
		const [largeItem] = await itemByRef(owner, largePath);
		expect(largeItem.source_meta.folder.version).toBe(`size:${large.length}:${statSync(largePath).mtimeMs}`);
		expect(largeItem.body).toContain('- Größe: 100 KB (102.400 Byte)');
	});
});

describe('limits', () => {
	it('watches at most the limit of files per folder and says so', async () => {
		const dir = folder('viele');
		for (let index = 0; index < 25; index += 1) put(dir, `datei-${String(index).padStart(2, '0')}.txt`, `Nr. ${index}`);
		const conn = await connection(owner, [{ path: dir }]);
		await run(owner, conn);
		expect(await hintOf(conn)).toBe('1 Ordner hat mehr Dateien, als die App beobachtet (höchstens 20 je Ordner); Einzelheiten in den Details.');
		expect((await details(owner, conn)).folders[0]).toMatchObject({ files: 20, matching: 25, more: true });
		// A new file finds no room: no entry while the folder is full.
		put(dir, 'neu.txt', 'neu');
		expect(await run(owner, conn)).toMatchObject({ created: 0 });
	});

	it('takes at most the new entries of one run and the rest with the next run', async () => {
		const dir = folder('schub');
		const conn = await connection(owner, [{ path: dir }]);
		await run(owner, conn);
		for (let index = 0; index < 15; index += 1) put(dir, `neu-${String(index).padStart(2, '0')}.txt`, `neu ${index}`);
		expect(await run(owner, conn)).toMatchObject({ created: 12 });
		expect(await hintOf(conn)).toBe('Weitere Dateien folgen beim nächsten Lauf.');
		expect(await run(owner, conn)).toMatchObject({ created: 3 });
		expect(await hintOf(conn)).toBe('');
	});
});

describe('unreachable folders, target projects and settings', () => {
	it('keeps the state of a folder it cannot reach: an error in its details, no "gone"', async () => {
		const dir = folder('wandert');
		const conn = await connection(owner, [{ path: dir }]);
		await run(owner, conn);
		const path = put(dir, 'bleibt.txt', 'x');
		await run(owner, conn);
		const away = join(base, 'wandert-weg');
		renameSync(dir, away);
		expect(await run(owner, conn)).toMatchObject({ status: 'ok', error: '', updated: 0 });
		expect(await hintOf(conn)).toBe('1 Ordner ist nicht erreichbar; der Grund steht in den Details.');
		expect((await details(owner, conn)).folders[0].error).toMatch(/^Ordner nicht erreichbar/);
		expect((await itemByRef(owner, path))[0].watch).toEqual({ kind: 'file', state: 'current' });
		renameSync(away, dir);
		expect(await run(owner, conn)).toMatchObject({ created: 0, updated: 0 });
		expect(await hintOf(conn)).toBe('');
		expect((await details(owner, conn)).folders[0]).toMatchObject({ error: '', files: 1 });
	});

	it('gives entries the target project of their folder, else the one of the connection', async () => {
		const own = await owner.pb.collection('projects').create({ owner: owner.id, name: 'Ordnerziel', code: code() });
		const fallback = await owner.pb.collection('projects').create({ owner: owner.id, name: 'Verbindungsziel', code: code() });
		const first = folder('ziel-eigen');
		const second = folder('ziel-verbindung');
		const conn = await connection(owner, [{ path: first, target: own.id }, { path: second }], { target_project: fallback.id });
		await run(owner, conn);
		const a = put(first, 'a.txt', 'a');
		const b = put(second, 'b.txt', 'b');
		await run(owner, conn);
		expect((await itemByRef(owner, a))[0].target_project).toBe(own.id);
		expect((await itemByRef(owner, b))[0].target_project).toBe(fallback.id);
	});

	it('checks a new folder on the disk: exists, is a folder, no link on the way, not the app', async () => {
		const dir = folder('pruefung');
		const conn = await connection(owner, [{ path: dir }]);
		const file = put(base, 'keine-mappe.txt', 'x');
		const target = folder('ziel-der-verknuepfung');
		const link = join(base, 'verknuepfung');
		symlinkSync(target, link, 'junction');
		const update = (folders) => owner.pb.collection('connections').update(conn.id, { settings: { folders } });
		const codeOf = async (folders) => {
			try {
				await update(folders);
				return 'ok';
			} catch (error) {
				return error.response.data.settings.code;
			}
		};
		expect(await codeOf([{ path: dir }, { path: join(base, 'gibt-es-nicht') }])).toBe('validation_folder_missing');
		expect(await codeOf([{ path: dir }, { path: file }])).toBe('validation_folder_missing');
		expect(await codeOf([{ path: dir }, { path: link }])).toBe('validation_folder_link');
		expect(await codeOf([{ path: dir }, { path: join(link, 'unter') }])).toBe('validation_folder_link');
		expect(await codeOf([{ path: dir }, { path: realpathSync.native(instance.dataDir) }])).toBe('validation_folder_app');
		expect(await codeOf([{ path: dir }, { path: 'relativ/pfad' }])).toBe('validation_folder_path');
		expect(await codeOf([{ path: dir }, { path: `${dir}..` }])).not.toBe('ok');
		expect(await codeOf([{ path: dir }, { path: dir }])).toBe('validation_folder_duplicate');
		expect(await codeOf([{ path: dir, exclude: ['../raus'] }])).toBe('validation_folder_exclude');
		expect(await codeOf([{ path: dir, types: ['.pdf'] }])).toBe('validation_folder_types');
		expect(await codeOf([{ path: dir, target: 'zzzzzzzzzzzzzzz' }])).toBe('validation_target_project_missing');
		expect(await codeOf([{ path: dir }, { path: target }])).toBe('ok');
		// A folder that stays is not checked again, also when it is gone meanwhile.
		rmSync(target, { recursive: true });
		expect(await codeOf([{ path: dir }, { path: target, subfolders: false }])).toBe('ok');
	});

	it.skipIf(!WINDOWS)('refuses a short name of Windows, which would name a folder twice', async () => {
		const short = tmpdir();
		const long = realpathSync.native(short);
		if (short.toLowerCase() === long.toLowerCase()) return;
		const conn = await connection(owner, [{ path: folder('kurzname') }]);
		const alias = join(short, relative(long, folder('kurzname-ziel')));
		await expect(owner.pb.collection('connections').update(conn.id, { settings: { folders: [{ path: alias }] } })).rejects.toMatchObject({
			response: { data: { settings: { code: 'validation_folder_alias' } } }
		});
	});

	it('refuses access data and the server fields of a folder connection', async () => {
		const conn = await connection(owner, [{ path: folder('ohne-zugang') }]);
		await expect(owner.pb.collection('connections').update(conn.id, { secret_env: 'BYL_ORDNER' })).rejects.toMatchObject({
			response: { data: { secret_env: { code: 'validation_connection_secret_none' } } }
		});
		// The state is hidden: PocketBase drops it from a request of a client (and the hook would
		// refuse it, connection-rules SERVER_FIELDS).
		await run(owner, conn);
		const stored = (await superuser.collection('connections').getOne(conn.id)).watch;
		await owner.pb.collection('connections').update(conn.id, { watch: { folders: {} } });
		expect((await superuser.collection('connections').getOne(conn.id)).watch).toEqual(stored);
		await expect(
			owner.pb.collection('connections').create({ owner: owner.id, type: 'folder', label: 'Neu', enabled: true, secret_env: '', settings: {} })
		).rejects.toMatchObject({ response: { data: { type: { code: 'validation_connection_type' } } } });
	});

	it('answers 404 for the details of connections of others and of other kinds', async () => {
		const conn = await connection(owner, [{ path: folder('fremd') }]);
		expect((await call(other, 'GET', `connections/${conn.id}/folders`)).status).toBe(404);
		const calendar = await superuser.collection('connections').create({ owner: owner.id, type: 'calendar', label: 'Kalender', enabled: false, secret_env: 'BYL_KALENDER' });
		expect((await call(owner, 'GET', `connections/${calendar.id}/folders`)).status).toBe(404);
	});
});

describe('files of before', () => {
	it('lists the files of the base and takes chosen ones into the inbox as references', async () => {
		const dir = folder('vorhanden');
		put(dir, 'a.txt', 'a');
		put(dir, 'unter/b.txt', 'b');
		const conn = await connection(owner, [{ path: dir }]);
		await run(owner, conn);
		const key = (await details(owner, conn)).folders[0].id;
		expect(key).toMatch(/^[0-9a-f]{16}$/);
		const list = await call(owner, 'GET', `connections/${conn.id}/folders/existing?folder=${encodeURIComponent(key)}`);
		expect(list.status).toBe(200);
		expect(list.body.files.map((file) => [file.path, file.state])).toEqual([
			['a.txt', ''],
			['unter/b.txt', '']
		]);
		const taken = await call(owner, 'POST', `connections/${conn.id}/folders/adopt`, { folder: key, paths: ['unter/b.txt', 'gibt-es-nicht.txt', '../a.txt'] });
		expect(taken.body).toMatchObject({ status: 'ok', created: 1, skipped: 2 });
		const [item] = await itemByRef(owner, join(dir, 'unter', 'b.txt'));
		expect(item).toMatchObject({ title: 'Datei: b.txt', kind: 'file', watch: { kind: 'file', state: 'current' } });
		expect(item.source_meta.folder).toMatchObject({ action: 'existing', version: `sha256:${sha256('b')}` });
		const again = await call(owner, 'GET', `connections/${conn.id}/folders/existing?folder=${encodeURIComponent(key)}`);
		expect(again.body.files.map((file) => file.state)).toEqual(['', 'new']);
		expect((await call(owner, 'POST', `connections/${conn.id}/folders/adopt`, { folder: key, paths: [] })).status).toBe(400);
		expect((await call(owner, 'POST', `connections/${conn.id}/folders/adopt`, { folder: 'unbekannt', paths: ['a.txt'] })).status).toBe(404);
		expect((await call(other, 'POST', `connections/${conn.id}/folders/adopt`, { folder: key, paths: ['a.txt'] })).status).toBe(404);
	});
});

describe('cron, read only and logs', () => {
	it('registers the job and runs a connection once its interval has passed', async () => {
		const crons = await superuser.crons.getFullList();
		expect(crons.map((job) => job.id)).toContain('byl-folders');
		const dir = folder('takt');
		const conn = await connection(owner, [{ path: dir }], { settings: { interval: 10, folders: [{ path: dir }] } });
		const cron = (now) => superuser.send('/api/byl-test/folders/cron', { method: 'POST', body: { now } });
		const now = Date.now();
		await cron(now);
		const first = await superuser.collection('connections').getOne(conn.id);
		expect(first.last_run_at).not.toBe('');
		await cron(now + 5 * 60_000);
		expect((await superuser.collection('connections').getOne(conn.id)).last_run_at).toBe(first.last_run_at);
		await cron(now + 10 * 60_000);
		expect((await superuser.collection('connections').getOne(conn.id)).last_run_at).not.toBe(first.last_run_at);
	});

	it('changes nothing in the folders: every file is as it was after all runs', async () => {
		const dir = folder('nur-lesen');
		put(dir, 'a.txt', 'a');
		put(dir, 'b/c.bin', randomBytes(20 * 1024));
		const conn = await connection(owner, [{ path: dir }]);
		const before = snapshot(dir);
		await run(owner, conn);
		put(dir, 'd.txt', 'd');
		const withNew = snapshot(dir);
		await run(owner, conn);
		expect(snapshot(dir)).toEqual(withNew);
		expect(Object.keys(before).sort()).toEqual(['a.txt', join('b', 'c.bin')].sort());
	});

	it('writes no path of a folder into the log', async () => {
		const logs = await writtenLogs(superuser);
		const text = JSON.stringify(logs);
		expect(text).not.toContain(base);
		expect(text).not.toContain(base.replace(/\\/g, '\\\\'));
	});
});
