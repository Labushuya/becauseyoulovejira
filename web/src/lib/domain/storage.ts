// Page "Einstellungen → Speicher" (ADR-0047 §6 to §9, SPE-2): the answer of GET /api/byl/storage
// read strictly, and the words of the page. Pure; the server measures (app/pb_hooks/lib/
// storage-service.js, rules in lib/storage-rules.js), the SPA only words it.

import type { Status } from './status';
import { formatPointInTime, type SystemDenial } from './system';

/** Count and bytes, with the oldest and newest time where the server knows them (ISO). */
export interface StorageSummary {
	count: number;
	bytes: number;
	oldest: string | null;
	newest: string | null;
}

/** A database file: size on disk, its write-ahead log and the free pages inside (null: unknown). */
export interface DatabaseSize {
	bytes: number | null;
	walBytes: number | null;
	freeBytes: number | null;
}

export type DatabaseGroup = 'tickets' | 'history' | 'inbox' | 'other';
export const DATABASE_GROUPS: readonly DatabaseGroup[] = ['tickets', 'history', 'inbox', 'other'];

/** Where an original file of the inbox belongs (lib/storage-rules.js FILE_CATEGORIES). */
export type FileCategory = 'new' | 'open' | 'done' | 'discarded' | 'trash' | 'other';
export const FILE_CATEGORIES: readonly FileCategory[] = [
	'new',
	'open',
	'done',
	'discarded',
	'trash',
	'other'
];

export interface LargestEntry {
	item: string;
	title: string;
	channel: string;
	bytes: number;
	category: FileCategory;
	ticket: { id: string; key: string; status: string; trashed: boolean } | null;
	/** Key of the ticket the entry was copied from ("Duplizieren"), '' for none. */
	copyOf: string;
}

/** Groups of "Liegengebliebenes aufräumen". */
export type LeftoverGroup = 'programs' | 'safety' | 'pocketbase';
export const LEFTOVER_GROUPS: readonly LeftoverGroup[] = ['programs', 'safety', 'pocketbase'];

export type StorageAction = 'vacuum' | 'leftovers' | 'discarded';

export interface StorageOverview {
	measuredAt: string;
	/** The server is the own instance of a folder app under Windows: program, logs, free space. */
	ownInstance: boolean;
	database: DatabaseSize & {
		groups: Record<DatabaseGroup, number> | null;
		trash: { tickets: number; bytes: number; blocked: number } | null;
	};
	logsDatabase: DatabaseSize;
	files: {
		total: { count: number; bytes: number };
		categories: Record<FileCategory, { count: number; bytes: number }>;
		/** Berlin day the daily cleanup empties the next discarded entry, null for none. */
		nextEmpty: string | null;
		copies: { count: number; bytes: number };
		largest: readonly LargestEntry[];
	};
	backups: {
		local: StorageSummary;
		pocketbase: StorageSummary;
		other: StorageSummary;
		/** null: no target folder set. */
		target: StorageSummary | 'unreachable' | null;
		safety: StorageSummary | null;
	};
	logs: { count: number; bytes: number } | null;
	program: {
		files: { count: number; bytes: number };
		leftovers: { count: number; bytes: number };
		web: { bytes: number; complete: boolean; builds: number | null };
	} | null;
	disk: { level: 'ok' | 'info' | 'warning' | 'error'; text: string } | null;
	actions: {
		leftovers: Record<LeftoverGroup, { count: number; bytes: number } | null>;
		discarded: { count: number; bytes: number };
	};
}

type Json = Record<string, unknown>;

