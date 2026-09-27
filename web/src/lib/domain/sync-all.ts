// "Alle Kanäle jetzt abrufen" (testing feedback package A, item 4): the texts of the live status
// and of the flag after the run, and the anchor of a connection card on the page "Kanäle", where the
// flag leads after a failure. Pure; the store (stores/sync-all.svelte.ts) runs the connections.

import { runResultText, type Connection, type RunResult } from './connections';

const ANCHOR_PREFIX = 'verbindung-';

/** ID of the element of a connection card, e.g. "verbindung-abc…" (address: connectionCardHref). */
export function connectionAnchor(id: string): string {
	return `${ANCHOR_PREFIX}${id}`;
}

/** The element ID in the hash of the address if it names a connection card, else null. */
export function cardAnchorOf(hash: string): string | null {
	const match = /^#(verbindung-[a-z0-9]{15})$/.exec(hash);
	return match?.[1] ?? null;
}

export interface SyncEntry {
	connection: Pick<Connection, 'id' | 'label'>;
	result: RunResult;
}

export interface SyncSummary {
	tone: 'success' | 'info' | 'error';
	title: string;
	description: string;
	/** First connection with a problem; the flag links to its card. */
	problem: Pick<Connection, 'id' | 'label'> | null;
}

/** Live status while a connection runs, e.g. "„Web.de“ wird abgerufen (2 von 3) …". */
export function syncProgressText(index: number, total: number, label: string): string {
	return `„${label}“ wird abgerufen (${index + 1} von ${total}) …`;
}

/** "keine neuen", "1 neuer" or "3 neue". */
export function newCountText(created: number): string {
	if (created === 0) return 'keine neuen';
	return created === 1 ? '1 neuer' : `${created} neue`;
}

const PROBLEMS: readonly RunResult['status'][] = ['error', 'unavailable', 'missing'];

/**
 * Flag after all switched-on connections ran: the new entries in the title ("3 neue", "keine
 * neuen"), every connection in the description. A failed run makes an error flag with the first
 * connection that failed; a helper that does not run or missing variables stay neutral.
 */
export function syncSummary(entries: readonly SyncEntry[]): SyncSummary {
	if (entries.length === 0) {
		return {
			tone: 'info',
			title: 'Kein eingeschalteter Kanal zum Abrufen.',
			description: 'Kanäle richtest du unter Einstellungen → Kanäle ein.',
			problem: null
		};
	}
	const created = entries.reduce(
		(sum, entry) => sum + (entry.result.status === 'ok' ? entry.result.created : 0),
		0
	);
	const problems = entries.filter((entry) => PROBLEMS.includes(entry.result.status));
	const failed = entries.some((entry) => entry.result.status === 'error');
	const channels = entries.length === 1 ? '1 Kanal' : `${entries.length} Kanäle`;
	const title =
		problems.length === 0
			? `${channels} abgerufen: ${newCountText(created)}.`
			: `${channels} abgerufen: ${newCountText(created)}, ${problems.length} mit Problem.`;
	return {
		tone: failed ? 'error' : problems.length > 0 ? 'info' : 'success',
		title,
		description: entries
			.map((entry) => runResultText(entry.connection.label, entry.result))
			.join(' '),
		problem: problems[0]?.connection ?? null
	};
}
