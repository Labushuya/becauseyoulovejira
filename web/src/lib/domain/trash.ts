// Trash for tickets in the SPA (ADR-0037, plan PB-2): the values of the routes /api/byl/trash…,
// the settings of the retention and the texts of the view. Pure; the server computes the
// remaining days (app/pb_hooks/lib/trash-rules.js), the SPA only words them.

import type { Priority, Status } from './status';

/** users.trash_retention; '' on the server means the default of 30 days. */
export type TrashRetention = '7' | '30' | '90' | 'never';

export const TRASH_RETENTIONS: readonly TrashRetention[] = Object.freeze([
	'7',
	'30',
	'90',
	'never'
]);

export const DEFAULT_RETENTION: TrashRetention = '30';

export const RETENTION_LABELS: Readonly<Record<TrashRetention, string>> = Object.freeze({
	'7': '7 Tage',
	'30': '30 Tage',
	'90': '90 Tage',
	never: 'Nie automatisch'
});

/** The retention of the account; '' or anything unknown is the default. */
export function parseRetention(value: unknown): TrashRetention {
	return typeof value === 'string' && (TRASH_RETENTIONS as readonly string[]).includes(value)
		? (value as TrashRetention)
		: DEFAULT_RETENTION;
}

/** Project of a ticket in the trash, from its snapshot; `exists` false: gone or another code. */
export interface TrashProject {
	id: string;
	code: string;
	name: string;
	exists: boolean;
}

/** A ticket of the trash as the list shows it (only the first ticket of a group). */
export interface TrashItem {
	id: string;
	key: string;
	title: string;
	status: Status;
	priority: Priority;
	due: string;
	project: TrashProject | null;
	recurring: boolean;
	/** Sub-tasks that went into the trash with it. */
	children: number;
	deletedAt: string;
	/** ID of the account that deleted it, '' for the system. */
	deletedBy: string;
	/** Base of expected_updated. */
	updated: string;
	/** Whole days until it is deleted for good (0 = today), null: never. */
	daysLeft: number | null;
}

/** Read-only preview of a ticket in the trash. */
export interface TrashPreview extends TrashItem {
	description: string;
	tags: readonly { id: string; name: string }[];
	subtasks: readonly { id: string; key: string; title: string; status: Status }[];
	/** First ticket of its group, '' when it is one itself. */
	group: string;
	sources: { handling: 'inbox' | 'discard'; count: number };
}

/** Why a source did not come back with the ticket. */
export type SkipReason = 'converted' | 'discarded' | 'missing';

export interface RestoreResult {
	id: string;
	key: string;
	updated: string;
	tickets: readonly { id: string; key: string }[];
	newKeys: readonly { id: string; key: string; previous: string }[];
	parentDetached: boolean;
	ruleMissing: readonly string[];
	seriesDetached: readonly string[];
	sourcesSkipped: readonly { id: string; title: string; reason: SkipReason; key: string }[];
}

/** What a restore needs before it can run, from the refusal of the server. */
export type RestoreNeed =
	| { kind: 'project'; code: string; reason: 'missing' | 'changed' }
	| { kind: 'series'; key: string; ticketId: string };

/** Options of a restore. */
export interface RestoreOptions {
	/** "Rückgängig": refuses if the ticket changed since. */
	expectedUpdated?: string;
	/** Target project ('' for none) when the old one is gone or has another code. */
	project?: string;
	/** Restore instances of a series as normal tickets. */
	detachSeries?: boolean;
}

/** Texts of the codes, the same as the hook (lib/trash-rules.js MESSAGES, parity test). */
export const TRASH_MESSAGES: Readonly<Record<string, string>> = Object.freeze({
	validation_trash_managed:
		'Den Papierkorb verwaltet der Server; diese Felder lassen sich nicht setzen.',
	validation_trash_stale: 'Das Ticket wurde inzwischen wiederhergestellt oder geändert.',
	validation_trash_group_member: 'Diese Unteraufgabe kommt mit ihrem übergeordneten Ticket zurück.',
	validation_trash_project_required:
		'Das Projekt gibt es nicht mehr oder es hat einen anderen Code. Bitte ein Zielprojekt wählen.',
	validation_trash_project_invalid: 'Dieses Projekt ist nicht verfügbar.',
	validation_trash_series_conflict: 'Die Serie hat schon ein offenes Ticket.',
	validation_trash_source_handling:
		'Unbekannte Behandlung der Quellen: erlaubt sind „inbox“ und „discard“.'
});

