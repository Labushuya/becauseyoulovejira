// Pure rules of the folder channel (ADR-0051): app/pb_hooks/lib/folder-rules.js with berlin-time.js
// passed in, as the service does. Checked: paths of folders under Windows and Linux (drive, share,
// device paths, reserved names, trailing dots), paths below a folder, exclusion patterns and file
// types, the settings and their defaults, the interval, the limits of the test mode, the kinds of
// directory entries (links, junctions, cloud files), the comparison of two scans, versions, moves,
// the status of entries, the entries themselves, the state and the card, the answer of the file
// route and the streaming helper.

import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { loadHookLib } from '../support/hook-lib.mjs';

const rules = loadHookLib('folder-rules.js');
const berlin = loadHookLib('berlin-time.js');

const settings = (folders, interval) => (interval === undefined ? { folders } : { interval, folders });

describe('paths of folders', () => {
	it('takes drive and share paths under Windows in their stored form', () => {
		expect(rules.parseFolderPath('c:\\Daten\\Projekte\\', 'windows')).toEqual({ path: 'C:\\Daten\\Projekte', key: 'c:\\daten\\projekte' });
		expect(rules.parseFolderPath('D:/Fotos/2026', 'windows')).toEqual({ path: 'D:\\Fotos\\2026', key: 'd:\\fotos\\2026' });
		expect(rules.parseFolderPath('\\\\NAS\\Freigabe', 'windows')).toEqual({ path: '\\\\NAS\\Freigabe', key: '\\\\nas\\freigabe' });
		expect(rules.parseFolderPath('\\\\NAS\\Freigabe\\Team A', 'windows').path).toBe('\\\\NAS\\Freigabe\\Team A');
		expect(rules.parseFolderPath('C:\\Users\\CHRIST~1\\Docs', 'windows').path).toBe('C:\\Users\\CHRIST~1\\Docs');
	});

	it('refuses relative, device and drive paths and invalid names under Windows', () => {
		const refused = [
			'',
			' C:\\Daten',
			'Daten\\Projekte',
			'C:Daten',
			'\\Daten',
			'\\\\?\\C:\\Daten',
			'\\\\.\\PhysicalDrive0',
			'\\\\NAS',
			'C:\\Daten\\..\\Windows',
			'C:\\Daten\\.\\x',
			'C:\\Daten\\\\x',
			'C:\\Daten.',
			'C:\\Daten \\x',
			'C:\\NUL',
			'C:\\com1.txt',
			'C:\\Daten\\a:b',
			'C:\\Daten\\a*b',
			'C:\\Daten\\a?b',
			'C:\\Daten\\a<b',
			'C:\\Daten\\a|b',
			'C:\\Daten\\a"b',
			'C:\\Daten\\a\u0001b',
			`C:\\${'x'.repeat(400)}`
		];
		for (const path of refused) {
			expect(rules.parseFolderPath(path, 'windows').code, JSON.stringify(path)).toBe('validation_folder_path');
		}
		expect(rules.parseFolderPath('C:\\', 'windows')).toEqual({ code: 'validation_folder_root' });
		expect(rules.parseFolderPath('C:/', 'windows')).toEqual({ code: 'validation_folder_root' });
	});

	it('takes absolute paths under Linux and refuses the rest', () => {
		expect(rules.parseFolderPath('/home/anna/Projekte/', 'posix')).toEqual({ path: '/home/anna/Projekte', key: '/home/anna/Projekte' });
		expect(rules.parseFolderPath('/srv/a\\b', 'posix').path).toBe('/srv/a\\b');
		for (const path of ['home/anna', '/home/../etc', '/home/./x', '/home//x', '/a\u0000b', 'C:\\Daten']) {
			expect(rules.parseFolderPath(path, 'posix').code, path).toBe('validation_folder_path');
		}
		expect(rules.parseFolderPath('/', 'posix')).toEqual({ code: 'validation_folder_root' });
	});

	it('reads the platform from a join of the server', () => {
		expect(rules.platformOf('a\\b')).toBe('windows');
		expect(rules.platformOf('a/b')).toBe('posix');
	});

	it('joins and splits paths below a folder, and finds the path of a file below its folder', () => {
		expect(rules.joinPath('C:\\Daten', 'a/b.txt', 'windows')).toBe('C:\\Daten\\a\\b.txt');
		expect(rules.joinPath('C:\\', 'Daten', 'windows')).toBe('C:\\Daten');
		expect(rules.joinPath('/srv', 'a/b.txt', 'posix')).toBe('/srv/a/b.txt');
		expect(rules.joinPath('/', 'srv', 'posix')).toBe('/srv');
		expect(rules.relativeOf('C:\\Daten', 'c:\\DATEN\\a\\b.txt', 'windows')).toBe('a/b.txt');
		expect(rules.relativeOf('C:\\Daten', 'C:\\Daten-Alt\\b.txt', 'windows')).toBeNull();
		expect(rules.relativeOf('C:\\Daten', 'C:\\Daten', 'windows')).toBeNull();
		expect(rules.relativeOf('/srv', '/SRV/a', 'posix')).toBeNull();
		expect(rules.relativeOf('/srv', '/srv/a/b', 'posix')).toBe('a/b');
		expect(rules.splitFolderPath('\\\\NAS\\Freigabe\\a\\b', 'windows')).toEqual({ prefix: '\\\\NAS\\Freigabe', names: ['a', 'b'], unc: true });
		expect(rules.splitFolderPath('C:\\a', 'windows')).toEqual({ prefix: 'C:', names: ['a'], unc: false });
		expect(rules.rootOf(rules.splitFolderPath('C:\\a', 'windows'), 'windows')).toBe('C:\\');
		expect(rules.rootOf(rules.splitFolderPath('/a/b', 'posix'), 'posix')).toBe('/');
	});

	it('accepts only valid paths below a folder: no "..", no stream, no alias, no device', () => {
		expect(rules.isRelative('a/b.txt', 'windows')).toBe(true);
		for (const rel of ['', '/a', '../a', 'a/../b', 'a/./b', 'a//b', 'a.txt.', 'a.txt ', 'a.txt::$DATA', 'NUL', 'x/CON.txt', 'a\\b', '__proto__']) {
			expect(rules.isRelative(rel, 'windows'), JSON.stringify(rel)).toBe(false);
		}
		expect(rules.isRelative('a\\b', 'posix')).toBe(true);
		expect(rules.isRelative('a.txt.', 'posix')).toBe(true);
		expect(rules.isRelative('a/../b', 'posix')).toBe(false);
	});

	it('names files and their types', () => {
		expect(rules.nameOf('a/b/Angebot.PDF')).toBe('Angebot.PDF');
		expect(rules.nameOf('C:\\a\\b.txt')).toBe('b.txt');
		expect(rules.extensionOf('Angebot.PDF')).toBe('pdf');
		expect(rules.extensionOf('.gitignore')).toBe('');
		expect(rules.extensionOf('README')).toBe('');
		expect(rules.extensionOf('a.')).toBe('');
		expect(rules.typeText('Angebot.pdf')).toBe('PDF-Dokument (.pdf)');
		expect(rules.typeText('x.qqq')).toBe('Datei (.qqq)');
		expect(rules.typeText('README')).toBe('Datei ohne Endung');
	});
});

