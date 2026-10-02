// Folder channel in the web app (ADR-0051 §2, §3, §6 and §7): the platform of the paths, the form
// of a folder, the settings as the server reads and stores them, the details of the card, the
// files of before, the answer of "Ansehen" and the details of an entry. The same rules as the hook
// are compared in tests/unit/web-folders.test.mjs.

import { describe, expect, it } from 'vitest';
import {
	EMPTY_FOLDER_SETTINGS,
	FILE_REFUSAL_MESSAGES,
	FOLDER_PATH_REQUIRED,
	adoptResultOf,
	adoptSummary,
	draftExclude,
	draftTypes,
	emptyFolderDraft,
	existingFilesOf,
	existingStateText,
	fileRefusalText,
	fileSizeText,
	fileViewOf,
	filesText,
	folderDetailsOf,
	folderDraftErrors,
	folderDraftOf,
	folderFromDraft,
	folderIntervalText,
	folderMetaText,
	folderPlatformOf,
	folderSettingsOf,
	folderSettingsValue,
	lastChangeText,
	typesText,
	withFolder,
	withoutFolder,
	type FolderConfig,
	type FolderSummary
} from './folders';

const PROJEKTE: FolderConfig = {
	path: 'C:\\Daten\\Projekte',
	subfolders: true,
	types: [],
	exclude: ['*.tmp'],
	target: null,
	reportChanges: true
};

function summary(overrides: Partial<FolderSummary> = {}): FolderSummary {
	return {
		id: 'a1b2c3d4e5f60718',
		path: PROJEKTE.path,
		key: 'c:\\daten\\projekte',
		name: 'Projekte',
		subfolders: true,
		types: [],
		exclude: [],
		target: null,
		reportChanges: true,
		files: 12,
		matching: 12,
		more: false,
		incomplete: false,
		pending: false,
		lastChange: null,
		baseAt: '2026-10-02T08:00:00.000Z',
		error: '',
		...overrides
	};
}

describe('paths and the form of a folder', () => {
	it('follows the system of the server: Windows paths only on Windows', () => {
		expect(folderPlatformOf('windows')).toBe('windows');
		expect(folderPlatformOf('linux')).toBe('posix');
		expect(folderPlatformOf('container')).toBe('posix');
	});

	it('starts a new folder with subfolders, every type, the default exclusions and changes', () => {
		const draft = emptyFolderDraft();
		expect(draft).toMatchObject({
			path: '',
			subfolders: true,
			typesText: '',
			target: null,
			reportChanges: true
		});
		expect(draft.excludeText.split('\n')).toEqual([
			'*.tmp',
			'~$*',
			'.git/**',
			'node_modules/**',
			'Thumbs.db',
			'desktop.ini'
		]);
		expect(folderDraftErrors(draft, 'windows', EMPTY_FOLDER_SETTINGS, null)).toEqual({
			path: FOLDER_PATH_REQUIRED
		});
	});

	it('reads types and exclusions of the form', () => {
		expect(draftTypes(' .PDF, docx;*.xlsx  pdf\tmd ')).toEqual(['pdf', 'docx', 'xlsx', 'md']);
		expect(draftTypes('')).toEqual([]);
		expect(draftExclude('*.tmp\r\n\n  Archiv\\alt\\**  \n')).toEqual(['*.tmp', 'Archiv/alt/**']);
	});

	it('turns a folder into the form and back, the path in its stored form', () => {
		const draft = folderDraftOf({ ...PROJEKTE, types: ['pdf', 'docx'], target: 'haus00000000001' });
		expect(draft).toMatchObject({
			typesText: 'pdf, docx',
			excludeText: '*.tmp',
			target: 'haus00000000001'
		});
		expect(folderFromDraft({ ...draft, path: 'c:/Daten/Projekte/' }, 'windows').path).toBe(
			'C:\\Daten\\Projekte'
		);
		expect(folderFromDraft({ ...draft, path: '/srv/daten/' }, 'posix').path).toBe('/srv/daten');
	});

	it('refuses a Windows path on a Linux server and the other way round', () => {
		const errors = (path: string, platform: 'windows' | 'posix') =>
			folderDraftErrors({ ...emptyFolderDraft(), path }, platform, EMPTY_FOLDER_SETTINGS, null);
		expect(errors('C:\\Daten', 'posix').path).toContain('vollständigen Pfad');
		expect(errors('/home/anna', 'windows').path).toContain('vollständigen Pfad');
		expect(errors('/home/anna', 'posix')).toEqual({});
	});
});

