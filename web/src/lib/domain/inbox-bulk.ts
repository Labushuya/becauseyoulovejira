// Several entries of the inbox at once (EG-1, ADR-0014 addendum EG-1): "Verwerfen (n)" of the chosen
// new entries and "Wiederherstellen (n)" of the chosen discarded ones. Pure rules: which entry an
// action applies to, why it skips one, and the words of progress, flag and result. The store
// (stores/inbox.svelte.ts) runs the entries one after the other through the Record API; there is no
// batch API (ADR-0014 §4).

import type { InboxState } from './inbox';

export type InboxBulkKind = 'discard' | 'restore';

/** Name of the action on its button and in the progress. */
export const BULK_LABELS: Readonly<Record<InboxBulkKind, string>> = Object.freeze({
	discard: 'Verwerfen',
	restore: 'Wiederherstellen'
});

/** Past participle of the action in the flag and the result. */
export const BULK_VERBS: Readonly<Record<InboxBulkKind, string>> = Object.freeze({
	discard: 'verworfen',
	restore: 'wiederhergestellt'
});

/** The state an action applies to: like one entry, only a new one is discarded. */
export const BULK_STATES: Readonly<Record<InboxBulkKind, InboxState>> = Object.freeze({
	discard: 'new',
	restore: 'discarded'
});

/** Reasons the store adds itself: an entry of the outbox, or one with an action of its own. */
export const BULK_SKIP_REASONS = Object.freeze({
	created: 'Noch nicht übertragen.',
	pending: 'Wird gerade bearbeitet.'
});

/**
 * Why an action leaves a chosen entry out, or null when it applies. `state` is the state the store
 * knows now (it may have changed since the choice, e.g. in another tab); null: the store does not
 * know the entry any more. It holds every new entry and the loaded discarded ones of the view, so an
 * unknown entry is no longer new, or no longer discarded.
 */
export function bulkSkipReason(kind: InboxBulkKind, state: InboxState | null): string | null {
	if (state === null) return kind === 'discard' ? 'Nicht mehr neu.' : 'Nicht mehr verworfen.';
	if (state === BULK_STATES[kind]) return null;
	if (kind === 'discard') return state === 'discarded' ? 'Schon verworfen.' : 'Schon verknüpft.';
	return state === 'new' ? 'Schon im Eingang.' : 'Verknüpft, nicht verworfen.';
}

/** A chosen entry: its ID and the title that names it in the result. */
export interface InboxBulkEntry {
	id: string;
	title: string;
}

/** An entry the action left out or could not change, with the reason. */
export interface InboxBulkProblem extends InboxBulkEntry {
	reason: string;
}

/** Result of the last run, shown in the bar of the selection until the next one or "Ergebnis schließen". */
export interface InboxBulkResult {
	/** "verworfen" or "wiederhergestellt". */
	verb: string;
	/** Refused or failed requests; shown as errors. */
	failures: readonly InboxBulkProblem[];
	/** Entries the action does not apply to; neutral. */
	skipped: readonly InboxBulkProblem[];
}

/** The running action. */
export interface InboxBulkProgress {
	label: string;
	total: number;
	done: number;
}

export interface InboxBulkCounts {
	total: number;
	done: number;
	skipped: number;
	failed: number;
}

/** "1 Eintrag", "3 Einträge". */
export function entryCount(count: number): string {
	return count === 1 ? '1 Eintrag' : `${count} Einträge`;
}

/** "Verwerfen: 2 von 3 Einträgen". */
export function bulkProgressText(progress: InboxBulkProgress): string {
	const total = progress.total === 1 ? '1 Eintrag' : `${progress.total} Einträgen`;
	return `${progress.label}: ${progress.done} von ${total}`;
}

/**
 * Title of the flag after a run: "2 Einträge verworfen, 1 übersprungen, 1 fehlgeschlagen.", or, when
 * every request failed, "Keiner der 2 Einträge wurde verworfen." (like the trash).
 */
export function bulkResultTitle(counts: InboxBulkCounts, verb: string): string {
	if (counts.done === 0 && counts.failed > 0) {
		return counts.total === 1
			? `Der Eintrag wurde nicht ${verb}.`
			: `Keiner der ${counts.total} Einträge wurde ${verb}.`;
	}
	const parts = [`${entryCount(counts.done)} ${verb}`];
	if (counts.skipped > 0) parts.push(`${counts.skipped} übersprungen`);
	if (counts.failed > 0) parts.push(`${counts.failed} fehlgeschlagen`);
	return `${parts.join(', ')}.`;
}

/** Head of the failures of the result: "1 Eintrag wurde nicht verworfen:". */
export function bulkFailureTitle(count: number, verb: string): string {
	return count === 1 ? `1 Eintrag wurde nicht ${verb}:` : `${count} Einträge wurden nicht ${verb}:`;
}

/** Head of the skipped entries of the result: "2 Einträge übersprungen:". */
export function bulkSkippedTitle(count: number): string {
	return `${entryCount(count)} übersprungen:`;
}

/**
 * Why "Verwerfen (n)" and "Wiederherstellen (n)" are locked without a connection (OF-3): the hint
 * beside the button, in the words of "Alle Kanäle jetzt abrufen".
 */
export const BULK_OFFLINE_HINT = 'Nur mit Verbindung';

/** The flag of a tap or Enter on a locked action: "„Verwerfen (3)“ geht nur mit Verbindung.". */
export function bulkOfflineText(label: string): string {
	return `„${label}“ geht nur mit Verbindung.`;
}