describe('exclusions, types and subfolders', () => {
	const matcher = rules.excludeMatcher(rules.DEFAULT_EXCLUDE, 'windows');

	it('has the defaults of the spec', () => {
		expect(rules.DEFAULT_EXCLUDE).toEqual(['*.tmp', '~$*', '.git/**', 'node_modules/**', 'Thumbs.db', 'desktop.ini']);
	});

	it('matches a pattern in every subfolder, without regard to case under Windows', () => {
		for (const rel of ['a.tmp', 'sub/b.TMP', '~$Angebot.docx', 'x/~$y', '.git/config', 'p/.git/objects/a', 'node_modules/m/i.js', 'Thumbs.db', 'x/thumbs.db', 'Desktop.ini']) {
			expect(matcher.file(rel), rel).toBe(true);
		}
		for (const rel of ['a.txt', 'tmp/a.txt', 'git/config', '.gitignore', 'my_node_modules/a']) {
			expect(matcher.file(rel), rel).toBe(false);
		}
		expect(matcher.dir('.git')).toBe(true);
		expect(matcher.dir('p/node_modules')).toBe(true);
		expect(matcher.dir('src')).toBe(false);
		expect(rules.excludeMatcher(['Thumbs.db'], 'posix').file('thumbs.db')).toBe(false);
	});

	it('anchors a pattern with "/" at its start to the watched folder', () => {
		const anchored = rules.excludeMatcher(['/build/**', '/*.log'], 'posix');
		expect(anchored.file('build/a.js')).toBe(true);
		expect(anchored.dir('build')).toBe(true);
		expect(anchored.file('src/build/a.js')).toBe(false);
		expect(anchored.file('x.log')).toBe(true);
		expect(anchored.file('sub/x.log')).toBe(false);
	});

	it('refuses invalid patterns', () => {
		for (const pattern of ['', ' x', '../a', 'a/./b', 'a//b', 'a\\b', '[ab]', '{a,b}', '!a', 'a**', `${'x'.repeat(201)}`]) {
			expect(rules.isPattern(pattern), JSON.stringify(pattern)).toBe(false);
		}
		for (const pattern of ['*.tmp', '/build/**', '**/x', 'a?b', '~$*']) {
			expect(rules.isPattern(pattern), pattern).toBe(true);
		}
	});

	it('watches by subfolders, types and exclusions', () => {
		const config = { subfolders: false, types: ['pdf', 'md'], exclude: [] };
		const none = rules.excludeMatcher([], 'windows');
		expect(rules.isWatched('a.pdf', config, none)).toBe(true);
		expect(rules.isWatched('A.MD', config, none)).toBe(true);
		expect(rules.isWatched('a.txt', config, none)).toBe(false);
		expect(rules.isWatched('sub/a.pdf', config, none)).toBe(false);
		expect(rules.isWatched('sub/a.pdf', { ...config, subfolders: true }, none)).toBe(true);
		expect(rules.isWatched('a.tmp', { subfolders: true, types: [], exclude: [] }, matcher)).toBe(false);
		expect(rules.isWatched('node_modules/a.js', { subfolders: true, types: [], exclude: [] }, matcher)).toBe(false);
	});
});