describe('settings of a connection', () => {
	it('reads stored settings with defaults and leaves broken folders out', () => {
		expect(folderSettingsOf(null)).toEqual(EMPTY_FOLDER_SETTINGS);
		const settings = folderSettingsOf({
			interval: 90,
			folders: [
				{ path: PROJEKTE.path, types: ['pdf'], exclude: [], report_changes: false, target: 'x' },
				{ path: 'c:\\daten\\projekte' },
				{ path: '' },
				'kaputt',
				{ path: '/srv/daten', subfolders: false, target: 'haus00000000001' }
			]
		});
		expect(settings.interval).toBe(5);
		expect(settings.folders).toEqual([
			{ ...PROJEKTE, types: ['pdf'], exclude: [], reportChanges: false },
			{
				path: '/srv/daten',
				subfolders: false,
				types: [],
				exclude: expect.arrayContaining(['*.tmp']),
				target: 'haus00000000001',
				reportChanges: true
			}
		]);
	});

	it('stores the folders with their switches and the target as an ID or empty', () => {
		expect(folderSettingsValue({ interval: 10, folders: [PROJEKTE] })).toEqual({
			interval: 10,
			folders: [
				{
					path: PROJEKTE.path,
					subfolders: true,
					types: [],
					exclude: ['*.tmp'],
					target: '',
					report_changes: true
				}
			]
		});
	});

	it('adds, replaces and removes a folder by its key', () => {
		const one = withFolder(EMPTY_FOLDER_SETTINGS, PROJEKTE);
		expect(one.folders).toHaveLength(1);
		const changed = withFolder(one, { ...PROJEKTE, path: 'c:\\daten\\projekte', types: ['pdf'] });
		expect(changed.folders).toHaveLength(1);
		expect(changed.folders[0]?.types).toEqual(['pdf']);
		expect(withoutFolder(changed, 'c:\\daten\\projekte').folders).toEqual([]);
		expect(EMPTY_FOLDER_SETTINGS.folders).toEqual([]);
	});
});

describe('details of the card', () => {
	it('reads the answer of the server and leaves broken parts out', () => {
		const details = folderDetailsOf({
			interval: 15,
			platform: 'posix',
			limit: 2000,
			folders: [
				{
					id: 'a1b2c3d4e5f60718',
					path: '/srv/daten',
					files: 3,
					matching: 3,
					lastChange: {
						path: 'a.pdf',
						action: 'moved',
						at: '2026-10-02T08:00:00.000Z',
						from: 'alt/a.pdf'
					},
					target: ''
				},
				{ path: '/ohne/id' },
				null
			]
		});
		expect(details).toMatchObject({ interval: 15, platform: 'posix', limit: 2000 });
		expect(details.folders).toHaveLength(1);
		expect(details.folders[0]).toMatchObject({
			name: 'daten',
			key: '/srv/daten',
			target: null,
			lastChange: { action: 'moved', from: 'alt/a.pdf' }
		});
		expect(folderDetailsOf('kaputt')).toEqual({
			interval: 5,
			platform: 'windows',
			limit: 2000,
			folders: []
		});
	});

	it('says the files, the limit, the last change, the interval and the types', () => {
		expect(filesText(summary({ baseAt: '' }), 2000)).toBe('noch nicht erfasst');
		expect(filesText(summary({ files: 1 }), 2000)).toBe('1 Datei');
		expect(filesText(summary({ files: 2000, matching: 3120, more: true }), 2000)).toBe(
			'2.000 von 3.120 Dateien (höchstens 2.000 je Ordner)'
		);
		expect(filesText(summary({ incomplete: true }), 2000)).toBe(
			'12 Dateien, Ordner nicht vollständig gelesen'
		);
		expect(lastChangeText(null)).toBe('noch keine');
		expect(
			lastChangeText({
				path: '2026/Angebot.pdf',
				action: 'added',
				at: '2026-10-02T06:03:00.000Z',
				from: null
			})
		).toBe('2026/Angebot.pdf neu, 02.10.2026 08:03');
		expect(lastChangeText({ path: 'neu/a.pdf', action: 'moved', at: '', from: 'alt/a.pdf' })).toBe(
			'neu/a.pdf verschoben (vorher alt/a.pdf)'
		);
		expect(lastChangeText({ path: 'a.pdf', action: 'removed', at: '', from: null })).toBe(
			'a.pdf gelöscht'
		);
		expect(folderIntervalText(1)).toBe('jede Minute');
		expect(folderIntervalText(5)).toBe('alle 5 Minuten');
		expect(folderIntervalText(60)).toBe('jede Stunde');
		expect(typesText([])).toBe('alle');
		expect(typesText(['pdf', 'docx'])).toBe('pdf, docx');
	});

	it('says sizes of files', () => {
		expect(fileSizeText(0)).toBe('0 Byte');
		expect(fileSizeText(1023)).toBe('1023 Byte');
		expect(fileSizeText(12 * 1024)).toBe('12 KB');
		expect(fileSizeText(1.4 * 1024 * 1024)).toBe('1,4 MB');
		expect(fileSizeText(2.1 * 1024 * 1024 * 1024)).toBe('2,1 GB');
	});
});