/** Validation codes of the routes (lib/trash-rules.js). */
export const TRASH_CODES = Object.freeze({
	stale: 'validation_trash_stale',
	groupMember: 'validation_trash_group_member',
	projectRequired: 'validation_trash_project_required',
	projectInvalid: 'validation_trash_project_invalid',
	seriesConflict: 'validation_trash_series_conflict'
});

/** "in 30 Tagen", "in 1 Tag", "heute", "nie". */
export function daysLeftText(days: number | null): string {
	if (days === null) return 'nie';
	if (days <= 0) return 'heute';
	return days === 1 ? 'in 1 Tag' : `in ${days} Tagen`;
}

/** Sentence of the retention for the view and the delete question. */
export function retentionText(retention: TrashRetention): string {
	if (retention === 'never') return 'Tickets im Papierkorb werden nicht automatisch gelöscht.';
	return `Tickets im Papierkorb werden nach ${retention} Tagen endgültig gelöscht.`;
}

/** "1 Ticket" / "3 Tickets". */
function tickets(count: number): string {
	return count === 1 ? '1 Ticket' : `${count} Tickets`;
}

/** Title of the flag after moving tickets to the trash. */
export function movedText(keys: readonly string[]): string {
	if (keys.length === 1) return `${keys[0]} in den Papierkorb verschoben.`;
	return `${tickets(keys.length)} in den Papierkorb verschoben.`;
}

/** Number of sub-tasks that go along, for the delete question. */
export function subtasksAlongText(count: number): string {
	return count === 1
		? '1 Unteraufgabe kommt mit in den Papierkorb.'
		: `${count} Unteraufgaben kommen mit in den Papierkorb.`;
}

/** Reason of a skipped source in words. */
export const SKIP_REASONS: Readonly<Record<SkipReason, string>> = Object.freeze({
	converted: 'inzwischen einem anderen Ticket zugeordnet',
	discarded: 'inzwischen verworfen',
	missing: 'nicht mehr vorhanden'
});

/** Notes of a restore that the user should know, one sentence each ([] when nothing to say). */
export function restoreNotes(result: RestoreResult): string[] {
	const notes: string[] = [];
	for (const entry of result.newKeys) {
		notes.push(`${entry.previous} heißt jetzt ${entry.key}.`);
	}
	if (result.parentDetached) {
		notes.push(
			`${result.key} ist jetzt ein eigenständiges Ticket; das übergeordnete Ticket fehlt.`
		);
	}
	for (const key of result.ruleMissing) {
		notes.push(`${key} ist ein normales Ticket; die Regel der Serie gibt es nicht mehr.`);
	}
	for (const key of result.seriesDetached) {
		notes.push(`${key} ist aus der Serie gelöst.`);
	}
	for (const skip of result.sourcesSkipped) {
		const title = skip.title === '' ? 'Eine Quelle' : `Die Quelle „${skip.title}“`;
		notes.push(`${title} blieb im Eingang: ${SKIP_REASONS[skip.reason]}.`);
	}
	return notes;
}

/** Text of what a restore needs, for the inline question. */
export function needText(need: RestoreNeed): string {
	if (need.kind === 'series') {
		return `Die Serie hat schon ein offenes Ticket (${need.key}). Wiederherstellen würde es doppeln.`;
	}
	return need.reason === 'missing'
		? `Das Projekt ${need.code} gibt es nicht mehr. Bitte ein Zielprojekt wählen; das Ticket bekommt dort einen neuen Key.`
		: `Das Projekt ${need.code} hat inzwischen einen anderen Code oder Bereich. Bitte ein Zielprojekt wählen; das Ticket bekommt dort einen neuen Key.`;
}