describe('settings', () => {
	it('accepts folders with their switches, types, exclusions and target', () => {
		expect(rules.settingsViolation(null, 'windows')).toBe('');
		expect(rules.settingsViolation({}, 'windows')).toBe('');
		expect(
			rules.settingsViolation(
				settings([{ path: 'C:\\Daten', subfolders: false, types: ['pdf'], exclude: ['*.bak'], target: 'abcdefghijklmno', report_changes: false }], 5),
				'windows'
			)
		).toBe('');
		expect(rules.settingsViolation(settings([{ path: '/srv/daten' }]), 'posix')).toBe('');
	});

	it('refuses everything else with its code', () => {
		const cases = [
			[{ keywords: ['x'] }, 'validation_folder_settings'],
			['x', 'validation_folder_settings'],
			[{ interval: 0 }, 'validation_folder_interval'],
			[{ interval: 61 }, 'validation_folder_interval'],
			[{ interval: 1.5 }, 'validation_folder_interval'],
			[{ folders: 'x' }, 'validation_folder_settings'],
			[settings(Array.from({ length: 11 }, (_, i) => ({ path: `C:\\D${i}` }))), 'validation_folder_max'],
			[settings(['C:\\Daten']), 'validation_folder_settings'],
			[settings([{ path: 'C:\\Daten', extra: true }]), 'validation_folder_settings'],
			[settings([{ path: 'Daten' }]), 'validation_folder_path'],
			[settings([{ path: 'C:\\Daten\\' }]), 'validation_folder_path'],
			[settings([{ path: 'C:\\' }]), 'validation_folder_root'],
			[settings([{ path: 'C:\\Daten' }, { path: 'C:\\DATEN' }]), 'validation_folder_duplicate'],
			// Only the stored form: a capital drive letter, "\" and no separator at the end.
			[settings([{ path: 'c:\\Daten' }]), 'validation_folder_path'],
			[settings([{ path: 'C:/Daten' }]), 'validation_folder_path'],
			[settings([{ path: 'C:\\Daten', subfolders: 'ja' }]), 'validation_folder_settings'],
			[settings([{ path: 'C:\\Daten', report_changes: 1 }]), 'validation_folder_settings'],
			[settings([{ path: 'C:\\Daten', types: ['.pdf'] }]), 'validation_folder_types'],
			[settings([{ path: 'C:\\Daten', types: ['PDF'] }]), 'validation_folder_types'],
			[settings([{ path: 'C:\\Daten', types: ['pdf', 'pdf'] }]), 'validation_folder_types'],
			[settings([{ path: 'C:\\Daten', exclude: ['../x'] }]), 'validation_folder_exclude'],
			[settings([{ path: 'C:\\Daten', exclude: ['*.tmp', '*.TMP'] }]), 'validation_folder_exclude'],
			[settings([{ path: 'C:\\Daten', target: 'kurz' }]), 'validation_folder_target']
		];
		for (const [value, code] of cases) {
			expect(rules.settingsViolation(value, 'windows'), JSON.stringify(value)).toEqual({ field: 'settings', code, message: rules.MESSAGES[code] });
		}
	});

	it('reads the settings with their defaults: interval 5, subfolders and changes on, the default exclusions', () => {
		expect(rules.settingsOf(null, 'windows')).toEqual({ interval: 5, folders: [] });
		const read = rules.settingsOf(settings([{ path: 'C:\\Daten\\Projekte' }, { path: 'kaputt' }, { path: 'C:\\daten\\projekte' }], 30), 'windows');
		expect(read).toEqual({
			interval: 30,
			folders: [
				{
					path: 'C:\\Daten\\Projekte',
					key: 'c:\\daten\\projekte',
					name: 'Projekte',
					subfolders: true,
					types: [],
					exclude: rules.DEFAULT_EXCLUDE,
					target: '',
					reportChanges: true
				}
			]
		});
		expect(rules.settingsOf(settings([{ path: '/srv', exclude: [], subfolders: false, report_changes: false }]), 'posix').folders[0]).toMatchObject({
			exclude: [],
			subfolders: false,
			reportChanges: false
		});
	});

	it('names new folders and new targets', () => {
		const before = settings([{ path: 'C:\\A', target: 'abcdefghijklmno' }]);
		const after = settings([{ path: 'c:\\a', target: 'pqrstuvwxyzabcd' }, { path: 'C:\\B' }]);
		expect(rules.addedFolders(before, after, 'windows').map((folder) => folder.path)).toEqual(['C:\\B']);
		expect(rules.addedFolders(null, after, 'windows')).toHaveLength(2);
		expect(rules.changedTargets(before, after, 'windows').map((folder) => folder.target)).toEqual(['pqrstuvwxyzabcd']);
		expect(rules.changedTargets(after, after, 'windows')).toEqual([]);
	});

	it('runs a connection once its interval has passed (half a minute early counts)', () => {
		const at = Date.parse('2026-10-02T10:00:05Z');
		expect(rules.isDue('', 5, at)).toBe(true);
		expect(rules.isDue('2026-10-02 09:55:30.000Z', 5, at)).toBe(true);
		expect(rules.isDue('2026-10-02 09:56:00.000Z', 5, at)).toBe(false);
	});

	it('takes smaller limits only in the test mode and never larger ones', () => {
		expect(rules.limitsOf(false, '{"files":3}').files).toBe(2000);
		expect(rules.limitsOf(true, '{"files":3,"hashBytes":1024}')).toMatchObject({ files: 3, hashBytes: 1024, runMs: 30000 });
		expect(rules.limitsOf(true, '{"files":3000,"runMs":-1,"newPerRun":1.5}')).toMatchObject({ files: 2000, runMs: 30000, newPerRun: 100 });
		expect(rules.limitsOf(true, 'kaputt').files).toBe(2000);
		expect(rules.LIMITS).toMatchObject({ folders: 10, files: 2000, hashBytes: 200 * 1024 * 1024, memoryHashBytes: 16 * 1024 * 1024, intervalDefault: 5 });
	});
});

