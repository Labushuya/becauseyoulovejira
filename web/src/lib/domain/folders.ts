// Folder channel in the interface (ADR-0051 §2 and §7): the settings of a folder connection, the form
// of one folder, the details of the card, the files of before and the view of a file. Pure. The
// paths, patterns, types, limits and texts of the codes mirror app/pb_hooks/lib/folder-rules.js
// (tests/unit/web-folders.test.mjs compares them); the server checks everything again, also on the
// disk (exists, readable, no link, not the app).

import type { HostPlatform } from './host-platform';
import type { InboxState } from './inbox';
import { formatBerlinDateTime } from './format';

/** Paths follow the system of the server: drives and shares under Windows, "/…" under Linux. */
export type FolderPlatform = 'windows' | 'posix';

/** The system of the paths for the platform of the server (a container runs Linux). */
export function folderPlatformOf(host: HostPlatform): FolderPlatform {
	return host === 'windows' ? 'windows' : 'posix';
}

export const FOLDER_LIMITS = Object.freeze({
	folders: 10,
	intervalDefault: 5,
	intervalMin: 1,
	intervalMax: 60,
	pathLength: 400,
	componentLength: 255,
	types: 30,
	exclude: 30,
	excludeLength: 200,
	files: 2000,
	adoptBatch: 50
});

/** Choices of the interval at the card (any whole minute from 1 to 60 is valid). */
export const FOLDER_INTERVALS: readonly number[] = Object.freeze([1, 5, 10, 15, 30, 60]);

/** Exclusions of a new folder (spec, package 3). */
export const DEFAULT_EXCLUDE: readonly string[] = Object.freeze([
	'*.tmp',
	'~$*',
	'.git/**',
	'node_modules/**',
	'Thumbs.db',
	'desktop.ini'
]);

/** Texts of the codes of the hook (validation_folder_*), the same words. */
export const FOLDER_MESSAGES: Readonly<Record<string, string>> = Object.freeze({
	validation_folder_settings: 'Unbekannte Einstellung des Ordner-Kanals.',
	validation_folder_interval: 'Prüfen alle 1 bis 60 Minuten.',
	validation_folder_max: 'Höchstens 10 Ordner je Verbindung.',
	validation_folder_path:
		'Bitte den vollständigen Pfad eines Ordners angeben, etwa „C:\\Daten\\Projekte“, „\\\\NAS\\Freigabe“ oder unter Linux „/home/anna/Projekte“; ohne „..“ und ohne Zeichen wie * ? " < > |.',
	validation_folder_root: 'Bitte einen Ordner wählen, nicht ein ganzes Laufwerk.',
	validation_folder_duplicate: 'Dieser Ordner ist schon eingetragen.',
	validation_folder_types:
		'Dateitypen als Liste von höchstens 30 Endungen ohne Punkt, etwa „pdf“ oder „docx“.',
	validation_folder_exclude:
		'Ausschlüsse als Liste von höchstens 30 Mustern, je bis 200 Zeichen, etwa „*.tmp“ oder „.git/**“; ohne „..“, ohne „\\“ und ohne [ ] { } !.',
	validation_folder_target: 'Zielprojekt als ID eines Projekts oder leer.',
	validation_folder_missing: 'Diesen Ordner gibt es nicht, oder er ist gerade nicht erreichbar.',
	validation_folder_unreadable: 'Die App darf diesen Ordner nicht lesen.',
	validation_folder_link:
		'Der Pfad führt über eine Verknüpfung (Symlink oder Junction). Bitte den Zielordner direkt angeben.',
	validation_folder_alias:
		'Bitte den Pfad so angeben, wie ihn der Explorer zeigt: ohne Kurznamen mit „~“ und ohne Punkt oder Leerzeichen am Ende eines Namens.',
	validation_folder_app: 'Den Ordner der App selbst (app, pb_data) beobachtet die App nicht.'
});

