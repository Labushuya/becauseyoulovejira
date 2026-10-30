// Several entries of the inbox at once (EG-1, ADR-0014 addendum EG-1): "Verwerfen (n)" of the chosen
// new entries and "Wiederherstellen (n)" of the chosen discarded ones. Pure rules: which entry an
// action applies to, why it skips one, and the words of progress, flag and result. The store
// (stores/inbox.svelte.ts) runs the entries one after the other through the Record API; there is no
// batch API (ADR-0014 §4).

import type { InboxState, InboxView } from './inbox';
import type { ProblemEntry } from './problems';

export type InboxBulkKind = 'discard' | 'restore';

/**
 * The bulk action of a view: "Verwerfen (n)" in "Neu", "Wiederherstellen (n)" in "Verworfen"; the
 * views "Verknüpft" and "Alle" have no selection, so neither a progress nor a result stands there.
 */
export function bulkKindOf(view: InboxView): InboxBulkKind | null {
	if (view === 'new') return 'discard';
	return view === 'discarded' ? 'restore' : null;
}

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
 * knows now (it may have changed since the choice, e.g. in another tab); null: the entry is gone. The
 * store holds every new entry, so for "Verwerfen" an unknown entry is no longer new; "Wiederherstellen"
 * sends one that is only no longer loaded (another view or source, the server decides) and names only
 * one deleted meanwhile.
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
	/** The failed request behind a failure, for "Details" (FP-1, ADR-0071); none for a skipped entry. */
	problem?: ProblemEntry;
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
 * every request failed, "Keiner der 2 Einträge wurde verworfen." (like the trash), and when every
 * chosen entry was skipped "Nichts verworfen: 3 übersprungen." (like "Nichts übertragen: …").
 */
export function bulkResultTitle(counts: InboxBulkCounts, verb: string): string {
	if (counts.done === 0 && counts.failed > 0) {
		return counts.total === 1
			? `Der Eintrag wurde nicht ${verb}.`
			: `Keiner der ${counts.total} Einträge wurde ${verb}.`;
	}
	if (counts.done === 0 && counts.skipped > 0) {
		return `Nichts ${verb}: ${counts.skipped} übersprungen.`;
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

/**
 * The reason of a flag whose result does not stand at the selection (MO-7c1, F-1): the first failure
 * with its entry, and how many follow, e.g. "„Artikel“: Der Server … Dazu 1 weiterer Fehler.".
 */
export function bulkFailureNote(failures: readonly InboxBulkProblem[]): string {
	const [first] = failures;
	if (first === undefined) return '';
	const rest = failures.length - 1;
	const more =
		rest === 0 ? '' : rest === 1 ? ' Dazu 1 weiterer Fehler.' : ` Dazu ${rest} weitere Fehler.`;
	return `„${first.title}“: ${first.reason}${more}`;
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

/**
 * The flag of a click or Enter on a bulk action while a run goes on (the progress names it):
 * "„Gesammelt umwandeln (3)“ geht erst, wenn „Verwerfen“ fertig ist.".
 */
export function bulkRunningText(label: string, running: string): string {
	return `„${label}“ geht erst, wenn „${running}“ fertig ist.`;
}