describe('directory entries and changes', () => {
	it('never follows a link: symlinks, junctions and special files are no files', () => {
		expect(rules.entryKind(0, 0x20)).toBe('file');
		expect(rules.entryKind(rules.MODE.dir, 0x10)).toBe('dir');
		expect(rules.entryKind(rules.MODE.symlink, 0)).toBe('link');
		// A junction: Go hides the folder bit, Windows names it a folder and a reparse point.
		expect(rules.entryKind(rules.MODE.irregular, 0x410)).toBe('link');
		// A cloud file of OneDrive: a reparse point, but a file.
		expect(rules.entryKind(rules.MODE.irregular, 0x400420)).toBe('file');
		expect(rules.entryKind(rules.MODE.dir | rules.MODE.irregular, 0x410)).toBe('dir');
		expect(rules.entryKind(rules.MODE.namedPipe, 0)).toBe('special');
		expect(rules.entryKind(rules.MODE.socket, 0)).toBe('special');
		expect(rules.entryKind(rules.MODE.device | rules.MODE.charDevice, 0)).toBe('special');
		expect(rules.isOffline(0x400420)).toBe(true);
		expect(rules.isOffline(0x1000)).toBe(true);
		expect(rules.isOffline(0x20)).toBe(false);
	});

	it('compares a scan with the state by size and time', () => {
		const previous = { 'a.txt': [1, 10, ''], 'b.txt': [2, 20, 'x'], 'c.txt': [3, 30, ''] };
		const scanned = { 'a.txt': { size: 1, mtime: 10 }, 'b.txt': { size: 2, mtime: 21 }, 'd.txt': { size: 4, mtime: 40 } };
		expect(rules.scanDiff(previous, scanned)).toEqual({ unchanged: ['a.txt'], suspect: ['b.txt'], added: ['d.txt'], missing: ['c.txt'] });
	});

	it('names a version by its hash, else by size and time', () => {
		const sha = 'a'.repeat(64);
		expect(rules.versionOf({ sha, size: 1, mtime: 2 })).toBe(`sha256:${sha}`);
		expect(rules.versionOf({ sha: '', size: 1, mtime: 2 })).toBe('size:1:2');
	});

	it('finds moves by the same hash, or by size and time without one; ambiguous pairs stay apart', () => {
		const sha = (n) => String(n).repeat(64).slice(0, 64);
		const removed = [
			{ folder: 'a', rel: 'alt.txt', size: 5, mtime: 50, sha: sha(1) },
			{ folder: 'a', rel: 'basis.txt', size: 6, mtime: 60, sha: '' },
			{ folder: 'a', rel: 'gleich1.txt', size: 7, mtime: 70, sha: sha(3) },
			{ folder: 'a', rel: 'gleich2.txt', size: 7, mtime: 70, sha: sha(3) },
			{ folder: 'a', rel: 'weg.txt', size: 9, mtime: 90, sha: sha(4) }
		];
		const added = [
			{ folder: 'b', rel: 'neu/alt.txt', size: 5, mtime: 99, sha: sha(1) },
			{ folder: 'a', rel: 'umbenannt.txt', size: 6, mtime: 60, sha: sha(2) },
			{ folder: 'a', rel: 'gleich3.txt', size: 7, mtime: 70, sha: sha(3) },
			{ folder: 'a', rel: 'frisch.txt', size: 9, mtime: 91, sha: sha(5) }
		];
		const result = rules.matchMoves(removed, added);
		expect(result.moves.map((move) => [move.from.rel, move.to.rel])).toEqual([
			['alt.txt', 'neu/alt.txt'],
			['basis.txt', 'umbenannt.txt']
		]);
		expect(result.removed.map((file) => file.rel)).toEqual(['gleich1.txt', 'gleich2.txt', 'weg.txt']);
		expect(result.added.map((file) => file.rel)).toEqual(['gleich3.txt', 'frisch.txt']);
	});

	it('gives the status of an entry: current, changed since, gone since, moved', () => {
		expect(rules.fileWatch('v1', { version: 'v1', at: 'x' }, 'now', null)).toEqual({ kind: 'file', state: 'current' });
		expect(rules.fileWatch('v1', { version: 'v2', at: '2026-10-01T10:00:00.000Z' }, 'now', null)).toEqual({ kind: 'file', state: 'changed', since: '2026-10-01T10:00:00.000Z' });
		expect(rules.fileWatch('v1', null, 'jetzt', null)).toEqual({ kind: 'file', state: 'gone', since: 'jetzt' });
		expect(rules.fileWatch('v1', null, 'später', { kind: 'file', state: 'gone', since: 'früher' })).toEqual({ kind: 'file', state: 'gone', since: 'früher' });
		expect(rules.movedWatch('v1', 'v1', 'b/neu.txt', 'Projekte', 'jetzt')).toEqual({ kind: 'file', state: 'moved', since: 'jetzt', to: 'b/neu.txt', folder: 'Projekte', changed: false });
		expect(rules.movedWatch('v1', 'v2', 'b/neu.txt', 'Projekte', 'jetzt').changed).toBe(true);
		expect(rules.sameWatch({ kind: 'file', state: 'current' }, { kind: 'file', state: 'current' })).toBe(true);
		expect(rules.sameWatch(null, { kind: 'file', state: 'current' })).toBe(false);
	});
});