describe('files of before', () => {
	it('reads the list and the answer of taking files over', () => {
		const list = existingFilesOf({
			folder: 'C:\\Daten',
			name: 'Daten',
			base: true,
			files: [
				{ path: 'a/b.pdf', size: 10, modified: '2026-10-01T08:00:00.000Z', state: 'new' },
				{ path: 'c.txt', size: -1, state: 'gelöscht' },
				{ name: 'ohne Pfad' }
			]
		});
		expect(list.base).toBe(true);
		expect(list.files).toEqual([
			{
				path: 'a/b.pdf',
				name: 'b.pdf',
				size: 10,
				modified: '2026-10-01T08:00:00.000Z',
				state: 'new'
			},
			{ path: 'c.txt', name: 'c.txt', size: 0, modified: '', state: '' }
		]);
		expect(existingFilesOf(null)).toEqual({ folder: '', name: '', base: false, files: [] });
		expect(adoptResultOf({ created: 2, duplicates: 1, skipped: 'x' })).toEqual({
			created: 2,
			duplicates: 1,
			skipped: 0,
			failed: 0
		});
	});

	it('names the state of a file and the sum of taking files over', () => {
		expect(existingStateText('')).toBe('');
		expect(existingStateText('new')).toBe('schon im Eingang');
		expect(existingStateText('converted')).toBe('schon an einem Ticket');
		expect(existingStateText('discarded')).toBe('schon verworfen');
		expect(adoptSummary({ created: 1, duplicates: 0, skipped: 0, failed: 0 })).toBe(
			'1 Datei in den Eingang übernommen.'
		);
		expect(adoptSummary({ created: 3, duplicates: 2, skipped: 1, failed: 1 })).toBe(
			'3 Dateien in den Eingang übernommen, 2 waren schon da, 1 nicht mehr vorhanden, 1 nicht übernommen.'
		);
	});
});

describe('"Ansehen" and the details of an entry', () => {
	it('takes only an address of the API from the server', () => {
		expect(
			fileViewOf({
				name: 'a.pdf',
				path: 'x/a.pdf',
				folder: 'Daten',
				size: 3,
				modified: '2026-10-02T08:00:00.000Z',
				inline: true,
				url: '/api/byl/folders/items/abc/file?token=t'
			})
		).toMatchObject({ inline: true, url: '/api/byl/folders/items/abc/file?token=t' });
		expect(fileViewOf({ url: 'https://example.com/a.pdf' })).toBeNull();
		expect(fileViewOf({ url: 'javascript:alert(1)' })).toBeNull();
		expect(fileViewOf(null)).toBeNull();
	});

	it('words a refusal by its reason, else with the text of the server', () => {
		expect(fileRefusalText('missing', 'x')).toBe(FILE_REFUSAL_MESSAGES.missing);
		expect(fileRefusalText('missing', 'x')).toBe('Die Datei ist nicht mehr vorhanden.');
		expect(fileRefusalText('owner', 'Nur für den Besitzer.')).toBe('Nur für den Besitzer.');
	});

	it('reads the folder and the path of an entry from its metadata', () => {
		const item = { sourceMeta: { folder: { folder: 'Projekte', path: '2026/a.pdf', size: 3 } } };
		expect(folderMetaText(item, 'folder')).toBe('Projekte');
		expect(folderMetaText(item, 'path')).toBe('2026/a.pdf');
		expect(folderMetaText({ sourceMeta: {} }, 'path')).toBe('');
		expect(folderMetaText({ sourceMeta: { folder: { path: 3 } } }, 'path')).toBe('');
	});
});