/** Texts of the refusals of „Ansehen“ (folder-rules FILE_REFUSALS), by reason. */
export const FILE_REFUSAL_MESSAGES: Readonly<Record<string, string>> = Object.freeze({
	unknown: 'Diesen Eintrag gibt es nicht, oder er ist kein Eintrag aus einem Ordner.',
	folder:
		'Die Datei liegt nicht in einem beobachteten Ordner (mehr). Die App öffnet nur Dateien der eingetragenen Ordner.',
	path: 'Der Pfad der Datei ist ungültig. Die App öffnet ihn nicht.',
	link: 'Die Datei liegt hinter einer Verknüpfung (Symlink oder Junction). Die App öffnet nur Dateien direkt im Ordner.',
	missing: 'Die Datei ist nicht mehr vorhanden.',
	unreadable:
		'Die Datei lässt sich gerade nicht lesen (keine Berechtigung oder von einem anderen Programm gesperrt).',
	auth: 'Bitte anmelden. Der Link zur Datei gilt nur kurz; „Ansehen“ in der App holt einen neuen.'
});

const RECORD_ID = /^[a-z0-9]{15}$/;
const TYPE = /^[a-z0-9][a-z0-9_+-]{0,15}$/;
const WINDOWS_RESERVED =
	/^(con|prn|aux|nul|com[0-9\u00b9\u00b2\u00b3]|lpt[0-9\u00b9\u00b2\u00b3]|conin\$|conout\$)(\..*)?$/i;