describe('entries', () => {
	const input = {
		folder: { path: 'C:\\Daten\\Projekte', name: 'Projekte' },
		rel: '2026/Angebot *final*.pdf',
		abs: 'C:\\Daten\\Projekte\\2026\\Angebot *final*.pdf',
		size: 1234567,
		mtime: Date.parse('2026-10-02T06:03:00Z'),
		version: `sha256:${'a'.repeat(64)}`,
		action: 'added',
		detectedAt: '2026-10-02T06:10:00.000Z',
		platform: 'windows'
	};

	it('makes a reference with name, path, folder, size, time and type, without copy', () => {
		const draft = rules.fileDraft(input, berlin);
		expect(draft).toMatchObject({
			channel: 'folder',
			kind: 'file',
			title: 'Neue Datei: Angebot *final*.pdf',
			source_url: '',
			source_ref: input.abs,
			source_date: '2026-10-02T06:03:00.000Z',
			watch: { kind: 'file', state: 'current' }
		});
		expect(draft.meta.folder).toEqual({
			root: 'C:\\Daten\\Projekte',
			folder: 'Projekte',
			path: '2026/Angebot *final*.pdf',
			name: 'Angebot *final*.pdf',
			size: 1234567,
			modified: '2026-10-02T06:03:00.000Z',
			type: 'pdf',
			version: input.version,
			file_key: 'c:\\daten\\projekte\\2026\\angebot *final*.pdf',
			action: 'added',
			detected_at: input.detectedAt
		});
		expect(draft.body.split('\n')).toEqual([
			'Neue Datei im beobachteten Ordner „Projekte“.',
			'',
			'- Datei: Angebot \\*final\\*.pdf',
			'- Pfad im Ordner: 2026/Angebot \\*final\\*.pdf',
			'- Ordner: C:\\\\Daten\\\\Projekte',
			'- Größe: 1,2 MB (1.234.567 Byte)',
			'- Geändert: 02.10.2026, 08:03',
			'- Typ: PDF-Dokument \\(.pdf\\)',
			'',
			'_Verweis, keine Kopie: Die Datei bleibt im Ordner. „Ansehen“ öffnet ihre aktuelle Fassung._'
		]);
	});

	it('titles a change and a file of before; a file in the folder itself has no line for its path', () => {
		expect(rules.fileDraft({ ...input, action: 'changed' }, berlin)).toMatchObject({ kind: 'change', title: 'Datei geändert: Angebot *final*.pdf' });
		const existing = rules.fileDraft({ ...input, action: 'existing', rel: 'a.txt', abs: 'C:\\Daten\\Projekte\\a.txt' }, berlin);
		expect(existing).toMatchObject({ kind: 'file', title: 'Datei: a.txt' });
		expect(existing.body).not.toContain('Pfad im Ordner');
		expect(existing.body.split('\n')[0]).toBe('Vorhandene Datei im beobachteten Ordner „Projekte“.');
	});

	it('writes sizes in German', () => {
		expect(rules.sizeText(0)).toBe('0 Byte');
		expect(rules.sizeText(1023)).toBe('1.023 Byte');
		expect(rules.sizeText(1536)).toBe('1,5 KB (1.536 Byte)');
		expect(rules.sizeText(250 * 1024 * 1024)).toBe('250 MB (262.144.000 Byte)');
	});
});

