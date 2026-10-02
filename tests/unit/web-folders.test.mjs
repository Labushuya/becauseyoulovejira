// The folder channel of the web app (web/src/lib/domain/folders.ts) against the hook module
// (app/pb_hooks/lib/folder-rules.js, ADR-0051): the same limits, default exclusions and texts of
// the codes and refusals, the same reading of paths under Windows and Linux and of patterns, the
// same keys of folders, and what the form sends is what the hook takes, so the form refuses what
// the hook refuses and the card shows what the server runs.

import { describe, expect, it } from 'vitest';
import { loadHookLib } from '../support/hook-lib.mjs';
import {
	DEFAULT_EXCLUDE,
	FILE_REFUSAL_MESSAGES,
	FOLDER_LIMITS,
	FOLDER_MESSAGES,
	emptyFolderDraft,
	folderDraftErrors,
	folderFromDraft,
	folderKey,
	folderName,
	folderSettingsOf,
	folderSettingsValue,
	isPattern,
	parseFolderPath,
	withFolder
} from '../../web/src/lib/domain/folders.ts';

const rules = loadHookLib('folder-rules.js');

const PATHS = {
	windows: [
		'C:\\Daten\\Projekte',
		'c:\\Daten\\Projekte\\',
		'C:/Daten/Projekte',
		'C:\\Daten\\\\Projekte',
		'C:\\',
		'C:',
		'C:Daten',
		'\\\\NAS\\Freigabe',
		'\\\\NAS\\Freigabe\\Projekte\\2026',
		'\\\\NAS',
		'\\\\?\\C:\\Daten',
		'\\\\.\\C:\\Daten',
		'C:\\Daten\\..\\Windows',
		'C:\\Daten\\.\\x',
		'C:\\Daten\\con',
		'C:\\Daten\\nul.txt',
		'C:\\Daten\\punkt.',
		'C:\\Daten\\leer ',
		'C:\\Daten\\a*b',
		'C:\\Daten\\a?b',
		'C:\\Daten\\a|b',
		'C:\\Daten\\__proto__',
		' C:\\Daten',
		'C:\\Daten ',
		'Daten\\Projekte',
		'/home/anna',
		`C:\\${'a'.repeat(256)}`,
		`C:\\${'a\\'.repeat(200)}`,
		'C:\\Über\\Größe ß',
		''
	],
	posix: [
		'/home/anna/Projekte',
		'/home/anna/Projekte/',
		'/home//anna',
		'/',
		'//',
		'/home/anna/../root',
		'/home/./anna',
		'home/anna',
		'C:\\Daten',
		'/home/anna/a\\b',
		'/home/anna/Leer zeichen',
		'/home/anna/__proto__',
		'/home/anna/\u0001',
		' /home/anna',
		`/${'a'.repeat(256)}`,
		''
	]
};