// eslint-disable-next-line no-control-regex -- control characters are exactly what is refused
const WINDOWS_BAD = /[<>:"|?*\u0000-\u001f\\/]/;
// eslint-disable-next-line no-control-regex -- control characters are exactly what is refused
const CONTROL = /[\u0000-\u001f\u007f]/;

function isWindowsName(name: string): boolean {
	return (
		name !== '' &&
		name !== '.' &&
		name !== '..' &&
		name !== '__proto__' &&
		name.length <= FOLDER_LIMITS.componentLength &&
		!WINDOWS_BAD.test(name) &&
		!/[. ]$/.test(name) &&
		!WINDOWS_RESERVED.test(name)
	);
}

function isPosixName(name: string): boolean {
	return (
		name !== '' &&
		name !== '.' &&
		name !== '..' &&
		name !== '__proto__' &&
		name.length <= FOLDER_LIMITS.componentLength &&
		!name.includes('/') &&
		!CONTROL.test(name)
	);
}

export type FolderPathResult = { path: string; key: string } | { code: string };

/**
 * The path of a folder in the form the server stores (folder-rules.parseFolderPath): Windows "X:\…"
 * with a capital drive letter or "\\server\share\…", Linux "/…", no separator at the end; or the
 * code of what is wrong. The form trims the input before.
 */
export function parseFolderPath(input: string, platform: FolderPlatform): FolderPathResult {
	const raw = input;
	if (raw === '' || raw.trim() !== raw || raw.length > FOLDER_LIMITS.pathLength) {
		return { code: 'validation_folder_path' };
	}
	if (platform === 'windows') {
		const value = raw.replace(/\//g, '\\');
		if (/^\\\\[?.]\\/.test(value)) return { code: 'validation_folder_path' };
		let prefix: string;
		let rest: string;
		let unc = false;
		const drive = /^([A-Za-z]):\\(.*)$/.exec(value);
		if (drive) {
			prefix = `${(drive[1] ?? '').toUpperCase()}:`;
			rest = drive[2] ?? '';
		} else {
			const share = /^\\\\([^\\]+)\\([^\\]+)(?:\\(.*))?$/.exec(value);
			const server = share?.[1] ?? '';
			const name = share?.[2] ?? '';
			if (!isWindowsName(server) || !isWindowsName(name)) {
				return { code: 'validation_folder_path' };
			}
			prefix = `\\\\${server}\\${name}`;
			rest = share?.[3] ?? '';
			unc = true;
		}
		rest = rest.replace(/\\+$/, '');
		const parts = rest === '' ? [] : rest.split('\\');
		if (!parts.every(isWindowsName)) return { code: 'validation_folder_path' };
		if (!unc && parts.length === 0) return { code: 'validation_folder_root' };
		const path = prefix + (parts.length > 0 ? `\\${parts.join('\\')}` : '');
		return { path, key: path.toLowerCase() };
	}
	if (!raw.startsWith('/')) return { code: 'validation_folder_path' };
	const trimmed = raw.replace(/\/+$/, '');
	if (trimmed === '') return { code: 'validation_folder_root' };
	if (!trimmed.slice(1).split('/').every(isPosixName)) return { code: 'validation_folder_path' };
	return { path: trimmed, key: trimmed };
}

/**
 * The key of a stored path: Windows paths never start with "/", Linux paths always, so the form
 * says the system (lower case under Windows, as the server compares).
 */
export function folderKey(path: string): string {
	return path.startsWith('/') ? path : path.toLowerCase();
}

/** The last name of a path ("Projekte" of "C:\Daten\Projekte"). */
export function folderName(path: string): string {
	const cut = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
	return cut === -1 ? path : path.slice(cut + 1);
}

/** Whether an exclusion pattern is valid (folder-rules.isPattern). */
export function isPattern(value: unknown): value is string {
	if (typeof value !== 'string' || value.length === 0) return false;
	if (value.length > FOLDER_LIMITS.excludeLength || value.trim() !== value) return false;
	// eslint-disable-next-line no-control-regex -- control characters are exactly what is refused
	if (/[\u0000-\u001f\u007f\\[\]{}!]/.test(value)) return false;
	const body = value.startsWith('/') ? value.slice(1) : value;
	return body
		.split('/')
		.every(
			(segment) =>
				segment !== '' &&
				segment !== '.' &&
				segment !== '..' &&
				(!segment.includes('**') || segment === '**')
		);
}

// --- Settings of a connection -----------------------------------------------------------------

export interface FolderConfig {
	/** Absolute path in the stored form. */
	path: string;
	subfolders: boolean;
	/** Extensions without dot in lower case; empty for every type. */
	types: string[];
	exclude: string[];
	/** Own target project; null takes the one of the connection. */
	target: string | null;
	reportChanges: boolean;
}

export interface FolderSettings {
	interval: number;
	folders: FolderConfig[];
}

export const EMPTY_FOLDER_SETTINGS: FolderSettings = Object.freeze({
	interval: FOLDER_LIMITS.intervalDefault,
	folders: []
});

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringList(value: unknown): string[] | null {
	return Array.isArray(value) && value.every((entry) => typeof entry === 'string')
		? [...(value as string[])]
		: null;
}

/**
 * The settings of a connection as the server reads them (folder-rules.settingsOf): defaults for
 * missing values (subfolders and "Änderungen melden" on, the default exclusions), folders without a
 * path or twice left out.
 */
export function folderSettingsOf(settings: unknown): FolderSettings {
	const value = isPlainObject(settings) ? settings : {};
	const interval = value.interval;
	const folders: FolderConfig[] = [];
	const seen = new Set<string>();
	for (const entry of Array.isArray(value.folders) ? value.folders : []) {
		if (folders.length >= FOLDER_LIMITS.folders) break;
		if (!isPlainObject(entry) || typeof entry.path !== 'string' || entry.path === '') continue;
		const key = folderKey(entry.path);
		if (seen.has(key)) continue;
		seen.add(key);
		folders.push({
			path: entry.path,
			subfolders: entry.subfolders !== false,
			types: stringList(entry.types) ?? [],
			exclude: stringList(entry.exclude) ?? [...DEFAULT_EXCLUDE],
			target:
				typeof entry.target === 'string' && RECORD_ID.test(entry.target) ? entry.target : null,
			reportChanges: entry.report_changes !== false
		});
	}
	return {
		interval:
			typeof interval === 'number' &&
			Number.isInteger(interval) &&
			interval >= FOLDER_LIMITS.intervalMin &&
			interval <= FOLDER_LIMITS.intervalMax
				? interval
				: FOLDER_LIMITS.intervalDefault,
		folders
	};
}

/** The JSON the server stores in connections.settings. */
export function folderSettingsValue(settings: FolderSettings): Record<string, unknown> {
	return {
		interval: settings.interval,
		folders: settings.folders.map((folder) => ({
			path: folder.path,
			subfolders: folder.subfolders,
			types: [...folder.types],
			exclude: [...folder.exclude],
			target: folder.target ?? '',
			report_changes: folder.reportChanges
		}))
	};
}

/** The settings with `folder` added at the end or, with the same key, in place of the old one. */
export function withFolder(settings: FolderSettings, folder: FolderConfig): FolderSettings {
	const key = folderKey(folder.path);
	const index = settings.folders.findIndex((entry) => folderKey(entry.path) === key);
	const folders =
		index === -1
			? [...settings.folders, folder]
			: settings.folders.map((entry, at) => (at === index ? folder : entry));
	return { ...settings, folders };
}

/** The settings without the folder of `key`. */
export function withoutFolder(settings: FolderSettings, key: string): FolderSettings {
	return {
		...settings,
		folders: settings.folders.filter((entry) => folderKey(entry.path) !== key)
	};
}

// --- Form of one folder -----------------------------------------------------------------------

/** What the form of a folder holds: types and exclusions as text. */
export interface FolderDraft {
	path: string;
	subfolders: boolean;
	/** Extensions separated by commas or spaces, with or without dot. */
	typesText: string;
	/** One pattern per line. */
	excludeText: string;
	target: string | null;
	reportChanges: boolean;
}

/** A new folder: subfolders, every type, the default exclusions, changes reported. */
export function emptyFolderDraft(): FolderDraft {
	return {
		path: '',
		subfolders: true,
		typesText: '',
		excludeText: DEFAULT_EXCLUDE.join('\n'),
		target: null,
		reportChanges: true
	};
}

/** The form of a folder that is there already. */
export function folderDraftOf(folder: FolderConfig): FolderDraft {
	return {
		path: folder.path,
		subfolders: folder.subfolders,
		typesText: folder.types.join(', '),
		excludeText: folder.exclude.join('\n'),
		target: folder.target,
		reportChanges: folder.reportChanges
	};
}

/** The extensions of the form: lower case, without dot, each once. */
export function draftTypes(text: string): string[] {
	const list: string[] = [];
	for (const part of text.split(/[\s,;]+/)) {
		const value = part.replace(/^\*?\.+/, '').toLowerCase();
		if (value !== '' && !list.includes(value)) list.push(value);
	}
	return list;
}

/** The patterns of the form: one per line, trimmed, "\" written as "/". */
export function draftExclude(text: string): string[] {
	return text
		.split(/\r?\n/)
		.map((line) => line.trim().replace(/\\/g, '/'))
		.filter((line) => line !== '');
}

export type FolderDraftField = 'path' | 'types' | 'exclude';

export const FOLDER_PATH_REQUIRED = 'Bitte den Pfad des Ordners eingeben.';
const EXCLUDE_DUPLICATE_MESSAGE = 'Dieses Muster steht zweimal in der Liste.';

/**
 * Errors of the form: the path (its form, that it is not there yet except the one being edited,
 * `editing` its key, and the number of folders), the types and the patterns (naming the first wrong
 * one). Empty when the draft is fine; the server checks the folder on the disk afterwards.
 */
export function folderDraftErrors(
	draft: FolderDraft,
	platform: FolderPlatform,
	settings: FolderSettings,
	editing: string | null
): Partial<Record<FolderDraftField, string>> {
	const errors: Partial<Record<FolderDraftField, string>> = {};
	if (editing === null) {
		const input = draft.path.trim();
		const parsed = input === '' ? null : parseFolderPath(input, platform);
		if (parsed === null) errors.path = FOLDER_PATH_REQUIRED;
		else if ('code' in parsed) errors.path = FOLDER_MESSAGES[parsed.code];
		else if (settings.folders.some((entry) => folderKey(entry.path) === parsed.key)) {
			errors.path = FOLDER_MESSAGES.validation_folder_duplicate;
		} else if (settings.folders.length >= FOLDER_LIMITS.folders) {
			errors.path = FOLDER_MESSAGES.validation_folder_max;
		}
	}
	const types = draftTypes(draft.typesText);
	const badType = types.find((type) => !TYPE.test(type));
	if (badType !== undefined) {
		errors.types = `„${badType}“: ${FOLDER_MESSAGES.validation_folder_types}`;
	} else if (types.length > FOLDER_LIMITS.types) {
		errors.types = FOLDER_MESSAGES.validation_folder_types;
	}
	const exclude = draftExclude(draft.excludeText);
	const badPattern = exclude.find((pattern) => !isPattern(pattern));
	if (badPattern !== undefined) {
		errors.exclude = `„${badPattern}“: ${FOLDER_MESSAGES.validation_folder_exclude}`;
	} else {
		const seen = new Set<string>();
		for (const pattern of exclude) {
			if (seen.has(pattern.toLowerCase())) {
				errors.exclude = `„${pattern}“: ${EXCLUDE_DUPLICATE_MESSAGE}`;
				break;
			}
			seen.add(pattern.toLowerCase());
		}
		if (errors.exclude === undefined && exclude.length > FOLDER_LIMITS.exclude) {
			errors.exclude = FOLDER_MESSAGES.validation_folder_exclude;
		}
	}
	return errors;
}

/** The folder of a valid draft (the path in its stored form). */
export function folderFromDraft(draft: FolderDraft, platform: FolderPlatform): FolderConfig {
	const parsed = parseFolderPath(draft.path.trim(), platform);
	return {
		path: 'path' in parsed ? parsed.path : draft.path.trim(),
		subfolders: draft.subfolders,
		types: draftTypes(draft.typesText),
		exclude: draftExclude(draft.excludeText),
		target: draft.target,
		reportChanges: draft.reportChanges
	};
}

// --- Details of the card (GET /api/byl/connections/{id}/folders) ------------------------------

export type FolderChangeAction = 'added' | 'changed' | 'removed' | 'moved';

export interface FolderChange {
	/** Path below the folder. */
	path: string;
	action: FolderChangeAction;
	at: string;
	/** The path before a move. */
	from: string | null;
}

export interface FolderSummary {
	/** ID of the folder in the routes of the card (a hash of its path). */
	id: string;
	path: string;
	key: string;
	name: string;
	subfolders: boolean;
	types: string[];
	exclude: string[];
	target: string | null;
	reportChanges: boolean;
	/** Files watched now. */
	files: number;
	/** Files the last scan found matching; null before the first. */
	matching: number | null;
	/** More files than the app watches (the limit). */
	more: boolean;
	/** The last scan stopped early (too many entries or the time). */
	incomplete: boolean;
	/** The last run did not get to the folder. */
	pending: boolean;
	lastChange: FolderChange | null;
	/** When the first run took the base; '' before. */
	baseAt: string;
	/** Problem of the folder in the last run ("nicht erreichbar"), '' without. */
	error: string;
}

export interface FolderDetails {
	interval: number;
	platform: FolderPlatform;
	/** Files per folder the app watches at most. */
	limit: number;
	folders: FolderSummary[];
}

const CHANGE_ACTIONS: readonly FolderChangeAction[] = ['added', 'changed', 'removed', 'moved'];

function text(value: unknown): string {
	return typeof value === 'string' ? value : '';
}

function count(value: unknown): number {
	return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : 0;
}

function changeOf(value: unknown): FolderChange | null {
	if (!isPlainObject(value)) return null;
	const action = CHANGE_ACTIONS.find((entry) => entry === value.action);
	if (action === undefined || typeof value.path !== 'string') return null;
	return {
		path: value.path,
		action,
		at: text(value.at),
		from: typeof value.from === 'string' ? value.from : null
	};
}

function summaryOf(value: unknown): FolderSummary | null {
	if (!isPlainObject(value) || typeof value.path !== 'string' || typeof value.id !== 'string') {
		return null;
	}
	return {
		id: value.id,
		path: value.path,
		key: text(value.key) || folderKey(value.path),
		name: text(value.name) || folderName(value.path),
		subfolders: value.subfolders !== false,
		types: stringList(value.types) ?? [],
		exclude: stringList(value.exclude) ?? [],
		target: typeof value.target === 'string' && RECORD_ID.test(value.target) ? value.target : null,
		reportChanges: value.reportChanges !== false,
		files: count(value.files),
		matching: typeof value.matching === 'number' ? count(value.matching) : null,
		more: value.more === true,
		incomplete: value.incomplete === true,
		pending: value.pending === true,
		lastChange: changeOf(value.lastChange),
		baseAt: text(value.baseAt),
		error: text(value.error)
	};
}

/** The details of the card from the answer of the server; broken parts are left out. */
export function folderDetailsOf(value: unknown): FolderDetails {
	const raw = isPlainObject(value) ? value : {};
	const folders = (Array.isArray(raw.folders) ? raw.folders : [])
		.map(summaryOf)
		.filter((folder): folder is FolderSummary => folder !== null);
	return {
		interval:
			typeof raw.interval === 'number' && Number.isInteger(raw.interval)
				? raw.interval
				: FOLDER_LIMITS.intervalDefault,
		platform: raw.platform === 'posix' ? 'posix' : 'windows',
		limit: typeof raw.limit === 'number' && raw.limit > 0 ? raw.limit : FOLDER_LIMITS.files,
		folders
	};
}

/** A count with a dot between thousands ("2.000"). */
function grouped(value: number): string {
	return String(Math.max(0, Math.trunc(value))).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

/** "jede Minute", "alle 5 Minuten", "jede Stunde". */
export function folderIntervalText(minutes: number): string {
	if (minutes === 1) return 'jede Minute';
	return minutes === 60 ? 'jede Stunde' : `alle ${minutes} Minuten`;
}

/** Watched files of a folder: "12 Dateien", "2.000 von 3.120 Dateien (Grenze erreicht)". */
export function filesText(summary: FolderSummary, limit: number): string {
	if (summary.baseAt === '') return 'noch nicht erfasst';
	const files = `${grouped(summary.files)} ${summary.files === 1 ? 'Datei' : 'Dateien'}`;
	if (summary.more && summary.matching !== null && summary.matching > summary.files) {
		return `${grouped(summary.files)} von ${grouped(summary.matching)} Dateien (höchstens ${grouped(limit)} je Ordner)`;
	}
	return summary.incomplete ? `${files}, Ordner nicht vollständig gelesen` : files;
}

const ACTION_WORDS: Readonly<Record<FolderChangeAction, string>> = Object.freeze({
	added: 'neu',
	changed: 'geändert',
	removed: 'gelöscht',
	moved: 'verschoben'
});

/**
 * The last change of a folder like the one of a repository: "2026/Angebot.pdf neu, 02.10.2026
 * 08:03", a move with where it came from; "noch keine" without.
 */
export function lastChangeText(change: FolderChange | null): string {
	if (change === null) return 'noch keine';
	const from = change.action === 'moved' && change.from !== null ? ` (vorher ${change.from})` : '';
	const at = change.at === '' ? '' : `, ${formatBerlinDateTime(change.at)}`;
	return `${change.path} ${ACTION_WORDS[change.action]}${from}${at}`;
}

/** Size of a file: "512 Byte", "12 KB", "1,4 MB", "2,1 GB". */
export function fileSizeText(bytes: number): string {
	const value = Math.max(0, Math.trunc(bytes));
	if (value < 1024) return `${value} Byte`;
	if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`;
	const unit = value < 1024 * 1024 * 1024 ? 'MB' : 'GB';
	const scaled = value / (unit === 'MB' ? 1024 * 1024 : 1024 * 1024 * 1024);
	return `${scaled.toFixed(1).replace('.', ',')} ${unit}`;
}

/** The types of a folder in words: "alle" or "pdf, docx". */
export function typesText(types: readonly string[]): string {
	return types.length === 0 ? 'alle' : types.join(', ');
}

// --- Files of before (GET …/folders/existing, POST …/folders/adopt) ---------------------------

export interface ExistingFile {
	/** Path below the folder. */
	path: string;
	name: string;
	size: number;
	modified: string;
	/** State of an entry of the file in the inbox; '' without one. */
	state: '' | InboxState;
}

export interface ExistingFiles {
	folder: string;
	name: string;
	/** Whether the first run took the base yet (without it the list is empty). */
	base: boolean;
	files: ExistingFile[];
}

const STATES: readonly InboxState[] = ['new', 'converted', 'discarded'];

/** The list of the server, broken entries left out. */
export function existingFilesOf(value: unknown): ExistingFiles {
	const raw = isPlainObject(value) ? value : {};
	const files: ExistingFile[] = [];
	for (const entry of Array.isArray(raw.files) ? raw.files : []) {
		if (!isPlainObject(entry) || typeof entry.path !== 'string') continue;
		files.push({
			path: entry.path,
			name: text(entry.name) || folderName(entry.path),
			size: count(entry.size),
			modified: text(entry.modified),
			state: STATES.find((state) => state === entry.state) ?? ''
		});
	}
	return { folder: text(raw.folder), name: text(raw.name), base: raw.base === true, files };
}

/** Answer of "Vorhandene Dateien übernehmen" for one block. */
export interface AdoptResult {
	created: number;
	duplicates: number;
	skipped: number;
	failed: number;
}

export function adoptResultOf(value: unknown): AdoptResult {
	const raw = isPlainObject(value) ? value : {};
	return {
		created: count(raw.created),
		duplicates: count(raw.duplicates),
		skipped: count(raw.skipped),
		failed: count(raw.failed)
	};
}

/** What the state of a file of before says in the list, '' for a file not in the inbox yet. */
export function existingStateText(state: ExistingFile['state']): string {
	switch (state) {
		case 'new':
			return 'schon im Eingang';
		case 'converted':
			return 'schon an einem Ticket';
		case 'discarded':
			return 'schon verworfen';
		default:
			return '';
	}
}

/** The flag after taking files over: "3 Dateien übernommen, 1 war schon da." */
export function adoptSummary(result: AdoptResult): string {
	const parts = [
		`${grouped(result.created)} ${result.created === 1 ? 'Datei' : 'Dateien'} in den Eingang übernommen`
	];
	if (result.duplicates > 0) {
		parts.push(
			`${grouped(result.duplicates)} ${result.duplicates === 1 ? 'war' : 'waren'} schon da`
		);
	}
	if (result.skipped > 0) parts.push(`${grouped(result.skipped)} nicht mehr vorhanden`);
	if (result.failed > 0) {
		parts.push(`${grouped(result.failed)} nicht übernommen`);
	}
	return `${parts.join(', ')}.`;
}

// --- Entries of a folder ----------------------------------------------------------------------

/**
 * A detail of an entry of a folder from its `source_meta.folder` (folder-rules.fileDraft): the name
 * of the folder or the path of the file below it; '' when missing or not text.
 */
export function folderMetaText(
	item: { sourceMeta: Readonly<Record<string, unknown>> },
	key: 'folder' | 'path'
): string {
	const meta = item.sourceMeta.folder;
	if (!isPlainObject(meta)) return '';
	const value = meta[key];
	return typeof value === 'string' ? value : '';
}

// --- "Ansehen" (GET /api/byl/folders/items/{id}) ----------------------------------------------

export interface FileView {
	name: string;
	/** Path below the folder. */
	path: string;
	/** Name of the folder. */
	folder: string;
	size: number;
	modified: string;
	/** Whether the browser shows it (PDF, image, text); else it downloads. */
	inline: boolean;
	/** Address of the file with a short token; opened as a link. */
	url: string;
}

/** The answer of the server, null when it is not one. */
export function fileViewOf(value: unknown): FileView | null {
	if (!isPlainObject(value) || typeof value.url !== 'string' || !value.url.startsWith('/api/')) {
		return null;
	}
	return {
		name: text(value.name),
		path: text(value.path),
		folder: text(value.folder),
		size: count(value.size),
		modified: text(value.modified),
		inline: value.inline === true,
		url: value.url
	};
}

/** The text of a refusal of "Ansehen" by its reason; the message of the server otherwise. */
export function fileRefusalText(reason: string, message: string): string {
	return FILE_REFUSAL_MESSAGES[reason] ?? message;
}