describe('state and card', () => {
	it('reads the state safely and compares it independent of the order of keys', () => {
		expect(rules.stateOf('kaputt')).toEqual({ folders: {} });
		expect(rules.stateOf('{"folders":{"a":{"files":{}},"b":3}}')).toEqual({ folders: { a: { files: {} } } });
		expect(rules.stableJson({ b: 1, a: { d: [1, { f: 2, e: 3 }], c: null } })).toBe('{"a":{"c":null,"d":[1,{"e":3,"f":2}]},"b":1}');
		expect(rules.stableJson({ a: 1, b: 2 })).toBe(rules.stableJson({ b: 2, a: 1 }));
	});

	it('sums a folder up for its card', () => {
		const config = rules.settingsOf(settings([{ path: 'C:\\Daten' }]), 'windows').folders[0];
		expect(rules.folderSummary(config, undefined)).toMatchObject({ path: 'C:\\Daten', files: 0, matching: null, more: false, pending: false, lastChange: null, baseAt: '', error: '' });
		expect(
			rules.folderSummary(config, { files: { 'a.txt': [1, 2, ''] }, matching: 3, more: true, pending: true, last_change: { path: 'a.txt', action: 'added', at: 'x' }, base_at: 'y', error: 'z' })
		).toMatchObject({ files: 1, matching: 3, more: true, pending: true, lastChange: { path: 'a.txt' }, baseAt: 'y', error: 'z' });
	});

	it('says what a run left for later, without red', () => {
		expect(rules.runHint({ folders: 0, errors: 0, pending: 0, deferred: 0, more: 0, limit: 2000 })).toBe('Noch kein Ordner eingetragen.');
		expect(rules.runHint({ folders: 2, errors: 0, pending: 0, deferred: 0, more: 0, limit: 2000 })).toBe('');
		expect(rules.runHint({ folders: 3, errors: 2, pending: 1, deferred: 4, more: 1, limit: 2000 })).toBe(
			'2 Ordner sind nicht erreichbar; der Grund steht in den Details. Nicht alle Ordner geschafft; der Rest folgt beim nächsten Lauf. 1 Ordner hat mehr Dateien, als die App beobachtet (höchstens 2.000 je Ordner); Einzelheiten in den Details.'
		);
		expect(rules.runHint({ folders: 1, errors: 0, pending: 0, deferred: 4, more: 0, limit: 2000 })).toBe('Weitere Dateien folgen beim nächsten Lauf.');
	});
});

