// Page "Einstellungen → Sicherung" (ADR-0046): what the server reports about the backups (settings,
// passphrase, target folder, backups here and in the target, last runs and checks, warnings), the
// checks of the forms and the German texts. The limits of the generations are the same as in
// app/pb_hooks/lib/backup-rules.js and byl-functions.ps1 (parity test). Pure module: no requests,
// no runes.

import { formatPointInTime, sizeText } from './system';

export interface KeepLimit {
	readonly fallback: number;
	readonly min: number;
	readonly max: number;
}

/** Generations kept (GFS): defaults and limits. */
export const KEEP: Readonly<Record<'daily' | 'weekly' | 'monthly', KeepLimit>> = {
	daily: { fallback: 7, min: 1, max: 30 },
	weekly: { fallback: 4, min: 0, max: 12 },
	monthly: { fallback: 6, min: 0, max: 24 }
};
export type KeepName = keyof typeof KEEP;
export const KEEP_NAMES: readonly KeepName[] = ['daily', 'weekly', 'monthly'];
export const KEEP_LABELS: Readonly<Record<KeepName, string>> = {
	daily: 'Tägliche',
	weekly: 'Wöchentliche',
	monthly: 'Monatliche'
};

export const PASSPHRASE_MIN_LENGTH = 12;
export const TARGET_MAX_LENGTH = 240;

export interface BackupSettings {
	target: string | null;
	daily: number;
	weekly: number;
	monthly: number;
	credentials: boolean;
}

export const PASSPHRASE_STATES = ['set', 'missing', 'unreadable', 'unavailable'] as const;
export type PassphraseState = (typeof PASSPHRASE_STATES)[number];

export const TARGET_PROBLEMS = [
	'format',
	'too-long',
	'inside-app',
	'missing',
	'not-writable',
	'space'
] as const;
export type TargetProblem = (typeof TARGET_PROBLEMS)[number];

export interface TargetInfo {
	path: string;
	reachable: boolean;
	problem: TargetProblem | null;
	freeBytes: number | null;
	sameDrive: boolean;
}

export interface BackupFile {
	name: string;
	/** Time of the backup (ISO 8601, UTC). */
	at: string;
	bytes: number;
	/** Made by the app (byl-<stamp>.zip, kept in generations); only for backups here. */
	ours?: boolean;
}

export const WARNING_CODES = [
	'stale',
	'backup-failed',
	'target-lag',
	'export-failed',
	'no-passphrase',
	'verify-failed'
] as const;
export type WarningCode = (typeof WARNING_CODES)[number];

export interface BackupWarning {
	code: WarningCode;
	tone: 'warning' | 'error';
	since: string | null;
	reason: string;
}

export interface LastRun {
	at: string;
	name: string | null;
	bytes: number | null;
}

/** Where a backup lies: pb_data\backups ('local') or the target folder ('target', sealed). */
export type BackupSource = 'local' | 'target';

/** Originals a check expected and missed; examples as "collection/record", never file names. */
export interface VerifyFiles {
	expected: number;
	missing: number;
	examples: string[];
}

/** The last check of a backup (ADR-0046 §6). */
export interface VerifyRun {
	at: string;
	name: string;
	source: BackupSource;
	ok: boolean;
	/** Why it failed (VERIFY_REASON_TEXTS); '' when it is in order. */
	reason: string;
	/** Records per collection, counted by the throwaway server. */
	counts: Record<string, number> | null;
	files: VerifyFiles | null;
}

/** The result of "Prüfen" in the answer. */
export interface VerifyResult {
	ok: boolean;
	reason: string;
	encrypted: boolean;
	/** When the sealed backup was made (its manifest); null for a backup here. */
	createdUtc: string | null;
	/** Names of the access data it holds (never values). */
	variables: string[];
	counts: Record<string, number> | null;
	files: VerifyFiles | null;
}

export interface BackupOverview {
	appDir: string;
	settings: BackupSettings;
	passphrase: PassphraseState;
	/** byl-backup.exe is there. */
	helper: boolean;
	/** Names of the BYL_* variables of the account a backup takes along (never values). */
	variables: string[];
	target: TargetInfo | null;
	local: BackupFile[];
	sealed: BackupFile[];
	last: {
		backup: LastRun | null;
		backupError: { at: string; message: string } | null;
		export: LastRun | null;
		exportProblem: { at: string; reason: string; since: string | null } | null;
		verify: VerifyRun | null;
	};
	nextBackupAt: string | null;
	warnings: BackupWarning[];
}