function isRecord(value: unknown): value is Json {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function numberOr(value: unknown, fallback: number | null): number | null {
	return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function count(value: unknown): { count: number; bytes: number } | null {
	if (!isRecord(value)) return null;
	const counted = numberOr(value.count, null);
	const bytes = numberOr(value.bytes, null);
	return counted === null || bytes === null ? null : { count: counted, bytes };
}

function summary(value: unknown): StorageSummary | null {
	const base = count(value);
	if (base === null || !isRecord(value)) return null;
	const time = (entry: unknown) => (typeof entry === 'string' ? entry : null);
	return { ...base, oldest: time(value.oldest), newest: time(value.newest) };
}

function size(value: unknown): DatabaseSize | null {
	if (!isRecord(value)) return null;
	return {
		bytes: numberOr(value.bytes, null),
		walBytes: numberOr(value.wal_bytes, null),
		freeBytes: numberOr(value.free_bytes, null)
	};
}

function groups(value: unknown): Record<DatabaseGroup, number> | null {
	if (!isRecord(value)) return null;
	const result = {} as Record<DatabaseGroup, number>;
	for (const group of DATABASE_GROUPS) {
		const bytes = numberOr(value[group], null);
		if (bytes === null) return null;
		result[group] = bytes;
	}
	return result;
}

function largestOf(value: unknown): LargestEntry[] {
	if (!Array.isArray(value)) return [];
	return value.filter(isRecord).flatMap((entry) => {
		const category = FILE_CATEGORIES.find((name) => name === entry.category);
		const bytes = numberOr(entry.bytes, null);
		if (category === undefined || bytes === null || typeof entry.item !== 'string') return [];
		const ticket = isRecord(entry.ticket)
			? {
					id: String(entry.ticket.id),
					key: String(entry.ticket.key),
					status: String(entry.ticket.status),
					trashed: entry.ticket.trashed === true
				}
			: null;
		return [
			{
				item: entry.item,
				title: String(entry.title ?? ''),
				channel: String(entry.channel ?? ''),
				bytes,
				category,
				ticket,
				copyOf: typeof entry.copy_of === 'string' ? entry.copy_of : ''
			}
		];
	});
}

/** The answer of GET /api/byl/storage, or null when it does not have the expected shape. */
export function parseOverview(value: unknown): StorageOverview | null {
	if (!isRecord(value) || typeof value.measured_at !== 'string') return null;
	const database = size(value.database);
	const logsDatabase = size(value.logs_database);
	const files = isRecord(value.files) ? value.files : null;
	const backups = isRecord(value.backups) ? value.backups : null;
	const actions = isRecord(value.actions) ? value.actions : null;
	if (database === null || logsDatabase === null || files === null || backups === null) return null;
	if (actions === null || !isRecord(files.categories) || !isRecord(database)) return null;
	const total = count(files.total);
	const copies = count(files.copies);
	const categories = {} as Record<FileCategory, { count: number; bytes: number }>;
	for (const name of FILE_CATEGORIES) {
		const entry = count(files.categories[name]);
		if (entry === null) return null;
		categories[name] = entry;
	}
	const local = summary(backups.local);
	const pocketbase = summary(backups.pocketbase);
	const other = summary(backups.other);
	const discarded = count(actions.discarded);
	const leftovers = isRecord(actions.leftovers) ? actions.leftovers : null;
	if (total === null || copies === null || local === null || pocketbase === null) return null;
	if (other === null || discarded === null || leftovers === null) return null;
	const rawDatabase = value.database as Json;
	const trash = isRecord(rawDatabase.trash) ? rawDatabase.trash : null;
	const nextEmpty = isRecord(files.categories.discarded)
		? files.categories.discarded.next_empty
		: null;
	const program = isRecord(value.program) ? value.program : null;
	const web = program !== null && isRecord(program.web) ? program.web : null;
	const programFiles = program === null ? null : count(program.files);
	const programLeftovers = program === null ? null : count(program.leftovers);
	const disk = isRecord(value.disk) ? value.disk : null;
	const levels = ['ok', 'info', 'warning', 'error'] as const;
	const level = levels.find((entry) => entry === disk?.level);
	return {
		measuredAt: value.measured_at,
		ownInstance: value.own_instance === true,
		database: {
			...database,
			groups: groups(rawDatabase.groups),
			trash:
				trash === null
					? null
					: {
							tickets: numberOr(trash.tickets, 0) ?? 0,
							bytes: numberOr(trash.bytes, 0) ?? 0,
							blocked: numberOr(trash.blocked, 0) ?? 0
						}
		},
		logsDatabase,
		files: {
			total,
			categories,
			nextEmpty: typeof nextEmpty === 'string' ? nextEmpty : null,
			copies,
			largest: largestOf(files.largest)
		},
		backups: {
			local,
			pocketbase,
			other,
			target: backups.target === 'unreachable' ? 'unreachable' : summary(backups.target),
			safety: summary(backups.safety)
		},
		logs: count(value.logs),
		program:
			programFiles === null || programLeftovers === null || web === null
				? null
				: {
						files: programFiles,
						leftovers: programLeftovers,
						web: {
							bytes: numberOr(web.bytes, 0) ?? 0,
							complete: web.complete !== false,
							builds: numberOr(web.builds, null)
						}
					},
		disk:
			disk !== null && level !== undefined && typeof disk.text === 'string'
				? { level, text: disk.text }
				: null,
		actions: {
			leftovers: {
				programs: count(leftovers.programs),
				safety: count(leftovers.safety),
				pocketbase: count(leftovers.pocketbase)
			},
			discarded
		}
	};
}

/** "0 B", "512 B", "12 KB", "3,4 MB", "1,2 GB". */
export function bytesText(bytes: number): string {
	if (bytes < 1024) return `${Math.max(0, Math.round(bytes))} B`;
	const units = ['KB', 'MB', 'GB', 'TB'];
	let value = bytes / 1024;
	let unit = 0;
	while (value >= 1024 && unit < units.length - 1) {
		value /= 1024;
		unit += 1;
	}
	const rounded = value >= 100 || unit === 0 ? Math.round(value) : Math.round(value * 10) / 10;
	return `${String(rounded).replace('.', ',')} ${units[unit]}`;
}

/** "3 Dateien, 12,4 MB" (also for one and none). */
export function countText(
	entry: { count: number; bytes: number },
	one = 'Datei',
	many = 'Dateien'
): string {
	const counted = entry.count === 1 ? `1 ${one}` : `${entry.count} ${many}`;
	return `${counted}, ${bytesText(entry.bytes)}`;
}

/** Size of a database with its free part: "48 MB, davon 6,2 MB frei". */
export function databaseText(size: DatabaseSize): string {
	if (size.bytes === null) return 'unbekannt';
	const free =
		size.freeBytes !== null && size.freeBytes > 0
			? `, davon ${bytesText(size.freeBytes)} frei`
			: '';
	const wal =
		size.walBytes !== null && size.walBytes > 0
			? ` (dazu ${bytesText(size.walBytes)} Schreibprotokoll)`
			: '';
	return `${bytesText(size.bytes)}${free}${wal}`;
}

/** "4 Sicherungen, 120 MB · älteste 01.09.2026 03:00 · neueste 01.10.2026 03:00". */
export function summaryText(
	entry: StorageSummary,
	one = 'Sicherung',
	many = 'Sicherungen'
): string {
	if (entry.count === 0) return 'keine';
	const oldest = entry.count > 1 ? formatPointInTime(entry.oldest) : '';
	const newest = formatPointInTime(entry.newest);
	return [
		countText(entry, one, many),
		...(oldest === '' ? [] : [`älteste ${oldest}`]),
		...(newest === '' ? [] : [`neueste ${newest}`])
	].join(' · ');
}

export const DATABASE_GROUP_LABELS: Readonly<Record<DatabaseGroup, string>> = Object.freeze({
	tickets: 'Tickets und Kommentare',
	history: 'Verlauf',
	inbox: 'Eingang',
	other: 'Sonstiges'
});

export const FILE_CATEGORY_LABELS: Readonly<Record<FileCategory, string>> = Object.freeze({
	new: 'Neu im Eingang',
	open: 'An offenen Tickets',
	done: 'An erledigten Tickets',
	discarded: 'Verworfen',
	trash: 'An Tickets im Papierkorb',
	other: 'Sonstige Dateien'
});

const STATUS_WORDS: Readonly<Record<Status, string>> = Object.freeze({
	backlog: 'offen',
	open: 'offen',
	in_progress: 'in Arbeit',
	waiting: 'wartet',
	done: 'erledigt'
});

/** Where a large file belongs, in words: "gehört zu HAUS-12 (offen)", "Kopie aus HAUS-3". */
export function belongsText(entry: LargestEntry): string {
	const parts: string[] = [];
	if (entry.ticket !== null) {
		const status = (STATUS_WORDS as Record<string, string>)[entry.ticket.status] ?? 'offen';
		parts.push(
			entry.ticket.trashed
				? `gehört zu ${entry.ticket.key} im Papierkorb`
				: `gehört zu ${entry.ticket.key} (${status})`
		);
	} else if (entry.category === 'new') {
		parts.push('neu im Eingang');
	} else if (entry.category === 'discarded') {
		parts.push('verworfen');
	}
	if (entry.copyOf !== '') parts.push(`Kopie aus ${entry.copyOf}`);
	return parts.join(' · ');
}

export const LEFTOVER_LABELS: Readonly<Record<LeftoverGroup, string>> = Object.freeze({
	programs: 'Programmreste nach Updates (byl-mail.exe.old-…, byl-backup.exe.old-…)',
	safety: 'Abgelaufene Sicherheitskopien des Datenordners (älter als 7 Tage)',
	pocketbase: 'Alte automatische Sicherungen von PocketBase (@auto_pb_backup_…)'
});

/** The preview of an action: "Betrifft 3 Dateien, 190 MB." */
export function previewText(entries: readonly ({ count: number; bytes: number } | null)[]): string {
	const known = entries.filter(
		(entry): entry is { count: number; bytes: number } => entry !== null
	);
	const total = known.reduce(
		(sum, entry) => ({ count: sum.count + entry.count, bytes: sum.bytes + entry.bytes }),
		{ count: 0, bytes: 0 }
	);
	if (total.count === 0) return 'Betrifft nichts.';
	return `Betrifft ${countText(total, 'Eintrag', 'Einträge')}.`;
}

/** Texts of the actions. */
export const ACTION_TEXTS = Object.freeze({
	vacuum: {
		title: 'Datenbank verdichten',
		text: 'Gibt den freien Platz in data.db und auxiliary.db an das Laufwerk zurück. Während des Verdichtens (meist wenige Sekunden) wartet jede andere Anfrage an die App kurz.',
		done: 'Datenbank verdichtet.'
	},
	leftovers: {
		title: 'Liegengebliebenes aufräumen',
		text: 'Löscht, was nach Updates und Wiederherstellungen übrig ist. Alte Sicherungen von PocketBase nur, wenn du sie ausdrücklich wählst; die Sicherungen der App bleiben.',
		done: 'Aufgeräumt.'
	},
	discarded: {
		title: 'Verworfene jetzt leeren',
		text: 'Leert Text und Originaldatei verworfener Einträge jetzt statt nach 30 Tagen. Der Eintrag bleibt als Sperre, damit dieselbe Mail oder derselbe Termin nicht noch einmal hereinkommt.',
		done: 'Verworfene Einträge geleert.'
	}
});

/** What the page cannot show on this server, and why. */
export const PARTIAL_NOTICE = {
	title: 'Nur ein Teil des Speichers',
	text: 'Programmdateien, Programmreste, Sicherheitskopien, Logs und den freien Platz zeigt die Seite nur, wenn die App unter Windows aus ihrem Ordner app läuft (start.bat). Dieser Server läuft anders, etwa unter Linux, in einem Container oder als Entwicklungsinstanz.'
} as const;

/**
 * Refusals of the route in the words of this page (reasons of lib/system-rules.js); the hint to
 * restart after an update ("missing") comes from the store (lib/guidance/texts.ts).
 */
export function denialText(reason: SystemDenial): { title: string; text: string } {
	switch (reason) {
		case 'loopback':
			return {
				title: 'Nur auf dem Rechner der App',
				text: 'Den Speicher zeigt die App nur im Browser auf dem Rechner, auf dem sie läuft, nicht von einem anderen Gerät und nicht über einen Proxy.'
			};
		case 'origin':
			return {
				title: 'Nur unter der Adresse der App',
				text: 'Öffne die App unter ihrer eigenen Adresse auf diesem Rechner, etwa http://127.0.0.1:8090/, und versuche es dort erneut.'
			};
		case 'owner':
		case 'forbidden':
			return {
				title: 'Nur für das erste Konto',
				text: 'Den Speicher der App sieht und verwaltet nur das Konto, das zuerst angelegt wurde.'
			};
		case 'rate':
			return {
				title: 'Gerade zu viele Anfragen',
				text: 'Bitte einen Moment warten und dann erneut versuchen.'
			};
		case 'busy':
			return {
				title: 'Es läuft schon eine Aktion',
				text: 'Bitte warten, bis sie fertig ist, und dann erneut versuchen.'
			};
		default:
			return {
				title: 'Der Speicher ließ sich nicht messen',
				text: 'Der Server hat mit einem Fehler geantwortet. Bitte später erneut versuchen.'
			};
	}
}