describe('the file route', () => {
	it('shows PDF and images inline, text as plain text, everything else only as download', () => {
		expect(rules.contentOf('a.PDF')).toEqual({ type: 'application/pdf', inline: true, policy: '' });
		expect(rules.contentOf('a.png')).toMatchObject({ type: 'image/png', inline: true });
		expect(rules.contentOf('a.jpeg')).toMatchObject({ type: 'image/jpeg', inline: true });
		expect(rules.contentOf('a.md')).toMatchObject({ type: 'text/plain; charset=utf-8', inline: true });
		for (const name of ['a.html', 'a.htm', 'a.svg', 'a.xhtml', 'a.js', 'a.docx', 'a.exe', 'README']) {
			expect(rules.contentOf(name), name).toMatchObject({ type: 'application/octet-stream', inline: false });
		}
		for (const name of ['a.png', 'a.txt', 'a.html']) {
			expect(rules.contentOf(name).policy, name).toMatch(/default-src 'none'.*sandbox$/);
		}
	});

	it('names the file in an ASCII form and in UTF-8, without breaking the header', () => {
		expect(rules.contentDisposition('Übersicht "neu".pdf', true)).toBe(`inline; filename="_bersicht _neu_.pdf"; filename*=UTF-8''%C3%9Cbersicht%20%22neu%22.pdf`);
		expect(rules.contentDisposition('a\r\nSet-Cookie: x.txt', false)).toBe(`attachment; filename="aSet-Cookie: x.txt"; filename*=UTF-8''aSet-Cookie%3A%20x.txt`);
		expect(rules.contentDisposition("it's (1).txt", false)).toBe(`attachment; filename="it's (1).txt"; filename*=UTF-8''it%27s%20%281%29.txt`);
	});

	it('answers refusals with status, German text and reason', () => {
		expect(rules.fileRefusal('missing')).toEqual({ status: 404, body: { status: 404, message: 'Die Datei ist nicht mehr vorhanden.', reason: 'missing' } });
		expect(rules.fileRefusal('path').status).toBe(400);
		expect(rules.fileRefusal('link').status).toBe(403);
		expect(rules.fileRefusal('folder').status).toBe(403);
		expect(rules.fileRefusal('auth').status).toBe(401);
		expect(rules.fileRefusal('constructor')).toMatchObject({ status: 404, body: { reason: 'unknown' } });
	});
});