/** What "Jetzt sichern" did: the new backup and its copy into the target. */
export interface RunResult {
	backup: string;
	backupError: string;
	export: { ok: boolean; reason: string; file: string } | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function count(value: unknown): number | null {
	return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null;
}

function textOf(value: unknown): string {
	return typeof value === 'string' ? value : '';
}

function oneOf<T extends string>(list: readonly T[], value: unknown): value is T {
	return typeof value === 'string' && (list as readonly string[]).includes(value);
}

function keepOf(value: unknown, name: KeepName): number {
	const limit = KEEP[name];
	const number = count(value);
	return number !== null && number >= limit.min && number <= limit.max ? number : limit.fallback;
}

function parseSettings(raw: unknown): BackupSettings {
	const value = isRecord(raw) ? raw : {};
	return {
		target: textOf(value.target) || null,
		daily: keepOf(value.daily, 'daily'),
		weekly: keepOf(value.weekly, 'weekly'),
		monthly: keepOf(value.monthly, 'monthly'),
		credentials: value.credentials !== false
	};
}

function parseFiles(raw: unknown): BackupFile[] {
	if (!Array.isArray(raw)) return [];
	return raw.filter(isRecord).flatMap((file): BackupFile[] => {
		const name = textOf(file.name);
		const at = textOf(file.at);
		if (name === '' || at === '') return [];
		const entry: BackupFile = { name, at, bytes: count(file.bytes) ?? 0 };
		if (typeof file.ours === 'boolean') entry.ours = file.ours;
		return [entry];
	});
}

function parseRun(raw: unknown): LastRun | null {
	if (!isRecord(raw) || textOf(raw.at) === '') return null;
	return { at: textOf(raw.at), name: textOf(raw.name) || null, bytes: count(raw.bytes) };
}

function parseCounts(raw: unknown): Record<string, number> | null {
	if (!isRecord(raw)) return null;
	const counts: Record<string, number> = {};
	for (const [name, value] of Object.entries(raw)) {
		const number = count(value);
		if (/^[a-z_]{1,60}$/.test(name) && number !== null) counts[name] = number;
	}
	return counts;
}

function parseVerifyFiles(raw: unknown): VerifyFiles | null {
	if (!isRecord(raw)) return null;
	return {
		expected: count(raw.expected) ?? 0,
		missing: count(raw.missing) ?? 0,
		examples: Array.isArray(raw.examples)
			? raw.examples.filter((entry): entry is string => typeof entry === 'string').slice(0, 10)
			: []
	};
}

function parseVerifyRun(raw: unknown): VerifyRun | null {
	if (!isRecord(raw) || textOf(raw.at) === '' || textOf(raw.name) === '') return null;
	return {
		at: textOf(raw.at),
		name: textOf(raw.name),
		source: raw.source === 'target' ? 'target' : 'local',
		ok: raw.ok === true,
		reason: raw.ok === true ? '' : textOf(raw.reason) || 'failed',
		counts: parseCounts(raw.counts),
		files: parseVerifyFiles(raw.files)
	};
}

/** The answer of GET /api/byl/backup (and of the changes), or null. */
export function parseOverview(raw: unknown): BackupOverview | null {
	if (!isRecord(raw) || !isRecord(raw.settings) || !isRecord(raw.last)) return null;
	const target =
		isRecord(raw.target) && textOf(raw.target.path) !== ''
			? {
					path: textOf(raw.target.path),
					reachable: raw.target.reachable === true,
					problem: oneOf(TARGET_PROBLEMS, raw.target.problem) ? raw.target.problem : null,
					freeBytes: count(raw.target.freeBytes),
					sameDrive: raw.target.sameDrive === true
				}
			: null;
	const last = raw.last;
	const backupError =
		isRecord(last.backupError) && textOf(last.backupError.at) !== ''
			? { at: textOf(last.backupError.at), message: textOf(last.backupError.message) }
			: null;
	const exportProblem =
		isRecord(last.exportProblem) && textOf(last.exportProblem.at) !== ''
			? {
					at: textOf(last.exportProblem.at),
					reason: textOf(last.exportProblem.reason),
					since: textOf(last.exportProblem.since) || null
				}
			: null;
	const warnings = Array.isArray(raw.warnings)
		? raw.warnings.filter(isRecord).flatMap((warning): BackupWarning[] =>
				oneOf(WARNING_CODES, warning.code)
					? [
							{
								code: warning.code,
								tone: warning.tone === 'error' ? 'error' : 'warning',
								since: textOf(warning.since) || null,
								reason: textOf(warning.reason)
							}
						]
					: []
			)
		: [];
	return {
		appDir: textOf(raw.appDir),
		settings: parseSettings(raw.settings),
		passphrase: oneOf(PASSPHRASE_STATES, raw.passphrase) ? raw.passphrase : 'missing',
		helper: raw.helper === true,
		variables: Array.isArray(raw.variables)
			? raw.variables.filter(
					(name): name is string => typeof name === 'string' && /^BYL_[A-Z0-9_]{1,60}$/.test(name)
				)
			: [],
		target,
		local: parseFiles(raw.local),
		sealed: parseFiles(raw.sealed),
		last: {
			backup: parseRun(last.backup),
			backupError,
			export: parseRun(last.export),
			exportProblem,
			verify: parseVerifyRun(last.verify)
		},
		nextBackupAt: textOf(raw.nextBackupAt) || null,
		warnings
	};
}

/** The result of "Jetzt sichern" in the answer, or null. */
export function parseRunResult(raw: unknown): RunResult | null {
	if (!isRecord(raw) || !isRecord(raw.result)) return null;
	const result = raw.result;
	const exported = isRecord(result.export)
		? {
				ok: result.export.ok === true,
				reason: textOf(result.export.reason),
				file: textOf(result.export.file)
			}
		: null;
	return {
		backup: textOf(result.backup),
		backupError: textOf(result.backupError),
		export: exported
	};
}

/** The result of "Prüfen" in the answer, or null. */
export function parseVerifyResult(raw: unknown): VerifyResult | null {
	if (!isRecord(raw) || !isRecord(raw.result) || !isRecord(raw.result.verify)) return null;
	const verify = raw.result.verify;
	return {
		ok: verify.ok === true,
		reason: verify.ok === true ? '' : textOf(verify.reason) || 'failed',
		encrypted: verify.encrypted === true,
		createdUtc: textOf(verify.createdUtc) || null,
		variables: Array.isArray(verify.variables)
			? verify.variables.filter(
					(name): name is string => typeof name === 'string' && /^BYL_[A-Z0-9_]{1,60}$/.test(name)
				)
			: [],
		counts: parseCounts(verify.counts),
		files: parseVerifyFiles(verify.files)
	};
}

/**
 * The backup "Jetzt prüfen" checks: the newest copy in the target folder (what a new machine
 * would get), else the newest backup here, the app's own first; like the weekly check of the cron.
 */
export function newestToVerify(
	overview: BackupOverview
): { source: BackupSource; name: string } | null {
	const sealed = overview.sealed[0];
	if (sealed !== undefined) return { source: 'target', name: sealed.name };
	const local = overview.local.find((file) => file.ours === true) ?? overview.local[0];
	return local === undefined ? null : { source: 'local', name: local.name };
}

/** Why a check failed, in the words of the page. */
export const VERIFY_REASON_TEXTS: Readonly<Record<string, string>> = {
	name: 'Diese Sicherung kennt die App nicht.',
	missing: 'Die Sicherung gibt es nicht (mehr).',
	unreachable: 'Das Zielverzeichnis ist nicht erreichbar.',
	'no-passphrase': 'Für die verschlüsselte Sicherung fehlt die Passphrase.',
	passphrase: 'Die Passphrase passt nicht zu dieser Sicherung.',
	format: 'Die Datei ist keine Sicherung der App.',
	damaged: 'Die Sicherung ist beschädigt oder unvollständig.',
	zip: 'Das ZIP der Sicherung lässt sich nicht entpacken.',
	'no-db': 'In der Sicherung fehlt die Datenbank.',
	integrity: 'Die Datenbank in der Sicherung ist beschädigt.',
	files: 'In der Sicherung fehlen Originaldateien.',
	start: 'Mit der Sicherung ließ sich keine Probe-Instanz starten.',
	space: 'Für die Prüfung ist im Temp-Ordner zu wenig Platz frei.',
	helper: 'byl-backup.exe fehlt oder antwortet nicht; scripts\\build.ps1 baut es.',
	failed: 'Die Prüfung ließ sich nicht ausführen.'
};

export function verifyReasonText(reason: string): string {
	return VERIFY_REASON_TEXTS[reason] ?? VERIFY_REASON_TEXTS.failed ?? '';
}

/** "12 Tickets, 3 Originaldateien" of a check that got that far, else ''. */
export function verifyCountsText(check: {
	counts: Record<string, number> | null;
	files: VerifyFiles | null;
}): string {
	const parts: string[] = [];
	const tickets = check.counts?.tickets;
	if (tickets !== undefined) parts.push(tickets === 1 ? '1 Ticket' : `${tickets} Tickets`);
	if (check.files !== null) {
		const { expected, missing } = check.files;
		parts.push(
			missing > 0
				? `${missing} von ${expected} Originaldateien fehlen`
				: expected === 1
					? '1 Originaldatei'
					: `${expected} Originaldateien`
		);
	}
	return parts.join(', ');
}

/** The row "Letzte Prüfung": when, which backup and what came out. */
export function verifyText(run: VerifyRun | null): string {
	if (run === null) return 'Noch keine';
	const where = run.source === 'target' ? 'im Zielverzeichnis' : 'im Ordner app';
	const counts = verifyCountsText(run);
	const outcome = run.ok
		? `in Ordnung${counts === '' ? '' : ` (${counts})`}`
		: `gescheitert: ${verifyReasonText(run.reason)}`;
	return `${formatPointInTime(run.at)} · Sicherung ${where} ${outcome}`;
}

/** What the page says about a target folder the control script refused. */
export const TARGET_PROBLEM_TEXTS: Readonly<
	Record<TargetProblem | 'keep' | 'credentials' | 'target', string>
> = {
	format:
		'Das ist kein vollständiger Pfad. Gib einen Ordner auf einem Laufwerk an (etwa einer USB-Platte) oder eine Freigabe wie \\\\NAS\\Freigabe\\Sicherung.',
	'too-long': `Der Pfad ist zu lang (höchstens ${TARGET_MAX_LENGTH} Zeichen).`,
	'inside-app':
		'Das Zielverzeichnis darf nicht im Ordner app liegen: Eine Kopie des Ordners nähme die Sicherungen mit, ein Plattendefekt beide.',
	missing:
		'Den Ordner gibt es nicht oder er ist gerade nicht erreichbar. Ist die USB-Platte angeschlossen, das Netzlaufwerk verbunden?',
	'not-writable': 'In diesen Ordner kann die App nicht schreiben.',
	space:
		'Auf dem Laufwerk des Ordners ist zu wenig Platz frei (mindestens 200 MB mehr als eine Sicherung).',
	keep: 'Bitte die Aufbewahrung innerhalb der Grenzen angeben.',
	credentials: 'Der Schalter für die Zugangsdaten fehlt.',
	target: 'Bitte einen Pfad angeben.'
};

export const PASSPHRASE_PROBLEMS = [
	'mismatch',
	'too-short',
	'too-long',
	'character',
	'unavailable'
] as const;
export type PassphraseProblem = (typeof PASSPHRASE_PROBLEMS)[number];

export const PASSPHRASE_PROBLEM_TEXTS: Readonly<Record<PassphraseProblem, string>> = {
	mismatch: 'Die beiden Eingaben stimmen nicht überein.',
	'too-short': `Die Passphrase muss mindestens ${PASSPHRASE_MIN_LENGTH} Zeichen lang sein.`,
	'too-long': 'Die Passphrase ist zu lang (höchstens 1024 Byte).',
	character: 'Die Passphrase darf keine Steuerzeichen enthalten.',
	unavailable: 'Diese Installation kann keine Passphrase speichern.'
};

/** The passphrase of the form: a problem before anything is sent, or null. */
export function passphraseProblem(
	passphrase: string,
	confirmation: string
): PassphraseProblem | null {
	if (passphrase.length < PASSPHRASE_MIN_LENGTH) return 'too-short';
	if (passphrase !== confirmation) return 'mismatch';
	return null;
}

/** The generations of the form: whole numbers within the limits, or a problem. */
export function keepProblem(values: Record<KeepName, number>): boolean {
	return KEEP_NAMES.some((name) => {
		const value = values[name];
		return !Number.isInteger(value) || value < KEEP[name].min || value > KEEP[name].max;
	});
}

export const PASSPHRASE_TEXTS = {
	keep: 'Bewahre die Passphrase in deinem Passwort-Manager auf – ohne sie lässt sich die Sicherung nicht öffnen.',
	change:
		'Neue Sicherungen nutzen danach die neue Passphrase; ältere bleiben mit ihrer bisherigen Passphrase lesbar.',
	bound:
		'Für die unbeaufsichtigten Sicherungen speichert die App sie verschlüsselt und an dein Windows-Konto gebunden auf diesem Rechner, nie im Klartext und nie im Ordner app.'
} as const;

export const PASSPHRASE_STATE_TEXTS: Readonly<Record<PassphraseState, string>> = {
	set: 'Festgelegt (an dieses Windows-Konto gebunden)',
	missing: 'Noch keine – ohne Passphrase entstehen keine Sicherungen im Zielverzeichnis.',
	unreadable:
		'Die gespeicherte Passphrase lässt sich mit diesem Windows-Konto nicht lesen. Bitte neu festlegen.',
	unavailable: 'Diese Installation kann keine Passphrase speichern.'
};

export const CREDENTIALS_TEXTS = {
	label: 'Zugangsdaten mitsichern',
	hint: 'Die Werte stammen aus den Windows-Umgebungsvariablen BYL_* deines Kontos, nicht aus der App. Sie kommen nur verschlüsselt ins Zielverzeichnis, nie in die Sicherungen im Ordner app. Beim Wiederherstellen schreibt die App sie auf Wunsch dorthin zurück.'
} as const;

/** Reasons of a copy into the target that did not happen, in the words of the page. */
export const EXPORT_REASON_TEXTS: Readonly<Record<string, string>> = {
	'no-target': 'Es ist kein Zielverzeichnis eingestellt.',
	unreachable: 'Das Zielverzeichnis war nicht erreichbar.',
	'no-passphrase': 'Es ist keine Passphrase festgelegt.',
	'passphrase-unreadable': 'Die gespeicherte Passphrase ließ sich nicht lesen.',
	space: 'Im Zielverzeichnis war zu wenig Platz frei.',
	name: 'Die Sicherung ist unbekannt.',
	missing: 'Die Sicherung fehlte in pb_data\\backups.',
	helper: 'byl-backup.exe fehlt oder antwortet nicht; scripts\\build.ps1 baut es.',
	'not-writable': 'In das Zielverzeichnis ließ sich nicht schreiben.',
	failed: 'Die Sicherung ließ sich nicht verschlüsseln.'
};

export function exportReasonText(reason: string): string {
	return EXPORT_REASON_TEXTS[reason] ?? EXPORT_REASON_TEXTS.failed ?? '';
}

/** Title and text of a warning of the page (ADR-0009: red only for real errors). */
export function warningText(warning: BackupWarning): { title: string; text: string } {
	const since = formatPointInTime(warning.since);
	switch (warning.code) {
		case 'stale':
			return {
				title: 'Die letzte Sicherung ist älter als 36 Stunden',
				text:
					since === ''
						? 'Die App sichert, sobald sie läuft; „Jetzt sichern“ geht sofort.'
						: `Sie stammt vom ${since}. Die App sichert, sobald sie läuft; „Jetzt sichern“ geht sofort.`
			};
		case 'backup-failed':
			return {
				title: 'Die letzte Sicherung ist gescheitert',
				text: 'Versuche „Jetzt sichern“. Einzelheiten stehen unter Einstellungen → System im Log „Server“.'
			};
		case 'target-lag':
			return {
				title: 'Das Zielverzeichnis ist länger nicht aktuell',
				text: `${since === '' ? 'Dort liegt noch keine Sicherung.' : `Die neueste Sicherung dort ist vom ${since}.`} ${warning.reason === '' ? '' : exportReasonText(warning.reason)}`.trim()
			};
		case 'export-failed':
			return {
				title: 'Die Kopie ins Zielverzeichnis ist gescheitert',
				text: exportReasonText(warning.reason)
			};
		case 'verify-failed':
			return {
				title: 'Die letzte Prüfung einer Sicherung ist gescheitert',
				text: `${verifyReasonText(warning.reason)} Unter „Sicherungen“ lässt sich jede Sicherung einzeln prüfen; „Jetzt sichern“ legt eine neue an.`
			};
		default:
			return {
				title: 'Keine Passphrase für das Zielverzeichnis',
				text: 'Lege unten eine Passphrase fest; erst dann entstehen dort verschlüsselte Sicherungen.'
			};
	}
}

/** "01.10.2026 14:00 · 2,4 MB" of a backup or a run. */
export function runText(run: { at: string; bytes: number | null } | null): string {
	if (run === null) return 'Noch keine';
	const when = formatPointInTime(run.at);
	return run.bytes === null || run.bytes === 0 ? when : `${when} · ${sizeText(run.bytes)}`;
}

/** Free space as "12,5 GB frei" (MB below one GB). */
export function freeText(bytes: number | null): string {
	if (bytes === null) return '';
	if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1).replace('.', ',')} GB frei`;
	return `${Math.floor(bytes / 1024 ** 2)} MB frei`;
}

/** Hint of a flag when the app opens with a real warning (ADR-0035). */
export const ATTENTION_TEXTS = {
	title: 'Die Sicherung braucht deine Aufmerksamkeit.',
	action: 'Ansehen'
} as const;