describe('web folders against the hooks', () => {
	it('knows the same limits and default exclusions', () => {
		for (const key of ['folders', 'intervalDefault', 'intervalMin', 'intervalMax', 'pathLength', 'componentLength', 'types', 'exclude', 'excludeLength', 'files', 'adoptBatch']) {
			expect(FOLDER_LIMITS[key], key).toBe(rules.LIMITS[key]);
		}
		expect([...DEFAULT_EXCLUDE]).toEqual(rules.DEFAULT_EXCLUDE);
	});

	it('words the codes and the refusals of "Ansehen" like the hook', () => {
		expect(FOLDER_MESSAGES).toEqual(rules.MESSAGES);
		for (const [reason, refusal] of Object.entries(rules.FILE_REFUSALS)) {
			expect(FILE_REFUSAL_MESSAGES[reason], reason).toBe(refusal.message);
		}
		expect(Object.keys(FILE_REFUSAL_MESSAGES).sort()).toEqual(Object.keys(rules.FILE_REFUSALS).sort());
	});

	it('reads the paths of folders under Windows and Linux the same', () => {
		for (const platform of ['windows', 'posix']) {
			for (const input of PATHS[platform]) {
				expect(parseFolderPath(input, platform), `${platform}: ${input}`).toEqual(rules.parseFolderPath(input, platform));
			}
		}
	});

	it('keys and names stored paths like the hook', () => {
		for (const path of ['C:\\Daten\\Projekte', '\\\\NAS\\Freigabe\\Ä', '/home/Anna/Projekte']) {
			const platform = path.startsWith('/') ? 'posix' : 'windows';
			expect(folderKey(path), path).toBe(rules.pathKey(path, platform));
			expect(folderName(path), path).toBe(rules.nameOf(path));
		}
	});

	it('takes and refuses the same patterns', () => {
		for (const pattern of [
			'*.tmp',
			'~$*',
			'.git/**',
			'node_modules/**',
			'/Archiv/**',
			'**/*.bak',
			'a/b/c.txt',
			'Thumbs.db',
			'',
			' x',
			'x ',
			'a\\b',
			'a/../b',
			'a/./b',
			'a//b',
			'a/',
			'a**b',
			'[ab]',
			'{a,b}',
			'!x',
			'x'.repeat(200),
			'x'.repeat(201),
			'a\u0007',
			42
		]) {
			expect(isPattern(pattern), String(pattern)).toBe(rules.isPattern(pattern));
		}
	});

	it('sends settings from the form that the hook takes, and reads stored settings like the channel', () => {
		const draft = {
			...emptyFolderDraft(),
			path: 'c:\\Daten\\Projekte\\',
			typesText: '.PDF, docx; *.xlsx pdf',
			excludeText: '*.tmp\r\n\r\n  Archiv\\**  \n~$*',
			target: 'haus00000000001',
			reportChanges: false,
			subfolders: false
		};
		expect(folderDraftErrors(draft, 'windows', { interval: 5, folders: [] }, null)).toEqual({});
		const folder = folderFromDraft(draft, 'windows');
		expect(folder).toEqual({
			path: 'C:\\Daten\\Projekte',
			subfolders: false,
			types: ['pdf', 'docx', 'xlsx'],
			exclude: ['*.tmp', 'Archiv/**', '~$*'],
			target: 'haus00000000001',
			reportChanges: false
		});
		const settings = withFolder({ interval: 10, folders: [] }, folder);
		const value = folderSettingsValue(settings);
		expect(rules.settingsViolation(value, 'windows')).toBe('');
		const hook = rules.settingsOf(value, 'windows');
		const web = folderSettingsOf(value);
		expect(web.interval).toBe(hook.interval);
		expect(web.folders.map((entry) => ({ ...entry, target: entry.target ?? '' }))).toEqual(
			hook.folders.map(({ key, name, ...rest }) => {
				expect(key).toBe(folderKey(rest.path));
				expect(name).toBe(folderName(rest.path));
				return rest;
			})
		);
		// Defaults of a folder without its switches: subfolders and changes on, the default exclusions.
		expect(folderSettingsOf({ folders: [{ path: '/srv/daten' }] }).folders[0]).toEqual({
			path: '/srv/daten',
			subfolders: true,
			types: [],
			exclude: [...rules.DEFAULT_EXCLUDE],
			target: null,
			reportChanges: true
		});
	});

	it('refuses in the form what the hook refuses, with its texts', () => {
		const empty = { interval: 5, folders: [] };
		const existing = { interval: 5, folders: [folderFromDraft({ ...emptyFolderDraft(), path: 'C:\\Daten' }, 'windows')] };
		const errors = (draft, settings = empty) => folderDraftErrors({ ...emptyFolderDraft(), ...draft }, 'windows', settings, null);
		expect(errors({ path: 'C:\\' }).path).toBe(rules.MESSAGES.validation_folder_root);
		expect(errors({ path: 'Daten' }).path).toBe(rules.MESSAGES.validation_folder_path);
		expect(errors({ path: 'c:\\daten\\' }, existing).path).toBe(rules.MESSAGES.validation_folder_duplicate);
		const full = { interval: 5, folders: Array.from({ length: 10 }, (_, i) => folderFromDraft({ ...emptyFolderDraft(), path: `C:\\D${i}` }, 'windows')) };
		expect(errors({ path: 'C:\\Neu' }, full).path).toBe(rules.MESSAGES.validation_folder_max);
		expect(rules.settingsViolation(folderSettingsValue(withFolder(full, folderFromDraft({ ...emptyFolderDraft(), path: 'C:\\Neu' }, 'windows'))), 'windows')).toMatchObject({ code: 'validation_folder_max' });
		expect(errors({ path: 'C:\\X', typesText: 'p.df' }).types).toContain(rules.MESSAGES.validation_folder_types);
		expect(errors({ path: 'C:\\X', excludeText: 'a/../b' }).exclude).toContain(rules.MESSAGES.validation_folder_exclude);
		expect(errors({ path: 'C:\\X', excludeText: '*.TMP\n*.tmp' }).exclude).toContain('zweimal');
		expect(rules.settingsViolation({ folders: [{ path: 'C:\\X', exclude: ['*.TMP', '*.tmp'] }] }, 'windows')).toMatchObject({ code: 'validation_folder_exclude' });
		const many = Array.from({ length: 31 }, (_, i) => `t${i}`).join(',');
		expect(errors({ path: 'C:\\X', typesText: many }).types).toBe(rules.MESSAGES.validation_folder_types);
		expect(rules.settingsViolation({ folders: [{ path: 'C:\\X', types: many.split(',') }] }, 'windows')).toMatchObject({ code: 'validation_folder_types' });
		// Editing a folder keeps its path: no check of the path, no duplicate with itself.
		expect(folderDraftErrors({ ...emptyFolderDraft(), path: 'C:\\Daten' }, 'windows', existing, folderKey('C:\\Daten'))).toEqual({});
	});
});