describe('the streaming helper', () => {
	it('encodes its script for -EncodedCommand of Windows PowerShell', () => {
		expect(rules.encodedCommand(rules.HASH_SCRIPT)).toBe(Buffer.from(rules.HASH_SCRIPT, 'utf16le').toString('base64'));
		expect(rules.encodedCommand('Grüße ✓')).toBe(Buffer.from('Grüße ✓', 'utf16le').toString('base64'));
	});

	it('opens files only for reading, shared for writing and deleting', () => {
		expect(rules.HASH_SCRIPT).toContain("[System.IO.File]::Open($p, 'Open', 'Read', 'ReadWrite, Delete')");
		expect(rules.HASH_SCRIPT).not.toMatch(/Write-|Set-|Remove-|Move-|Rename-|New-Item|Out-File|Copy-/);
	});

	it('sends paths as JSON in ASCII and reads one hash per path', () => {
		expect(rules.asciiJson(['C:\\Übersicht ä.md'])).toBe('["C:\\\\\\u00dcbersicht \\u00e4.md"]');
		const sha = createHash('sha256').update('x').digest('hex');
		expect(rules.parseHashLines(`${sha.toUpperCase()}\r\n-\r\n`, 3)).toEqual([sha, '', '']);
		expect(rules.parseSha256sum(`${sha} *a.txt\n`)).toBe(sha);
		expect(rules.parseSha256sum(`\\${sha} *a\\\\b\n`)).toBe(sha);
		expect(rules.parseSha256sum('sha256sum: a: No such file')).toBe('');
	});
});
